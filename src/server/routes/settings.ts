import { Hono } from "hono";
import { z } from "zod";

import {
  getSettingsPayload,
  saveDefaultKindleEmail,
  saveSmtpSettings,
} from "../services/settings";
import { sendTestEmail } from "../services/delivery";

const kindleSettingsSchema = z.object({
  defaultKindleEmail: z.string().trim().email().or(z.literal("")).nullable(),
});

const smtpSettingsSchema = z.object({
  host: z.string().trim(),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string(),
  pass: z.string(),
  from: z.string().trim().email().or(z.literal("")),
});

const testEmailSchema = z.object({
  recipientEmail: z.string().trim().email(),
});

export const settingsRoutes = new Hono();

settingsRoutes.get("/", (c) => c.json(getSettingsPayload()));

settingsRoutes.put("/", async (c) => {
  const payload = kindleSettingsSchema.parse(await c.req.json());
  saveDefaultKindleEmail(payload.defaultKindleEmail || null);
  return c.json(getSettingsPayload());
});

settingsRoutes.put("/smtp", async (c) => {
  saveSmtpSettings(smtpSettingsSchema.parse(await c.req.json()));
  return c.json(getSettingsPayload());
});

settingsRoutes.post("/test-email", async (c) => {
  const payload = testEmailSchema.parse(await c.req.json());
  await sendTestEmail(payload.recipientEmail);
  return c.json({ ok: true });
});
