/**
 * Test environment, applied before each test file is loaded.
 *
 * `appConfig` snapshots the environment once, at first import, so whichever module
 * imported the config first decides where everything downstream of it reads and
 * writes. Test files each used to set `EBOOK_DATA_DIR`/`EBOOK_STORAGE_DIR` before a
 * dynamic import and assume they had won that race, but `config.test.ts` imports the
 * config statically with no overrides at all, and `.env` is loaded for test runs. When
 * that import landed first the whole suite ran against the developer's real library
 * and deleted it.
 *
 * vitest runs this file as a `setupFiles` entry, which means once per test FILE,
 * sharing that file's module registry and running before its imports are evaluated.
 * That is stricter than the single shared preload it replaces: every file redirects
 * storage to its own temp root and then imports the config itself, so the safe paths
 * are cached before the file under test can ask for them, and no file can inherit a
 * config another file resolved. Test files do not set these variables; they read
 * `appConfig` and get a temp directory.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const testRoot = mkdtempSync(path.join(os.tmpdir(), "irulan-tests-"));

process.env.EBOOK_DATA_DIR = path.join(testRoot, "data");
process.env.EBOOK_STORAGE_DIR = path.join(testRoot, "storage");
process.env.IRULAN_PUBLIC_DIR = path.join(testRoot, "public");

// An `SMTP_PASS` inherited from `.env` would make the settings tests exercise
// environment-supplied credentials instead of the app-managed ones they assert on.
delete process.env.SMTP_PASS;

const { appConfig } = await import("../server/config");

// A suite that writes outside its temp root has already lost; say so before it runs.
for (const [name, value] of [
  ["dataDir", appConfig.dataDir],
  ["storageDir", appConfig.storageDir],
  ["dbPath", appConfig.dbPath],
  ["publicDir", appConfig.publicDir],
] as const) {
  if (value !== testRoot && !value.startsWith(`${testRoot}${path.sep}`)) {
    throw new Error(
      `Test setup failed: appConfig.${name} resolved to ${value}, outside the test root ${testRoot}. ` +
        "Refusing to run tests against a real library.",
    );
  }
}

process.on("exit", () => {
  rmSync(testRoot, { force: true, recursive: true });
});
