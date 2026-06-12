const { contextBridge, ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.documentElement.classList.add("electron-shell");
});

contextBridge.exposeInMainWorld("irulan", {
  // Open a dedicated reader window for a book. `search` is the reader query
  // string (section/page/shelf) without the leading "?". Resolves once the
  // main process has handled the request.
  openReader: (bookId, search) =>
    ipcRenderer.invoke("reader:popout", { bookId, search }),
});
