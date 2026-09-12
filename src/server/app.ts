import { readFile } from "node:fs/promises";
import path from "node:path";

import { Hono } from "hono";

import { contentSecurityPolicy } from "../security/csp";
import { appConfig } from "./config";
import { AppError, toErrorResponse } from "./errors";
import { booksRoutes } from "./routes/books";
import { bookshelvesRoutes } from "./routes/bookshelves";
import { libraryRoutes } from "./routes/library";
import { settingsRoutes } from "./routes/settings";
import { readerToolsRoutes } from "./routes/reader-tools";
import { isLibraryRestoreInProgress } from "./services/library-backup";

export const app = new Hono();

const cspHeaders = { "Content-Security-Policy": contentSecurityPolicy() };

// One place to turn a thrown error into a response, for this app and every
// router mounted on it. Handlers throw; they no longer each carry a copy of the
// same try/catch, and one that forgets can no longer answer a deliberate 404
// with a plain-text 500.

app.use("/api/*", async (_c, next) => {
  if (isLibraryRestoreInProgress()) {
    throw new AppError(503, "The library is being restored. Try again when it finishes.");
  }
  await next();
});
app.onError((error) => toErrorResponse(error));

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
  let relativePath: string;

  try {
    relativePath = decodeURIComponent(requestPath.replace(/^\/+/, ""));
  } catch {
    // A malformed percent-escape ("/assets/%") is a request for a file that
    // cannot exist, not a server fault.
    return null;
  }

  const filePath = path.resolve(appConfig.publicDir, relativePath);
  const publicRoot = path.resolve(appConfig.publicDir);

  if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
    return null;
  }

  return filePath;
};

// No CORS middleware: every client is same-origin. In dev the Vite server
// proxies /api to this process, and in production and the Electron shell this
// process serves the client itself. A cross-origin allowance would only have
// been a guess at Vite's port, wrong the moment Vite fell back off WEB_PORT.
app.get("/api/health", (c) =>
  c.json({
    ok: true,
    env: appConfig.env,
  }),
);

app.route("/api/books", booksRoutes);
app.route("/api/books", readerToolsRoutes);
app.route("/api/bookshelves", bookshelvesRoutes);
app.route("/api/settings", settingsRoutes);
app.route("/api/library", libraryRoutes);

// Anything left under /api is a genuine miss. Without this it would fall through
// to the SPA catch-all below and answer with index.html and a 200, which the web
// client reads as success and then renders as undefined fields.
app.all("/api/*", (c) => c.json({ error: "No such API endpoint." }, 404));

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

app.get("*", async () => {
  const indexPath = path.join(appConfig.publicDir, "index.html");

  try {
    const bytes = await readFile(indexPath);
    return new Response(bytes, {
      headers: {
        ...cspHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch {
    return new Response(
      [
        "<!doctype html>",
        "<html><body style='font-family:system-ui;padding:32px'>",
        "<h1>Frontend not built</h1>",
        "<p>Run <code>bun run dev</code> for local development or <code>bun run build</code> before <code>bun run start</code>.</p>",
        "</body></html>",
      ].join(""),
      {
        headers: {
          ...cspHeaders,
          "Content-Type": "text/html; charset=utf-8",
        },
        status: 404,
      },
    );
  }
});
