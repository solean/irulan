const path = require("node:path");

const { app, BrowserWindow, ipcMain, shell } = require("electron");

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
    backgroundColor: "#15100B",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadEntry,
      sandbox: true,
    },
    ...overrides,
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  // Keep every window locked down: external links go to the system browser,
  // never an uncontrolled in-app window.
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
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
    width: 900,
    height: 1000,
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

ipcMain.handle("reader:popout", (_event, payload) => {
  openReaderWindow(payload?.bookId, payload?.search);
});

app.whenReady().then(async () => {
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
