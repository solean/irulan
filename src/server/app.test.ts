import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import JSZip from "jszip";

// Storage, the public directory, and `SMTP_PASS` are all set up by `src/test/setup.ts`,
// which runs before this file's imports, so these imports are plain static ones.
import { appConfig } from "./config";
import * as client from "./db/client";
import * as schema from "./db/schema";
import { app } from "./app";
import * as smtpCredentials from "./services/smtp-credentials";
import * as smtpSettings from "./services/settings";

await client.initializeDatabase();
client.ensureSchema();

// A stand-in for the built client, so the SPA catch-all has something to serve.
mkdirSync(appConfig.publicDir, { recursive: true });
writeFileSync(
  path.join(appConfig.publicDir, "index.html"),
  "<!doctype html><html><body>spa</body></html>",
);

const request = async (url: string, init?: RequestInit) => {
  const response = await app.fetch(new Request(`http://127.0.0.1${url}`, init));
  const body = await response.text();

  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    csp: response.headers.get("content-security-policy") ?? "",
    body,
    json: () => {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
};

const json = (payload: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const buildImportEpub = async () => {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Concurrent Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest/>
  <spine/>
</package>`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
};


type TestGlobal = typeof globalThis & {
  irulanSafeStorage?: {
    isEncryptionAvailable: () => boolean;
    encryptString: (value: string) => Buffer;
    decryptString: (value: Buffer) => string;
  };
};

const testGlobal = globalThis as TestGlobal;

const installFakeSafeStorage = () => {
  testGlobal.irulanSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => {
      const decoded = value.toString();
      if (!decoded.startsWith("encrypted:")) throw new Error("Invalid encrypted value.");
      return decoded.slice("encrypted:".length);
    },
  };
};

beforeEach(() => {
  delete testGlobal.irulanSafeStorage;
  client.db.delete(schema.bookShelves).run();
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();
  client.db.delete(schema.settings).run();
  client.db
    .insert(schema.bookshelves)
    .values({ id: "shelf-1", name: "Shelf", kindleEmail: null, sortOrder: 0, createdAt: new Date() })
    .run();
});

afterAll(() => {
  rmSync(appConfig.publicDir, { force: true, recursive: true });
  rmSync(appConfig.storageDir, { force: true, recursive: true });
});

describe("thrown errors become JSON (finding 23)", () => {
  test("an unguarded handler reports the status the service asked for", async () => {
    // listBooks throws AppError(404) for an unknown shelf. This handler has no
    // try/catch of its own; before onError it answered with a plain-text 500.
    const response = await request("/api/books?bookshelfId=deleted-shelf");

    expect(response.status).toBe(404);
    expect(response.contentType).toContain("application/json");
    expect(response.json()).toEqual({ error: "Bookshelf not found." });
  });

  test("keeps reporting errors raised inside handlers", async () => {
    const response = await request("/api/books/no-such-book");

    expect(response.status).toBe(404);
    expect(response.json()).toEqual({ error: "Book not found." });
  });

  test("turns a schema failure into a 400 with the first issue", async () => {
    const response = await request("/api/settings", json({ defaultKindleEmail: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(response.contentType).toContain("application/json");
    expect(typeof response.json()?.error).toBe("string");
  });

  test("reports an unknown bookshelf on write as 404, not 500", async () => {
    const response = await request(
      "/api/bookshelves/missing-shelf",
      json({ name: "Renamed", kindleEmail: null }),
    );

    expect(response.status).toBe(404);
    expect(response.json()).toEqual({ error: "Bookshelf not found." });
  });

  test("still answers successful requests normally", async () => {
    const response = await request("/api/bookshelves");

    expect(response.status).toBe(200);
    expect(response.json()).toHaveProperty("bookshelves");
  });
});

describe("SMTP password handling (finding 18)", () => {
  const smtpPayload = {
    host: "smtp.example.com",
    port: 587,
    secure: false,
    user: "sender@example.com",
    from: "sender@example.com",
  };

  test("settings responses expose only password state", async () => {
    const response = await request("/api/settings");
    const smtp = response.json()?.smtp as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(smtp.hasPassword).toBe(false);
    expect(smtp.passwordSource).toBe("none");
    expect(smtp).not.toHaveProperty("pass");
    expect(smtp).not.toHaveProperty("password");
  });

  test("saving SMTP fields without a password does not create one", async () => {
    const response = await request("/api/settings/smtp", json(smtpPayload));
    const smtp = response.json()?.smtp as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(smtp.hasPassword).toBe(false);
    expect(smtp.passwordSource).toBe("none");
    expect(client.db.select().from(schema.settings).all()).not.toContainEqual(
      expect.objectContaining({ key: "smtp_pass_encrypted" }),
    );
  });

  test("saves, preserves, and replaces an encrypted app password", async () => {
    installFakeSafeStorage();

    const created = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, password: "first-secret" }),
    );
    expect(created.status).toBe(200);
    expect((created.json()?.smtp as Record<string, unknown>).passwordSource).toBe("app");
    expect(created.body).not.toContain("first-secret");
    expect(smtpSettings.getSmtpPassword()).toBe("first-secret");

    const encryptedRow = client.db
      .select()
      .from(schema.settings)
      .all()
      .find((row) => row.key === "smtp_pass_encrypted");
    expect(encryptedRow?.value).not.toContain("first-secret");
    expect(client.db.select().from(schema.settings).all()).not.toContainEqual(
      expect.objectContaining({ key: "smtp_pass" }),
    );

    const preserved = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, host: "smtp.changed.example.com" }),
    );
    expect(preserved.status).toBe(200);
    expect(smtpSettings.getSmtpPassword()).toBe("first-secret");

    const replaced = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, password: "second-secret" }),
    );
    expect(replaced.status).toBe(200);
    expect(replaced.body).not.toContain("second-secret");
    expect(smtpSettings.getSmtpPassword()).toBe("second-secret");
  });

  test("explicitly clears an app password", async () => {
    installFakeSafeStorage();
    await request("/api/settings/smtp", json({ ...smtpPayload, password: "saved-secret" }));

    const response = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, clearPassword: true }),
    );
    const smtp = response.json()?.smtp as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(smtp.hasPassword).toBe(false);
    expect(smtp.passwordSource).toBe("none");
    expect(smtpSettings.getSmtpPassword()).toBeNull();
  });

  test("rejects clearing when there is no app password", async () => {
    const response = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, clearPassword: true }),
    );

    expect(response.status).toBe(400);
    expect(response.json()).toEqual({ error: "There is no saved app password to clear." });
  });

  test("migrates a legacy password into encrypted storage", () => {
    installFakeSafeStorage();
    client.db.insert(schema.settings).values({ key: "smtp_pass", value: "legacy-secret" }).run();

    smtpCredentials.migrateLegacySmtpPassword(null);

    expect(smtpSettings.getSmtpPassword()).toBe("legacy-secret");
    expect(client.db.select().from(schema.settings).all()).not.toContainEqual(
      expect.objectContaining({ key: "smtp_pass" }),
    );
    expect(client.db.select().from(schema.settings).all()).toContainEqual(
      expect.objectContaining({ key: "smtp_pass_encrypted" }),
    );
  });

  test("standalone migration discards plaintext when SMTP_PASS replaces it", () => {
    client.db.insert(schema.settings).values({ key: "smtp_pass", value: "legacy-secret" }).run();

    smtpCredentials.migrateLegacySmtpPassword("environment-secret");

    expect(client.db.select().from(schema.settings).all()).not.toContainEqual(
      expect.objectContaining({ key: "smtp_pass" }),
    );
    expect(smtpCredentials.resolveSmtpPassword("environment-secret")).toBe(
      "environment-secret",
    );
  });

  test("standalone migration keeps plaintext when no safe replacement exists", () => {
    client.db.insert(schema.settings).values({ key: "smtp_pass", value: "legacy-secret" }).run();

    expect(() => smtpCredentials.migrateLegacySmtpPassword(null)).toThrow(
      "migrated by the Electron app or replaced with SMTP_PASS",
    );
    expect(client.db.select().from(schema.settings).all()).toContainEqual({
      key: "smtp_pass",
      value: "legacy-secret",
    });
  });

  test("standalone settings remain readable with an encrypted app credential", async () => {
    client.db
      .insert(schema.settings)
      .values({ key: "smtp_pass_encrypted", value: "unavailable-ciphertext" })
      .run();

    const response = await request("/api/settings");
    const smtp = response.json()?.smtp as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(smtp.hasPassword).toBe(true);
    expect(smtp.passwordSource).toBe("app");
    expect(() => smtpSettings.getSmtpPassword()).toThrow(
      "The saved SMTP password requires Electron secure storage",
    );
  });

  test("a credential that cannot decrypt does not block replacement", async () => {
    installFakeSafeStorage();
    client.db
      .insert(schema.settings)
      .values({ key: "smtp_pass_encrypted", value: "unavailable-ciphertext" })
      .run();

    const loaded = await request("/api/settings");
    expect(loaded.status).toBe(200);
    expect((loaded.json()?.smtp as Record<string, unknown>).passwordSource).toBe("app");

    const replaced = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, password: "replacement-secret" }),
    );
    expect(replaced.status).toBe(200);
    expect(smtpSettings.getSmtpPassword()).toBe("replacement-secret");
  });

  test("environment password wins when encrypted storage is unavailable", () => {
    client.db
      .insert(schema.settings)
      .values({ key: "smtp_pass_encrypted", value: "unavailable-ciphertext" })
      .run();

    expect(smtpCredentials.getSmtpPasswordSource("environment-secret")).toBe("environment");
    expect(smtpCredentials.resolveSmtpPassword("environment-secret")).toBe(
      "environment-secret",
    );
  });

  test("rejects a password replacement and clear request together", async () => {
    const response = await request(
      "/api/settings/smtp",
      json({
        ...smtpPayload,
        password: "plaintext-secret",
        clearPassword: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(response.json()).toEqual({ error: "Set a password or clear it, not both." });
  });

  test("standalone server refuses to persist a password without secure storage", async () => {
    const response = await request(
      "/api/settings/smtp",
      json({ ...smtpPayload, password: "plaintext-secret" }),
    );

    expect(response.status).toBe(503);
    expect(response.json()).toEqual({
      error:
        "Secure password storage is unavailable. Configure SMTP_PASS in the environment instead.",
    });
  });

  test("rolls back the password and ordinary settings together when either write fails", async () => {
    installFakeSafeStorage();
    await request("/api/settings/smtp", json({ ...smtpPayload, password: "kept-secret" }));

    // saveSmtpSettings writes the password row before the ordinary ones, so aborting
    // the host write is the case that matters: without one transaction around both, a
    // password would outlive the settings it was entered alongside.
    client.db.run(
      sql.raw(`
        CREATE TRIGGER block_smtp_host_writes BEFORE INSERT ON settings
        WHEN NEW.key = 'smtp_host'
        BEGIN SELECT RAISE(ABORT, 'smtp host write blocked'); END;
      `),
    );

    try {
      expect(() =>
        smtpSettings.saveSmtpSettings({
          ...smtpPayload,
          host: "smtp.unsaved.example.com",
          password: "lost-secret",
        }),
      ).toThrow("smtp host write blocked");
    } finally {
      client.db.run(sql.raw("DROP TRIGGER IF EXISTS block_smtp_host_writes;"));
    }

    expect(smtpSettings.getSmtpSettings().host).toBe("smtp.example.com");
    expect(smtpSettings.getSmtpPassword()).toBe("kept-secret");
  });
});

describe("book list pagination (finding 15)", () => {
  test("returns the bounded page envelope by default", async () => {
    const response = await request("/api/books");

    expect(response.status).toBe(200);
    expect(response.json()).toEqual({
      books: [],
      offset: 0,
      limit: 60,
      total: 0,
      unfilteredTotal: 0,
      statusCounts: {
        all: 0,
        unread: 0,
        reading: 0,
        finished: 0,
      },
    });
  });

  test("rejects query values that could bypass the page bounds", async () => {
    for (const url of [
      "/api/books?limit=101",
      "/api/books?limit=1.5",
      "/api/books?offset=-1",
      "/api/books?sort=nope",
      "/api/books?direction=sideways",
      "/api/books?readStatus=unknown",
    ]) {
      const response = await request(url);
      expect(response.status).toBe(400);
      expect(response.contentType).toContain("application/json");
      expect(typeof response.json()?.error).toBe("string");
    }
  });
});

describe("SPA content security policy (finding 19)", () => {
  test("serves a restrictive policy with a hashed bootstrap script", async () => {
    const response = await request("/books/abc/read");

    expect(response.status).toBe(200);
    expect(response.csp).toContain("default-src 'self'");
    expect(response.csp).toContain("script-src 'self' 'sha256-");
    expect(response.csp).toContain("img-src 'self' data:");
    expect(response.csp).toContain("object-src 'none'");
    expect(response.csp).toContain("frame-ancestors 'none'");
  });
});

describe("unmatched API paths (finding 10)", () => {
  test("answers a missing endpoint with a JSON 404", async () => {
    const response = await request("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.contentType).toContain("application/json");
    expect(response.json()).toEqual({ error: "No such API endpoint." });
  });

  test("covers methods a route does not define", async () => {
    // POST /api/books/:id matches no route; it used to fall through to the SPA.
    const response = await request("/api/books/some-id", { method: "POST" });

    expect(response.status).toBe(404);
    expect(response.contentType).toContain("application/json");
  });

  test("never serves the SPA shell in place of an API response", async () => {
    for (const url of ["/api/", "/api/books/x/y/z", "/api/settings/nope"]) {
      const response = await request(url);
      expect(response.contentType).not.toContain("text/html");
      expect(response.status).toBe(404);
    }
  });

  test("leaves non-API routes on the SPA catch-all", async () => {
    const response = await request("/books/abc/read");

    expect(response.status).toBe(200);
    expect(response.contentType).toContain("text/html");
    expect(response.body).toContain("spa");
  });

  test("keeps the health endpoint reachable", async () => {
    const response = await request("/api/health");

    expect(response.status).toBe(200);
    expect(response.json()).toHaveProperty("ok", true);
  });
});

describe("malformed asset paths (finding 11)", () => {
  test("treats a broken percent-escape as a miss rather than a fault", async () => {
    const response = await request("/assets/%");

    // decodeURIComponent throws on this; it used to escape as an uncaught 500.
    expect(response.status).toBe(404);
  });

  test("still refuses to walk out of the public directory", async () => {
    // Percent-encoded, because URL parsing collapses a literal "../" before the
    // app sees it — the encoded form is what actually reaches the guard.
    const response = await request("/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd");

    expect(response.status).toBe(404);
    expect(response.body).not.toContain("root:");
  });
});

describe("bounded streaming book imports (finding 17)", () => {
  test("rejects an oversized request before parsing multipart data", async () => {
    const response = await request("/api/books/import", {
      method: "POST",
      headers: {
        "Content-Length": String(Number.MAX_SAFE_INTEGER),
        "Content-Type": "multipart/form-data; boundary=oversized",
      },
      body: "--oversized--",
    });

    expect(response.status).toBe(413);
    expect(response.contentType).toContain("application/json");
    expect(response.json()).toEqual({ error: "The import request is too large." });
  });

  test("returns a duplicate result when identical imports overlap", async () => {
    const epub = await buildImportEpub();
    const importRequest = () => {
      const form = new FormData();
      form.append("files", new File([epub], "same.epub", { type: "application/epub+zip" }));
      return request("/api/books/import?bookshelfId=shelf-1", {
        method: "POST",
        body: form,
      });
    };

    const responses = await Promise.all([importRequest(), importRequest()]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);

    const statuses = responses
      .flatMap((response) => response.json()?.results as Array<{ status: string }>)
      .map((result) => result.status)
      .sort();
    expect(statuses).toEqual(["duplicate", "imported"]);
    expect(client.db.select().from(schema.books).all()).toHaveLength(1);
    expect(client.db.select().from(schema.bookShelves).all()).toHaveLength(1);
  });
});
