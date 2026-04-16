import path from "node:path";

const rootDir = process.cwd();

const resolveFromRoot = (value: string | undefined, fallback: string) =>
  path.resolve(rootDir, value ?? fallback);

const parseNumber = (value: string | undefined, fallback: number, label: string) => {
  const parsed = Number(value ?? fallback);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return parsed;
};

const port = Number(Bun.env.PORT ?? 8787);
const webPort = parseNumber(Bun.env.WEB_PORT, 5173, "WEB_PORT");
const smtpPort = parseNumber(Bun.env.SMTP_PORT, 587, "SMTP_PORT");

if (Number.isNaN(port)) {
  throw new Error("PORT must be a valid number.");
}

const smtpFrom = Bun.env.SMTP_FROM?.trim() || null;
const smtpHost = Bun.env.SMTP_HOST?.trim() || null;

export const appConfig = {
  env: Bun.env.NODE_ENV ?? "development",
  isProduction: (Bun.env.NODE_ENV ?? "development") === "production",
  rootDir,
  port,
  webPort,
  webOrigins: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`],
  dataDir: resolveFromRoot(Bun.env.EBOOK_DATA_DIR, "./data"),
  storageDir: resolveFromRoot(Bun.env.EBOOK_STORAGE_DIR, "./storage"),
  publicDir: path.join(rootDir, "dist/client"),
  dbPath: path.join(resolveFromRoot(Bun.env.EBOOK_DATA_DIR, "./data"), "app.db"),
  smtp: {
    host: smtpHost,
    port: smtpPort,
    secure: (Bun.env.SMTP_SECURE ?? "").toLowerCase() === "true" || smtpPort === 465,
    user: Bun.env.SMTP_USER?.trim() || null,
    pass: Bun.env.SMTP_PASS?.trim() || null,
    from: smtpFrom,
    configured: Boolean(smtpHost && smtpFrom),
  },
};
