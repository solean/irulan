import { eq } from "drizzle-orm";

import { SettingsPayload, SmtpSettings } from "../../shared/types";
import { appConfig } from "../config";
import { db, persistDatabase } from "../db/client";
import { settings } from "../db/schema";

const DEFAULT_KINDLE_KEY = "default_kindle_email";
const SMTP_SETTING_KEYS = {
  host: "smtp_host",
  port: "smtp_port",
  secure: "smtp_secure",
  user: "smtp_user",
  pass: "smtp_pass",
  from: "smtp_from",
} as const;

const readSetting = (key: string) =>
  db.select().from(settings).where(eq(settings.key, key)).get() ?? null;

const writeSetting = (key: string, value: string) => {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
  persistDatabase();
};

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

const getEnvironmentSmtpSettings = (): SmtpSettings => ({
  host: appConfig.smtp.host ?? "",
  port: appConfig.smtp.port,
  secure: appConfig.smtp.secure,
  user: appConfig.smtp.user ?? "",
  pass: appConfig.smtp.pass ?? "",
  from: appConfig.smtp.from ?? "",
  configured: Boolean(appConfig.smtp.host && appConfig.smtp.from),
  source: "environment",
});

const getStoredSmtpSettings = (): SmtpSettings => {
  const host = normalizeText(readSetting(SMTP_SETTING_KEYS.host)?.value ?? null);
  const port = parseStoredPort(readSetting(SMTP_SETTING_KEYS.port)?.value ?? null);
  const secure = parseStoredSecure(readSetting(SMTP_SETTING_KEYS.secure)?.value ?? null, port);
  const user = normalizeText(readSetting(SMTP_SETTING_KEYS.user)?.value ?? null);
  const pass = readSetting(SMTP_SETTING_KEYS.pass)?.value ?? "";
  const from = normalizeText(readSetting(SMTP_SETTING_KEYS.from)?.value ?? null);

  return {
    host,
    port,
    secure,
    user,
    pass,
    from,
    configured: Boolean(host && from),
    source: "app",
  };
};

export const getSmtpSettings = (): SmtpSettings =>
  hasStoredSmtpSettings() ? getStoredSmtpSettings() : getEnvironmentSmtpSettings();

export const saveSmtpSettings = (smtp: Omit<SmtpSettings, "configured" | "source">) => {
  writeSetting(SMTP_SETTING_KEYS.host, normalizeText(smtp.host));
  writeSetting(SMTP_SETTING_KEYS.port, String(smtp.port));
  writeSetting(SMTP_SETTING_KEYS.secure, smtp.secure ? "true" : "false");
  writeSetting(SMTP_SETTING_KEYS.user, normalizeText(smtp.user));
  writeSetting(SMTP_SETTING_KEYS.pass, smtp.pass);
  writeSetting(SMTP_SETTING_KEYS.from, normalizeText(smtp.from));
};

export const getSettingsPayload = (): SettingsPayload => ({
  defaultKindleEmail: getDefaultKindleEmail(),
  smtp: getSmtpSettings(),
});
