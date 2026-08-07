import { eq } from "drizzle-orm";

import type { SmtpPasswordSource } from "../../shared/types";
import { appConfig } from "../config";
import { db } from "../db/client";
import { settings } from "../db/schema";
import { AppError } from "../errors";

const LEGACY_PASSWORD_KEY = "smtp_pass";
export const SMTP_PASSWORD_KEY = "smtp_pass_encrypted";

type ElectronSafeStorage = {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

const readSetting = (key: string) =>
  db.select().from(settings).where(eq(settings.key, key)).get() ?? null;

const getElectronSafeStorage = (): ElectronSafeStorage | null =>
  (globalThis as typeof globalThis & { irulanSafeStorage?: ElectronSafeStorage })
    .irulanSafeStorage ?? null;

const getAvailableSafeStorage = () => {
  const safeStorage = getElectronSafeStorage();
  return safeStorage?.isEncryptionAvailable() ? safeStorage : null;
};

export const hasStoredSmtpPassword = () => readSetting(SMTP_PASSWORD_KEY) !== null;

export const getSmtpPasswordSource = (
  environmentPassword: string | null,
): SmtpPasswordSource => {
  const hasStoredPassword = hasStoredSmtpPassword();
  if (hasStoredPassword && getAvailableSafeStorage()) return "app";
  if (environmentPassword) return "environment";
  return hasStoredPassword ? "app" : "none";
};

export const encryptSmtpPassword = (password: string) => {
  const safeStorage = getAvailableSafeStorage();
  if (!safeStorage) {
    throw new AppError(
      503,
      "Secure password storage is unavailable. Configure SMTP_PASS in the environment instead.",
    );
  }

  return safeStorage.encryptString(password).toString("base64");
};

export const resolveSmtpPassword = (environmentPassword: string | null): string | null => {
  const value = readSetting(SMTP_PASSWORD_KEY)?.value;
  if (!value) return environmentPassword;

  const safeStorage = getAvailableSafeStorage();
  if (!safeStorage) {
    if (environmentPassword) return environmentPassword;
    throw new AppError(
      503,
      "The saved SMTP password requires Electron secure storage. Configure SMTP_PASS in the environment or open the Electron app.",
    );
  }

  try {
    return safeStorage.decryptString(Buffer.from(value, "base64"));
  } catch (error) {
    if (environmentPassword) return environmentPassword;
    throw new AppError(
      500,
      `The stored SMTP password could not be decrypted: ${error instanceof Error ? error.message : "unknown error"}.`,
    );
  }
};

/**
 * Move the pre-Keychain password out of SQLite before the server starts serving
 * settings. With an environment password, standalone mode can safely discard
 * the obsolete plaintext row instead of forcing an impossible Electron migration.
 */
export const migrateLegacySmtpPassword = (
  environmentPassword: string | null = appConfig.smtp.pass,
) => {
  const legacy = readSetting(LEGACY_PASSWORD_KEY)?.value;
  if (legacy === undefined) return;

  const safeStorage = getAvailableSafeStorage();
  if (!safeStorage && legacy && !environmentPassword) {
    throw new AppError(
      503,
      "A plaintext SMTP password needs to be migrated by the Electron app or replaced with SMTP_PASS in the environment.",
    );
  }

  const encrypted =
    safeStorage && legacy ? safeStorage.encryptString(legacy).toString("base64") : null;
  db.transaction((tx) => {
    if (encrypted) {
      tx.insert(settings)
        .values({ key: SMTP_PASSWORD_KEY, value: encrypted })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: encrypted },
        })
        .run();
    }
    tx.delete(settings).where(eq(settings.key, LEGACY_PASSWORD_KEY)).run();
  });
};
