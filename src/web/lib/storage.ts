import {
  parseThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../../shared/theme";

export type BookshelfView = "grid" | "list";
export type BookshelfDensity = "comfortable" | "compact";
export type ReaderTone = "paper" | "sepia" | "night";
export type ReaderFontId = "original" | "iowan" | "georgia" | "palatino" | "charter" | "sans";
export type ReaderSpacingId = "compact" | "cozy" | "roomy";
export type StoredReaderProgress = { section: string; page: number };

const BOOKSHELF_VIEW_KEY = "ebook-manager-bookshelf-view";
const BOOKSHELF_DENSITY_KEY = "ebook-manager-bookshelf-density";
const BOOKSHELF_SIDEBAR_MINIMIZED_KEY = "ebook-manager-bookshelf-sidebar-minimized";
const ONBOARDING_DISMISSED_KEY = "ebook-manager-onboarding-dismissed";
const READER_TONE_KEY = "ebook-manager-reader-tone";
const READER_FONT_SCALE_KEY = "ebook-manager-reader-font-scale";
const READER_FONT_KEY = "ebook-manager-reader-font";
const READER_SPACING_KEY = "ebook-manager-reader-spacing";
const READER_PROGRESS_KEY_PREFIX = "ebook-manager-reader-progress";

export const READER_MIN_FONT_SCALE = 0.95;
export const READER_MAX_FONT_SCALE = 1.25;
export const READER_FONT_SCALE_STEP = 0.1;

export const READER_FONTS: ReadonlyArray<{
  id: ReaderFontId;
  label: string;
  stack: string;
}> = [
  {
    id: "original",
    label: "Original",
    stack: 'ui-serif, "New York", "Iowan Old Style", "Palatino Linotype", Georgia, serif',
  },
  {
    id: "iowan",
    label: "Iowan",
    stack: '"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif',
  },
  { id: "georgia", label: "Georgia", stack: 'Georgia, "Times New Roman", serif' },
  {
    id: "palatino",
    label: "Palatino",
    stack: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
  },
  {
    id: "charter",
    label: "Charter",
    stack: 'Charter, "Bitstream Charter", "Sitka Text", Georgia, serif',
  },
  {
    id: "sans",
    label: "Sans",
    stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  },
];
export const DEFAULT_READER_FONT: ReaderFontId = "original";

export const READER_SPACINGS: ReadonlyArray<{
  id: ReaderSpacingId;
  label: string;
  value: string;
}> = [
  { id: "compact", label: "Compact", value: "1.35" },
  { id: "cozy", label: "Cozy", value: "1.5" },
  { id: "roomy", label: "Roomy", value: "1.78" },
];
export const DEFAULT_READER_SPACING: ReaderSpacingId = "cozy";

const getReaderProgressKey = (bookId: string) => `${READER_PROGRESS_KEY_PREFIX}:${bookId}`;

export function getStoredThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored !== null) return parseThemePreference(stored);
  } catch {
    /* localStorage unavailable */
  }
  return parseThemePreference(window.irulan?.themePreference);
}

export function setStoredThemePreference(value: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredBookshelfView(): BookshelfView | null {
  try {
    const stored = localStorage.getItem(BOOKSHELF_VIEW_KEY);
    if (stored === "grid" || stored === "list") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function setStoredBookshelfView(value: BookshelfView) {
  try {
    localStorage.setItem(BOOKSHELF_VIEW_KEY, value);
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredBookshelfDensity(): BookshelfDensity | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(BOOKSHELF_DENSITY_KEY);
    if (value === "comfortable" || value === "compact") return value;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function setStoredBookshelfDensity(value: BookshelfDensity) {
  try {
    localStorage.setItem(BOOKSHELF_DENSITY_KEY, value);
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredBookshelfSidebarMinimized(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(BOOKSHELF_SIDEBAR_MINIMIZED_KEY) === "true";
  } catch {
    /* localStorage unavailable */
  }
  return false;
}

export function setStoredBookshelfSidebarMinimized(value: boolean) {
  try {
    localStorage.setItem(BOOKSHELF_SIDEBAR_MINIMIZED_KEY, value ? "true" : "false");
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredOnboardingDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true";
  } catch {
    /* localStorage unavailable */
  }
  return false;
}

export function setStoredOnboardingDismissed(value: boolean) {
  try {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, value ? "true" : "false");
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredReaderTone(): ReaderTone | null {
  try {
    const stored = localStorage.getItem(READER_TONE_KEY);
    if (stored === "paper" || stored === "sepia" || stored === "night") return stored;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function setStoredReaderTone(value: ReaderTone) {
  try {
    localStorage.setItem(READER_TONE_KEY, value);
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredReaderFontScale(): number | null {
  try {
    const stored = Number.parseFloat(localStorage.getItem(READER_FONT_SCALE_KEY) ?? "");
    if (
      Number.isFinite(stored) &&
      stored >= READER_MIN_FONT_SCALE &&
      stored <= READER_MAX_FONT_SCALE
    ) {
      return stored;
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function setStoredReaderFontScale(value: number) {
  try {
    localStorage.setItem(READER_FONT_SCALE_KEY, String(value));
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredReaderFont(): ReaderFontId | null {
  try {
    const stored = localStorage.getItem(READER_FONT_KEY);
    if (READER_FONTS.some((font) => font.id === stored)) return stored as ReaderFontId;
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function setStoredReaderFont(value: ReaderFontId) {
  try {
    localStorage.setItem(READER_FONT_KEY, value);
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredReaderSpacing(): ReaderSpacingId | null {
  try {
    const stored = localStorage.getItem(READER_SPACING_KEY);
    if (READER_SPACINGS.some((spacing) => spacing.id === stored)) {
      return stored as ReaderSpacingId;
    }
  } catch {
    /* localStorage unavailable */
  }
  return null;
}

export function setStoredReaderSpacing(value: ReaderSpacingId) {
  try {
    localStorage.setItem(READER_SPACING_KEY, value);
  } catch {
    /* localStorage unavailable */
  }
}

export function getStoredReaderProgress(bookId: string): StoredReaderProgress | null {
  if (!bookId) return null;
  try {
    const raw = localStorage.getItem(getReaderProgressKey(bookId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredReaderProgress> | null;
    if (parsed && typeof parsed.section === "string" && parsed.section.length > 0) {
      const page = Number(parsed.page);
      return {
        section: parsed.section,
        page: Number.isFinite(page) && page >= 1 ? Math.round(page) : 1,
      };
    }
  } catch {
    /* localStorage unavailable or malformed */
  }
  return null;
}

export function setStoredReaderProgress(bookId: string, progress: StoredReaderProgress) {
  if (!bookId) return;
  try {
    localStorage.setItem(getReaderProgressKey(bookId), JSON.stringify(progress));
  } catch {
    /* localStorage unavailable */
  }
}
