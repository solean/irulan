import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const testDirectory = mkdtempSync(path.join(os.tmpdir(), "irulan-app-tests-"));
const publicDirectory = path.join(testDirectory, "public");
process.env.EBOOK_DATA_DIR = path.join(testDirectory, "data");
process.env.EBOOK_STORAGE_DIR = path.join(testDirectory, "storage");
process.env.IRULAN_PUBLIC_DIR = publicDirectory;

// Dynamic: `appConfig` snapshots the environment at module evaluation, so these modules
// must not be hoisted above the overrides set immediately above.
const client = await import("./db/client");
const schema = await import("./db/schema");
const { app } = await import("./app");

await client.initializeDatabase();
client.ensureSchema();

// A stand-in for the built client, so the SPA catch-all has something to serve.
mkdirSync(publicDirectory, { recursive: true });
writeFileSync(
  path.join(publicDirectory, "index.html"),
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

beforeEach(() => {
  client.db.delete(schema.bookShelves).run();
  client.db.delete(schema.books).run();
  client.db.delete(schema.bookshelves).run();
  client.db
    .insert(schema.bookshelves)
    .values({ id: "shelf-1", name: "Shelf", kindleEmail: null, sortOrder: 0, createdAt: new Date() })
    .run();
  client.persistDatabase();
});

afterAll(() => {
  rmSync(testDirectory, { force: true, recursive: true });
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
