const path = require("node:path");
const { access } = require("node:fs/promises");
const { readFileSync, writeFileSync } = require("node:fs");

const { app, BrowserWindow, ipcMain, nativeTheme, shell } = require("electron");

const { isExternallyOpenable, isSameOrigin } = require("./url-policy.cjs");

/**
 * Hand a URL to the system browser, but only if its scheme is one the reader
 * can legitimately produce. Books are untrusted input and openExternal resolves
 * through the OS handler registry, so an unfiltered URL here is a way for a
 * crafted EPUB to launch whatever is registered for `file:` or a custom scheme.
 */
const openExternalUrl = (url) => {
  if (!isExternallyOpenable(url)) {
    console.warn(`Refused to open a URL with an unsupported scheme: ${url}`);
    return;
  }

  shell.openExternal(url).catch((error) => {
    console.error(`Could not open ${url} in the system browser.`, error);
  });
};

let mainWindow = null;
let localServer = null;
// Dedicated reader windows, keyed by book id so a second "pop out" focuses the
// existing window instead of spawning a duplicate.
const readerWindows = new Map();

const isDev = !app.isPackaged;

const appRoot = isDev ? path.resolve(__dirname, "..") : app.getAppPath();
const publicDir = path.join(appRoot, "dist", "client");
const serverEntry = path.join(appRoot, "dist", "server", "index.cjs");
const preloadEntry = path.join(__dirname, "preload.cjs");

// Keep in sync with THEME_BACKGROUNDS in src/shared/theme.ts (--bg-base in
// src/web/styles.css). The renderer drives the preference while it runs, but
// windows are painted before any renderer exists, so the main process keeps a
// durable copy on disk and seeds every renderer with it at startup.
const THEME_BACKGROUNDS = { dark: "#15100B", light: "#F6F4EE" };
const THEME_PREFERENCES = new Set(["system", "light", "dark"]);
const THEME_PREFERENCE_SWITCH = "--irulan-theme-preference=";

const themePreferenceFile = () => path.join(app.getPath("userData"), "theme.json");

const loadThemePreference = () => {
  try {
    const stored = JSON.parse(readFileSync(themePreferenceFile(), "utf8"));
    if (THEME_PREFERENCES.has(stored?.preference)) return stored.preference;
  } catch {
    /* no preference stored yet */
  }
  return "system";
};

const windowBackgroundColor = () =>
  nativeTheme.shouldUseDarkColors ? THEME_BACKGROUNDS.dark : THEME_BACKGROUNDS.light;

const repaintWindowBackgrounds = () => {
  const color = windowBackgroundColor();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.setBackgroundColor(color);
  }
};

const setThemePreference = (value) => {
  const preference = THEME_PREFERENCES.has(value) ? value : "system";
  if (nativeTheme.themeSource === preference) return;

  // Drives native chrome (traffic lights, scrollbars) and shouldUseDarkColors,
  // which in turn repaints window backgrounds via the "updated" listener.
  nativeTheme.themeSource = preference;
  try {
    writeFileSync(themePreferenceFile(), JSON.stringify({ preference }));
  } catch (error) {
    console.error("Failed to persist the theme preference.", error);
  }
};

const configureServerEnvironment = () => {
  const appDataDir = path.join(app.getPath("userData"), "data");
  const storageDir = path.join(app.getPath("userData"), "storage");

  process.env.IRULAN_SERVER_ENTRYPOINT = "electron";
  process.env.IRULAN_ROOT_DIR = appRoot;
  process.env.IRULAN_PUBLIC_DIR = publicDir;
  process.env.EBOOK_DATA_DIR = appDataDir;
  process.env.EBOOK_STORAGE_DIR = storageDir;
  process.env.NODE_ENV = "production";
  process.env.PORT = "0";
};

const startLocalServer = async () => {
  configureServerEnvironment();
  const serverModule = await import(serverEntry);
  return serverModule.startServer({ port: 0, hostname: "127.0.0.1" });
};

const buildWindow = (overrides = {}) => {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "Irulan",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 22 },
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadEntry,
      sandbox: true,
      // The local server binds an ephemeral port, so every launch is a new
      // origin with empty localStorage. Hand the renderer the persisted
      // preference instead of letting it fall back to "system".
      additionalArguments: [`${THEME_PREFERENCE_SWITCH}${nativeTheme.themeSource}`],
    },
    ...overrides,
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  // Keep every window locked down: external links go to the system browser,
  // never an uncontrolled in-app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: "deny" };
  });

  // Book content must never carry a window off the local app. React Router
  // navigates with pushState, which does not fire this, and our own loadURL
  // calls do not either — so anything arriving here came from page content.
  window.webContents.on("will-navigate", (event, url) => {
    if (localServer && isSameOrigin(url, localServer.url)) {
      return;
    }

    event.preventDefault();
    openExternalUrl(url);
  });

  return window;
};

const createMainWindow = async () => {
  localServer = await startLocalServer();
  mainWindow = buildWindow();
  await mainWindow.loadURL(localServer.url);
};

const openReaderWindow = (bookId, search) => {
  if (!localServer) return;

  const normalizedId = String(bookId ?? "").trim();
  if (!normalizedId) return;

  const existing = readerWindows.get(normalizedId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }

  const params = new URLSearchParams(typeof search === "string" ? search : "");
  params.set("popout", "1");
  const url = `${localServer.url}/books/${encodeURIComponent(normalizedId)}/read?${params.toString()}`;

  const readerWindow = buildWindow({
    width: 820,
    height: 940,
    minWidth: 480,
    minHeight: 600,
  });

  readerWindows.set(normalizedId, readerWindow);
  readerWindow.on("closed", () => {
    if (readerWindows.get(normalizedId) === readerWindow) {
      readerWindows.delete(normalizedId);
    }
  });

  void readerWindow.loadURL(url);
};

const getStoredBookFilePath = (bookId) => {
  const normalizedId = String(bookId ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedId)) {
    throw new Error("Invalid book id.");
  }

  const booksRoot = path.resolve(app.getPath("userData"), "storage", "books");
  const filePath = path.resolve(booksRoot, normalizedId, "original.epub");
  if (!filePath.startsWith(`${booksRoot}${path.sep}`)) {
    throw new Error("Invalid book file path.");
  }

  return filePath;
};

ipcMain.handle("reader:popout", (_event, payload) => {
  openReaderWindow(payload?.bookId, payload?.search);
});

ipcMain.handle("theme:preference", (_event, payload) => {
  setThemePreference(payload?.preference);
});

ipcMain.handle("book:showFile", async (_event, payload) => {
  const filePath = getStoredBookFilePath(payload?.bookId);
  try {
    await access(filePath);
  } catch {
    throw new Error("The EPUB file could not be found.");
  }
  shell.showItemInFolder(filePath);
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = loadThemePreference();
  nativeTheme.on("updated", repaintWindowBackgrounds);

  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (event) => {
  if (!localServer) {
    return;
  }

  event.preventDefault();
  const server = localServer;
  localServer = null;
  await server.close().catch((error) => {
    console.error("Failed to stop Irulan server cleanly.", error);
  });
  app.quit();
});
