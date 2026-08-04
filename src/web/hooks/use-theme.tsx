import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  resolveTheme,
  THEME_BACKGROUNDS,
  type Theme,
  type ThemePreference,
} from "../../shared/theme";
import {
  getStoredThemePreference,
  setStoredThemePreference,
} from "../lib/storage";
import { useMediaQuery } from "./use-media-query";

type ThemeContextValue = {
  theme: Theme;
  themePreference: ThemePreference;
  setThemePreference: (preference: ThemePreference) => void;
  toggle: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.classList.toggle("dark", theme === "dark");
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_BACKGROUNDS[theme];
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      'input, textarea, select, [contenteditable], [role="combobox"], [role="textbox"]',
    )
  ) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

function useThemeValue(): ThemeContextValue {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const systemTheme: Theme = prefersDark ? "dark" : "light";
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(
    getStoredThemePreference,
  );
  const theme = resolveTheme(themePreference, systemTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // The Electron shell paints window backgrounds before any renderer runs, so
  // it needs its own copy of the preference to avoid a wrong-theme flash.
  useEffect(() => {
    void window.irulan?.setThemePreference?.(themePreference);
  }, [themePreference]);

  const setThemePreference = useCallback((next: ThemePreference) => {
    setStoredThemePreference(next);
    setThemePreferenceState(next);
  }, []);

  const toggle = useCallback(() => {
    setThemePreferenceState((previous) => {
      const current = resolveTheme(previous, systemTheme);
      const next = current === "dark" ? "light" : "dark";
      setStoredThemePreference(next);
      return next;
    });
  }, [systemTheme]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !event.shiftKey ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "d" ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  return { theme, themePreference, setThemePreference, toggle };
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider.");
  return value;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={useThemeValue()}>{children}</ThemeContext.Provider>;
}
