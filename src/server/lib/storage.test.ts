import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

// Storage is redirected to a temp directory by `src/test/setup.ts`, preloaded for the
// whole run, so these paths cannot resolve into a real library.
import { bookDirectory, sweepTrash, trashDirectory } from "./storage";

const trashRoot = trashDirectory();
const keptBook = bookDirectory("sweep-test-book");

beforeEach(() => {
  rmSync(trashRoot, { force: true, recursive: true });
  rmSync(keptBook, { force: true, recursive: true });
});

afterAll(() => {
  rmSync(trashRoot, { force: true, recursive: true });
  rmSync(keptBook, { force: true, recursive: true });
});

describe("sweepTrash (finding 26)", () => {
  test("removes trashed book directories left behind by an earlier run", async () => {
    const orphan = path.join(trashRoot, "book-1-1700000000000");
    mkdirSync(path.join(orphan, "reader"), { recursive: true });
    writeFileSync(path.join(orphan, "original.epub"), "epub bytes");
    writeFileSync(path.join(orphan, "reader", "index.xhtml"), "<html></html>");

    const second = path.join(trashRoot, "book-2-1700000000001");
    mkdirSync(second, { recursive: true });

    expect(await sweepTrash()).toBe(2);
    expect(existsSync(orphan)).toBe(false);
    expect(existsSync(second)).toBe(false);
    expect(existsSync(trashRoot)).toBe(true);
  });

  test("leaves the rest of the library alone", async () => {
    mkdirSync(keptBook, { recursive: true });
    writeFileSync(path.join(keptBook, "original.epub"), "epub bytes");
    mkdirSync(trashRoot, { recursive: true });

    expect(await sweepTrash()).toBe(0);
    expect(existsSync(path.join(keptBook, "original.epub"))).toBe(true);
  });

  test("is a no-op when nothing has ever been deleted", async () => {
    expect(existsSync(trashRoot)).toBe(false);
    expect(await sweepTrash()).toBe(0);
  });
});
