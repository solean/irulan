import { afterAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "../app";
import * as client from "../db/client";
import { books, readerAnnotations, readerBookmarks } from "../db/schema";

await client.initializeDatabase();
client.ensureSchema();

const BOOK_ID = "reader-tools-book";
const OTHER_BOOK_ID = "reader-tools-other-book";
const location = {
  sectionHref: "OEBPS/chapter-1.xhtml",
  textVersion: 1 as const,
  offset: 12,
  prefix: "Opening text",
  suffix: "Selected passage continues",
};
const range = {
  ...location,
  offset: 13,
  endOffset: 29,
  exact: "Selected passage",
};

const request = (path: string, method = "GET", payload?: unknown) =>
  app.fetch(
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: payload === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  );

beforeEach(() => {
  client.db.delete(readerAnnotations).run();
  client.db.delete(readerBookmarks).run();
  client.db.delete(books).run();
  client.db
    .insert(books)
    .values([
      {
        id: BOOK_ID,
        title: "Reader Tools",
        author: "Test Author",
        filePath: "/tmp/reader-tools.epub",
        coverPath: null,
        fileHash: "reader-tools-hash",
        sourceFilename: "reader-tools.epub",
        fileSizeBytes: 100,
        importedAt: new Date("2026-08-12T10:00:00.000Z"),
      },
      {
        id: OTHER_BOOK_ID,
        title: "Other Book",
        author: "Test Author",
        filePath: "/tmp/reader-tools-other.epub",
        coverPath: null,
        fileHash: "reader-tools-other-hash",
        sourceFilename: "reader-tools-other.epub",
        fileSizeBytes: 100,
        importedAt: new Date("2026-08-12T10:00:00.000Z"),
      },
    ])
    .run();
});

afterAll(() => {
  client.closeDatabase();
});

describe("reader bookmarks", () => {
  test("creates, lists, renames, and deletes a stable location", async () => {
    const createdResponse = await request(`/api/books/${BOOK_ID}/bookmarks`, "POST", {
      label: "  Important turn  ",
      location,
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).bookmark;
    expect(created).toMatchObject({
      bookId: BOOK_ID,
      label: "Important turn",
      location,
    });
    expect(created.createdAt).toMatch(/^2026-|^20\d\d-/);

    const listedResponse = await request(`/api/books/${BOOK_ID}/bookmarks`);
    expect(listedResponse.status).toBe(200);
    expect((await listedResponse.json()).bookmarks).toEqual([created]);

    const renamedResponse = await request(
      `/api/books/${BOOK_ID}/bookmarks/${created.id}`,
      "PATCH",
      { label: "Renamed" },
    );
    expect(renamedResponse.status).toBe(200);
    expect((await renamedResponse.json()).bookmark).toMatchObject({
      id: created.id,
      label: "Renamed",
      location,
    });

    const otherBookResponse = await request(
      `/api/books/${OTHER_BOOK_ID}/bookmarks/${created.id}`,
      "PATCH",
      { label: "Wrong book" },
    );
    expect(otherBookResponse.status).toBe(404);

    const deletedResponse = await request(
      `/api/books/${BOOK_ID}/bookmarks/${created.id}`,
      "DELETE",
    );
    expect(deletedResponse.status).toBe(200);
    expect(await deletedResponse.json()).toEqual({ deletion: { id: created.id } });
    expect(client.db.select().from(readerBookmarks).all()).toEqual([]);
  });

  test("rejects layout-dependent and malformed locations", async () => {
    const withPage = await request(`/api/books/${BOOK_ID}/bookmarks`, "POST", {
      location: { ...location, page: 4 },
    });
    expect(withPage.status).toBe(400);

    const withoutContext = await request(`/api/books/${BOOK_ID}/bookmarks`, "POST", {
      location: { ...location, prefix: "", suffix: "" },
    });
    expect(withoutContext.status).toBe(400);
  });
});

describe("reader annotations", () => {
  test("persists the quote, colour, and optional note and allows edits", async () => {
    const createdResponse = await request(`/api/books/${BOOK_ID}/annotations`, "POST", {
      range,
      color: "yellow",
      note: "  Remember this.  ",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).annotation;
    expect(created).toMatchObject({
      bookId: BOOK_ID,
      range,
      color: "yellow",
      note: "Remember this.",
    });

    const updatedResponse = await request(
      `/api/books/${BOOK_ID}/annotations/${created.id}`,
      "PATCH",
      { color: "blue", note: null },
    );
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).annotation).toMatchObject({
      id: created.id,
      color: "blue",
      note: null,
      range,
    });

    const listedResponse = await request(`/api/books/${BOOK_ID}/annotations`);
    expect(listedResponse.status).toBe(200);
    expect((await listedResponse.json()).annotations).toHaveLength(1);

    const deletedResponse = await request(
      `/api/books/${BOOK_ID}/annotations/${created.id}`,
      "DELETE",
    );
    expect(deletedResponse.status).toBe(200);
    expect(client.db.select().from(readerAnnotations).all()).toEqual([]);
  });

  test("rejects ranges whose quote and offsets disagree", async () => {
    const response = await request(`/api/books/${BOOK_ID}/annotations`, "POST", {
      range: { ...range, endOffset: range.endOffset + 1 },
      color: "green",
    });
    expect(response.status).toBe(400);
  });
});
