import { readFile } from "node:fs/promises";
import path from "node:path";

import { cors } from "hono/cors";
import { Hono } from "hono";

import { appConfig } from "./config";
import { booksRoutes } from "./routes/books";
import { settingsRoutes } from "./routes/settings";

export const app = new Hono();

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const responseForFile = async (filePath: string) => {
  const bytes = await readFile(filePath);
  const contentType = contentTypes[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";

  return new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};

const resolvePublicPath = (requestPath: string) => {
  const relativePath = decodeURIComponent(requestPath.replace(/^\/+/, ""));
  const filePath = path.resolve(appConfig.publicDir, relativePath);
  const publicRoot = path.resolve(appConfig.publicDir);

  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    return null;
  }

  return filePath;
};

app.use(
  "/api/*",
  cors({
    origin: appConfig.webOrigins,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE"],
  }),
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    env: appConfig.env,
  }),
);

app.route("/api/books", booksRoutes);
app.route("/api/settings", settingsRoutes);

app.get("/assets/*", async (c) => {
  const filePath = resolvePublicPath(c.req.path);
  if (!filePath) {
    return c.notFound();
  }

  try {
    return await responseForFile(filePath);
  } catch {
    return c.notFound();
  }
});

app.get("*", async (c) => {
  const indexPath = path.join(appConfig.publicDir, "index.html");

  try {
    const bytes = await readFile(indexPath);
    return new Response(bytes, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    return c.html(
      [
        "<!doctype html>",
        "<html><body style='font-family:system-ui;padding:32px'>",
        "<h1>Frontend not built</h1>",
        "<p>Run <code>bun run dev</code> for local development or <code>bun run build</code> before <code>bun run start</code>.</p>",
        "</body></html>",
      ].join(""),
      404,
    );
  }
});
