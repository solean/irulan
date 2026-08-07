import { afterEach, describe, expect, test } from "vitest";

import type { DatabaseRecovery } from "../../shared/types";
// Storage is redirected to a temp directory by `src/test/setup.ts`, which runs before
// this file's imports, so these are plain static ones and `appConfig` is already safe.
import * as client from "../db/client";
import { settings } from "../db/schema";
import {
  acknowledgeDatabaseRecovery,
  getDatabaseRecovery,
  getSettingsPayload,
  recordDatabaseRecovery,
} from "./settings";

await client.initializeDatabase();
client.ensureSchema();

const recovery = (overrides: Partial<DatabaseRecovery> = {}): DatabaseRecovery => ({
  reason: "primary-corrupt",
  backupModifiedAt: "2026-08-01T10:00:00.000Z",
  recoveredAt: "2026-08-01T10:05:00.000Z",
  ...overrides,
});

afterEach(() => {
  client.setPendingDatabaseRecovery(null);
  client.db.delete(settings).run();
});

describe("database recovery notice", () => {
  test("is absent when nothing was recovered", () => {
    expect(getSettingsPayload().databaseRecovery).toBeNull();
  });

  test("reaches the settings payload once a corrupt primary is recorded", () => {
    const record = recovery();
    recordDatabaseRecovery(record);

    expect(getSettingsPayload().databaseRecovery).toEqual(record);
  });

  test("stays quiet for a missing primary", () => {
    // A crash between rotateBackup and the rename costs one save cycle. Showing
    // the same alarm as real corruption would train people to dismiss both.
    recordDatabaseRecovery(recovery({ reason: "primary-missing" }));

    expect(getDatabaseRecovery()).toBeNull();
    expect(client.db.select().from(settings).all()).toEqual([]);
  });

  test("survives a reload from disk", () => {
    recordDatabaseRecovery(recovery());

    // Reading the record back through the settings table, not the in-memory pending
    // slot, proves the notice was actually stored.
    expect(getDatabaseRecovery()).toEqual(recovery());
  });

  test("is cleared by an acknowledgement naming that recovery", () => {
    recordDatabaseRecovery(recovery());

    acknowledgeDatabaseRecovery(recovery().recoveredAt);

    expect(getDatabaseRecovery()).toBeNull();
  });

  test("ignores an acknowledgement for a different recovery", () => {
    // The whole point of keying on the timestamp: a stale acknowledgement must
    // never swallow a later, unseen data-loss event.
    recordDatabaseRecovery(recovery({ recoveredAt: "2026-08-04T09:00:00.000Z" }));

    acknowledgeDatabaseRecovery("2026-01-01T00:00:00.000Z");

    expect(getDatabaseRecovery()?.recoveredAt).toBe("2026-08-04T09:00:00.000Z");
  });

  test("surfaces a recovery that could not be stored", () => {
    // Recovery from backup happens at the exact moment writing to disk is what is
    // failing, so the record only exists in memory.
    client.setPendingDatabaseRecovery(recovery());

    expect(getDatabaseRecovery()).toEqual(recovery());
  });

  test("ignores an unparseable stored record", () => {
    client.db.insert(settings).values({ key: "database_recovery", value: "{oops" }).run();

    expect(getSettingsPayload().databaseRecovery).toBeNull();
  });
});
