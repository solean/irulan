import path from "node:path";

const env = process.env;
const rootDir = path.resolve(env.IRULAN_ROOT_DIR ?? process.cwd());

const resolveFromRoot = (value: string | undefined, fallback: string) =>
  path.resolve(rootDir, value ?? fallback);

/**
 * Read a numeric setting from the environment.
 *
 * A blank value means "not set". `Number("")` is 0, not NaN, so a bare `PORT=`
 * in .env used to bind a random port and `WEB_PORT=` produced a localhost:0
 * CORS origin instead of falling back.
 *
 * Exported for tests: this module reads the environment once at import, so the
 * parsing rules cannot be exercised through `appConfig`.
 */
export const parseNumber = (value: string | undefined, fallback: number, label: string) => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return parsed;
};

/** Port 0 is kept legal: the Electron shell sets `PORT=0` to get a free port. */
export const parsePort = (value: string | undefined, fallback: number, label: string) => {
  const parsed = parseNumber(value, fallback, label);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`${label} must be a whole number between 0 and 65535.`);
  }

  return parsed;
};

const port = parsePort(env.PORT, 8787, "PORT");
const webPort = parsePort(env.WEB_PORT, 5173, "WEB_PORT");
const smtpPort = parsePort(env.SMTP_PORT, 587, "SMTP_PORT");
const serverIdleTimeout = parseNumber(
  env.SERVER_IDLE_TIMEOUT_SECONDS,
  120,
  "SERVER_IDLE_TIMEOUT_SECONDS",
);

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
