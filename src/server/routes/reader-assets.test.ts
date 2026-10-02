import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";

vi.mock("../services/books", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/books")>();
  return {
    ...original,
    readBookReaderAsset: vi.fn(async () =>
      Buffer.from('<script>fetch("/api/books")</script>'),
    ),
  };
});

import { booksRoutes } from "./books";

const app = new Hono().route("/api/books", booksRoutes);

describe("untrusted EPUB asset responses", () => {
  test.each([
    ["chapter.xhtml", "application/xhtml+xml"],
    ["chapter.html", "text/html"],
    ["illustration.svg", "image/svg+xml"],
    ["document.xml", "application/xml"],
  ])("sandboxes direct navigation to %s", async (asset, contentType) => {
    const response = await app.request(`/api/books/book-1/read/OEBPS/${asset}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(contentType);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const directives = response.headers.get("Content-Security-Policy")?.split("; ");
    expect(directives).toContain("sandbox");
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("base-uri 'none'");
    expect(directives).toContain("form-action 'none'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives?.some((directive) => directive.startsWith("script-src"))).toBe(false);
  });

  test.each([
    ["styles.css", "text/css"],
    ["cover.png", "image/png"],
    ["font.woff2", "font/woff2"],
  ])("preserves reader fetches and the MIME type for %s", async (asset, contentType) => {
    const response = await app.request(`/api/books/book-1/read/OEBPS/${asset}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain(contentType);
    expect(await response.text()).toBe('<script>fetch("/api/books")</script>');
  });
});
