/// <reference types="vite/client" />

interface IrulanBridge {
  openReader: (bookId: string, search: string) => Promise<void>;
}

interface Window {
  irulan?: IrulanBridge;
}
