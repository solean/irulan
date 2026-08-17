/// <reference types="vite/client" />

interface IrulanBridge {
  openReader: (bookId: string, search: string) => Promise<void>;
  setReaderWindowButtonsVisible: (visible: boolean) => void;
  showBookFile: (bookId: string) => Promise<void>;
  themePreference?: import("../shared/theme").ThemePreference;
  setThemePreference: (
    preference: import("../shared/theme").ThemePreference,
  ) => Promise<void>;
}

interface Window {
  irulan?: IrulanBridge;
}
