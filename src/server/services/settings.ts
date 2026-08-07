import { eq } from "drizzle-orm";

import type {
  DatabaseRecovery,
  SettingsPayload,
  SmtpSettings,
  UpdateSmtpSettingsPayload,
} from "../../shared/types";
import { appConfig } from "../config";
import { db, getPendingDatabaseRecovery, setPendingDatabaseRecovery } from "../db/client";
import { settings } from "../db/schema";
import { AppError } from "../errors";
import {
  encryptSmtpPassword,
  getSmtpPasswordSource,
  hasStoredSmtpPassword,
  resolveSmtpPassword,
  SMTP_PASSWORD_KEY,
} from "./smtp-credentials";

const DEFAULT_KINDLE_KEY = "default_kindle_email";
const DATABASE_RECOVERY_KEY = "database_recovery";

/**
 * A missing primary is recovered from the `.bak` file at startup and announced
 * with a `console.warn`; only a corrupt primary earns a notice the user has to
 * acknowledge. Surfacing every recovery would train people to dismiss the one
 * that matters.
 */
const USER_VISIBLE_RECOVERY_REASONS: ReadonlySet<DatabaseRecovery["reason"]> = new Set([
  "primary-corrupt",
]);

const SMTP_SETTING_KEYS = {
  host: "smtp_host",
  port: "smtp_port",
  secure: "smtp_secure",
  user: "smtp_user",
  from: "smtp_from",
} as const;

const readSetting = (key: string) =>
  db.select().from(settings).where(eq(settings.key, key)).get() ?? null;

const normalizeText = (value: string | null | undefined) => value?.trim() ?? "";

const parseStoredPort = (value: string | null) => {
  if (!value) return 587;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 587;
};

const parseStoredSecure = (value: string | null, port: number) => {
  if (value === null) return port === 465;
  return value === "true";
};

const hasStoredSmtpSettings = () =>
  Object.values(SMTP_SETTING_KEYS).some((key) => readSetting(key) !== null);

export const getDefaultKindleEmail = () => {
  const value = readSetting(DEFAULT_KINDLE_KEY)?.value?.trim();
  return value ? value : null;
};

export const saveDefaultKindleEmail = (email: string | null) => {
  const nextValue = email?.trim() ?? "";

  db.insert(settings)
    .values({ key: DEFAULT_KINDLE_KEY, value: nextValue })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: nextValue },
    })
    .run();
};

const getEnvironmentSmtpSettings = (): SmtpSettings => {
  const passwordSource = getSmtpPasswordSource(appConfig.smtp.pass);
  return {
    host: appConfig.smtp.host ?? "",
    port: appConfig.smtp.port,
    secure: appConfig.smtp.secure,
    user: appConfig.smtp.user ?? "",
    from: appConfig.smtp.from ?? "",
    hasPassword: passwordSource !== "none",
    passwordSource,
    configured: Boolean(appConfig.smtp.host && appConfig.smtp.from),
    source: "environment",
  };
};

const getStoredSmtpSettings = (): SmtpSettings => {
  const host = normalizeText(readSetting(SMTP_SETTING_KEYS.host)?.value ?? null);
  const port = parseStoredPort(readSetting(SMTP_SETTING_KEYS.port)?.value ?? null);
  const secure = parseStoredSecure(readSetting(SMTP_SETTING_KEYS.secure)?.value ?? null, port);
  const user = normalizeText(readSetting(SMTP_SETTING_KEYS.user)?.value ?? null);
  const from = normalizeText(readSetting(SMTP_SETTING_KEYS.from)?.value ?? null);
  const passwordSource = getSmtpPasswordSource(appConfig.smtp.pass);

  return {
    host,
    port,
    secure,
    user,
    from,
    hasPassword: passwordSource !== "none",
    passwordSource,
    configured: Boolean(host && from),
    source: "app",
  };
};

export const getSmtpSettings = (): SmtpSettings =>
  hasStoredSmtpSettings() ? getStoredSmtpSettings() : getEnvironmentSmtpSettings();

