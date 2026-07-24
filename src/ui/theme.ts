export type AppTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "image-style-prompt-extractor:theme:v1";

type ThemeStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type ThemeRoot = {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, "colorScheme">;
};

export const parseTheme = (value: unknown): AppTheme | null =>
  value === "light" || value === "dark" ? value : null;

export const resolveTheme = (storedValue: unknown, systemPrefersDark: boolean): AppTheme =>
  parseTheme(storedValue) || (systemPrefersDark ? "dark" : "light");

export const readThemePreference = (
  storage: ThemeStorage = window.localStorage
): AppTheme | null => {
  try {
    return parseTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
};

export const systemTheme = (
  matchMedia: Window["matchMedia"] = window.matchMedia.bind(window)
): AppTheme => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export const applyTheme = (
  theme: AppTheme,
  root: ThemeRoot = document.documentElement
): void => {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
};

export const currentTheme = (): AppTheme =>
  parseTheme(document.documentElement.dataset.theme) || systemTheme();

export const initializeTheme = (): AppTheme => {
  const theme = readThemePreference() || systemTheme();
  applyTheme(theme);
  return theme;
};

export const persistTheme = (
  theme: AppTheme,
  storage: ThemeStorage = window.localStorage,
  root: ThemeRoot = document.documentElement
): void => {
  applyTheme(theme, root);
  try {
    storage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The current session still uses the selected theme when storage is unavailable.
  }
};

export const clearThemePreference = (
  storage: ThemeStorage = window.localStorage
): AppTheme => {
  try {
    storage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Continue with the system theme even when storage is unavailable.
  }
  const theme = systemTheme();
  applyTheme(theme);
  return theme;
};

export const watchSystemTheme = (onChange: (theme: AppTheme) => void): (() => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => onChange(media.matches ? "dark" : "light");
  media.addEventListener("change", update);
  update();
  return () => media.removeEventListener("change", update);
};
