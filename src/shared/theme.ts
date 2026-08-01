export type Theme = "light" | "dark";
export type ThemePreference = "system" | Theme;

/**
 * Written by the app (localStorage), read by the pre-paint bootstrap script and
 * mirrored into the Electron main process. Never inline this string elsewhere.
 */
export const THEME_STORAGE_KEY = "ebook-manager-theme-preference";

/** Base background per theme; mirrors `--bg-base` in src/web/styles.css. */
export const THEME_BACKGROUNDS: Record<Theme, string> = {
  dark: "#15100B",
  light: "#F6F4EE",
};

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemTheme: Theme): Theme {
  return preference === "system" ? systemTheme : preference;
}

/**
 * Inline `<head>` script that paints the stored theme before first paint.
 * Injected into index.html by the theme-bootstrap plugin in vite.config.ts, so
 * the storage key, the resolve rules, and the colors stay in one place.
 */
export const themeBootstrapScript =
  `(function(){var d=document.documentElement,p=null;` +
  `try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}` +
  `var t=p==="light"||p==="dark"?p:matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light";` +
  `d.setAttribute("data-theme",t);d.classList.toggle("dark",t==="dark");` +
  `var m=document.querySelector('meta[name="theme-color"]');` +
  `if(m)m.content=t==="dark"?${JSON.stringify(THEME_BACKGROUNDS.dark)}:${JSON.stringify(THEME_BACKGROUNDS.light)}})();`;
