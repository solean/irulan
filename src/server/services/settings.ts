import { eq } from "drizzle-orm";

import { SettingsPayload } from "../../shared/types";
import { appConfig } from "../config";
import { db } from "../db/client";
import { settings } from "../db/schema";

const DEFAULT_KINDLE_KEY = "default_kindle_email";

const readSetting = (key: string) =>
  db.select().from(settings).where(eq(settings.key, key)).get() ?? null;

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

export const getSettingsPayload = (): SettingsPayload => ({
  defaultKindleEmail: getDefaultKindleEmail(),
  smtpConfigured: appConfig.smtp.configured,
  smtpFrom: appConfig.smtp.from,
});
