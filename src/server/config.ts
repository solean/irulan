import path from "node:path";

const env = process.env;
const rootDir = path.resolve(env.IRULAN_ROOT_DIR ?? process.cwd());

const resolveFromRoot = (value: string | undefined, fallback: string) =>
  path.resolve(rootDir, value ?? fallback);

const parseNumber = (value: string | undefined, fallback: number, label: string) => {
  const parsed = Number(value ?? fallback);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return parsed;
};

const port = Number(env.PORT ?? 8787);
const webPort = parseNumber(env.WEB_PORT, 5173, "WEB_PORT");
const smtpPort = parseNumber(env.SMTP_PORT, 587, "SMTP_PORT");
const serverIdleTimeout = parseNumber(
  env.SERVER_IDLE_TIMEOUT_SECONDS,
  120,
  "SERVER_IDLE_TIMEOUT_SECONDS",
);

if (Number.isNaN(port)) {
  throw new Error("PORT must be a valid number.");
}

if (serverIdleTimeout <= 0) {
  throw new Error("SERVER_IDLE_TIMEOUT_SECONDS must be greater than 0.");
}

const smtpFrom = env.SMTP_FROM?.trim() || null;
const smtpHost = env.SMTP_HOST?.trim() || null;

export const appConfig = {
  env: env.NODE_ENV ?? "development",
  isProduction: (env.NODE_ENV ?? "development") === "production",
  rootDir,
  port,
  webPort,
  serverIdleTimeout,
  webOrigins: [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`],
  dataDir: resolveFromRoot(env.EBOOK_DATA_DIR, "./data"),
  storageDir: resolveFromRoot(env.EBOOK_STORAGE_DIR, "./storage"),
  publicDir: path.resolve(env.IRULAN_PUBLIC_DIR ?? path.join(rootDir, "dist/client")),
  dbPath: path.join(resolveFromRoot(env.EBOOK_DATA_DIR, "./data"), "app.db"),
  smtp: {
    host: smtpHost,
    port: smtpPort,
    secure: (env.SMTP_SECURE ?? "").toLowerCase() === "true" || smtpPort === 465,
    user: env.SMTP_USER?.trim() || null,
    pass: env.SMTP_PASS?.trim() || null,
    from: smtpFrom,
    configured: Boolean(smtpHost && smtpFrom),
  },
};
