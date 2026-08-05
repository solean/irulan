/**
 * Test environment, applied before any test file is loaded.
 *
 * `appConfig` snapshots the environment once, at first import, and every file in a
 * `bun test` run shares one module registry — so whichever file imported the config
 * first decided where all of them read and wrote. Test files each set
 * `EBOOK_DATA_DIR`/`EBOOK_STORAGE_DIR` before a dynamic import and assumed they had
 * won that race, but `config.test.ts` imports the config statically with no overrides
 * at all, and Bun loads `.env` for test runs. When that import landed first the whole
 * suite ran against the developer's real library and deleted it.
 *
 * Preloading settles the race instead of racing: this file redirects storage to a
 * per-run temp directory and then imports the config itself, so the safe paths are
 * cached before any test file can ask for them. Test files no longer set these
 * variables; they read `appConfig` and get a temp directory.
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
