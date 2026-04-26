import { Hono } from "hono";
import { z } from "zod";

import { AppError, errorMessage } from "../errors";
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

const routeError = (error: unknown) => {
  if (error instanceof AppError) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (error instanceof z.ZodError) {
    return new Response(JSON.stringify({ error: error.issues[0]?.message ?? "Invalid request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  console.error(error);
  return new Response(JSON.stringify({ error: errorMessage(error) }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
};

export const settingsRoutes = new Hono();

settingsRoutes.get("/", (c) => c.json(getSettingsPayload()));

settingsRoutes.put("/", async (c) => {
  try {
    const body = await c.req.json();
    const payload = kindleSettingsSchema.parse(body);
    saveDefaultKindleEmail(payload.defaultKindleEmail || null);
    return c.json(getSettingsPayload());
  } catch (error) {
    return routeError(error);
  }
});

settingsRoutes.put("/smtp", async (c) => {
  try {
    const body = await c.req.json();
    const payload = smtpSettingsSchema.parse(body);
    saveSmtpSettings(payload);
    return c.json(getSettingsPayload());
  } catch (error) {
    return routeError(error);
  }
});

settingsRoutes.post("/test-email", async (c) => {
  try {
    const body = await c.req.json();
    const payload = testEmailSchema.parse(body);
    await sendTestEmail(payload.recipientEmail);
    return c.json({ ok: true });
  } catch (error) {
    return routeError(error);
  }
});