export const getSmtpPassword = () => resolveSmtpPassword(appConfig.smtp.pass);

export const saveSmtpSettings = (smtp: UpdateSmtpSettingsPayload) => {
  if (smtp.clearPassword && !hasStoredSmtpPassword()) {
    throw new AppError(400, "There is no saved app password to clear.");
  }

  const encryptedPassword = smtp.password ? encryptSmtpPassword(smtp.password) : null;
  const values = [
    [SMTP_SETTING_KEYS.host, normalizeText(smtp.host)],
    [SMTP_SETTING_KEYS.port, String(smtp.port)],
    [SMTP_SETTING_KEYS.secure, smtp.secure ? "true" : "false"],
    [SMTP_SETTING_KEYS.user, normalizeText(smtp.user)],
    [SMTP_SETTING_KEYS.from, normalizeText(smtp.from)],
  ] as const;

  db.transaction((tx) => {
    if (smtp.clearPassword) {
      tx.delete(settings).where(eq(settings.key, SMTP_PASSWORD_KEY)).run();
    } else if (encryptedPassword) {
      tx.insert(settings)
        .values({ key: SMTP_PASSWORD_KEY, value: encryptedPassword })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: encryptedPassword },
        })
        .run();
    }

    for (const [key, value] of values) {
      tx.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value },
        })
        .run();
    }
  });
};

const parseRecoveryRecord = (value: string): DatabaseRecovery | null => {
  try {
    const parsed = JSON.parse(value) as DatabaseRecovery;
    return USER_VISIBLE_RECOVERY_REASONS.has(parsed.reason) ? parsed : null;
  } catch {
    // A hand-edited or truncated row must not take the whole settings payload
    // down with it; losing the notice is the lesser failure.
    return null;
  }
};

/**
 * Store a recovery so the notice survives a restart.
 *
 * Called once at startup, after `ensureSchema` has created the table. Best
 * effort: a library that just came back from its backup is worth more than the
 * notice about it, so a failed write leaves the record parked in memory for
 * `getDatabaseRecovery` to read through to, rather than aborting the boot.
 */
export const recordDatabaseRecovery = (recovery: DatabaseRecovery | null) => {
  if (!recovery || !USER_VISIBLE_RECOVERY_REASONS.has(recovery.reason)) {
    return;
  }

  const value = JSON.stringify(recovery);

  try {
    db.insert(settings)
      .values({ key: DATABASE_RECOVERY_KEY, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
    setPendingDatabaseRecovery(null);
  } catch (error) {
    console.error("The database recovery notice could not be stored.", error);
  }
};

/**
 * Prefers the stored record, falling back to one still parked in memory — the
 * write in `recordDatabaseRecovery` can fail on a database that has only just
 * come back from its backup, which is exactly when the notice matters.
 */
export const getDatabaseRecovery = (): DatabaseRecovery | null => {
  const stored = readSetting(DATABASE_RECOVERY_KEY);
  if (stored) {
    return parseRecoveryRecord(stored.value);
  }

  const pending = getPendingDatabaseRecovery();
  return pending && USER_VISIBLE_RECOVERY_REASONS.has(pending.reason) ? pending : null;
};

/**
 * Acknowledge one specific recovery.
 *
 * Keyed on `recoveredAt` rather than a plain "dismissed" flag: a later recovery
 * writes a new record with a new timestamp, so it surfaces again instead of
 * being swallowed by an acknowledgement from months ago.
 */
export const acknowledgeDatabaseRecovery = (recoveredAt: string) => {
  const current = getDatabaseRecovery();
  if (!current || current.recoveredAt !== recoveredAt) {
    return;
  }

  setPendingDatabaseRecovery(null);
  db.delete(settings).where(eq(settings.key, DATABASE_RECOVERY_KEY)).run();
};

export const getSettingsPayload = (): SettingsPayload => ({
  defaultKindleEmail: getDefaultKindleEmail(),
  smtp: getSmtpSettings(),
  databaseRecovery: getDatabaseRecovery(),
});
