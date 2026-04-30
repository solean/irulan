const path = require("node:path");

const { app, BrowserWindow, shell } = require("electron");

let mainWindow = null;
let localServer = null;

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

const createMainWindow = async () => {
  localServer = await startLocalServer();

  mainWindow = new BrowserWindow({
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
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(localServer.url);
};

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
