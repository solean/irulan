const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("electron-shell");
});

const THEME_PREFERENCE_SWITCH = "--irulan-theme-preference=";
const shellThemePreference =
  process.argv.find((arg) => arg.startsWith(THEME_PREFERENCE_SWITCH))?.slice(THEME_PREFERENCE_SWITCH.length) ??
  "system";

contextBridge.exposeInMainWorld("irulan", {
  // Open a dedicated reader window for a book. `search` is the reader query
  // string (section/page/shelf) without the leading "?". Resolves once the
  // main process has handled the request.
  openReader: (bookId, search) =>
    ipcRenderer.invoke("reader:popout", { bookId, search }),
  showBookFile: (bookId) =>
    ipcRenderer.invoke("book:showFile", { bookId }),
  // The shell's persisted preference, injected at window creation. Every
  // launch serves from a fresh ephemeral port, so renderer localStorage starts
  // empty and this is the only durable copy inside Electron.
  themePreference: shellThemePreference,
  // Mirror the renderer's theme preference so the shell can paint new windows
  // with the right background color before their renderer boots.
  setThemePreference: (preference) =>
    ipcRenderer.invoke("theme:preference", { preference }),
});
