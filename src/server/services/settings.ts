import { eq } from "drizzle-orm";

import type {
  SettingsPayload,
  SmtpSettings,
  UpdateSmtpSettingsPayload,
} from "../../shared/types";
import { appConfig } from "../config";
import { db, persistDatabase } from "../db/client";
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
  persistDatabase();
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
  persistDatabase();
};

export const getSettingsPayload = (): SettingsPayload => ({
  defaultKindleEmail: getDefaultKindleEmail(),
  smtp: getSmtpSettings(),
});
