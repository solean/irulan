import path from "node:path";

import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { Hono } from "hono";

import { appConfig } from "./config";
import { booksRoutes } from "./routes/books";
import { settingsRoutes } from "./routes/settings";

export const app = new Hono();

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

app.get("/assets/*", serveStatic({ root: "./dist/client" }));

app.get("*", async (c) => {
  const indexPath = path.join(appConfig.publicDir, "index.html");
  const indexFile = Bun.file(indexPath);

  if (await indexFile.exists()) {
    return new Response(indexFile, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

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
});
