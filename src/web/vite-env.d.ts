/// <reference types="vite/client" />

interface ReaderPreferencesBridge {
  tone?: import("./lib/storage").ReaderTone;
  fontScale?: number;
  fontFamily?: import("./lib/storage").ReaderFontId;
  lineSpacing?: import("./lib/storage").ReaderSpacingId;
}

interface IrulanBridge {
  openReader: (bookId: string, search: string) => Promise<void>;
  setReaderWindowButtonsVisible: (visible: boolean) => void;
  showBookFile: (bookId: string) => Promise<void>;
  readerPreferences?: ReaderPreferencesBridge;
  setReaderPreferences: (
    preferences: Partial<ReaderPreferencesBridge>,
  ) => Promise<void>;
  themePreference?: import("../shared/theme").ThemePreference;
  setThemePreference: (
    preference: import("../shared/theme").ThemePreference,
  ) => Promise<void>;
}

interface Window {
  irulan?: IrulanBridge;
}
