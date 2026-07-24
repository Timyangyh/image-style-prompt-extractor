import { describe, expect, it } from "vitest";
import {
  applyTheme,
  parseTheme,
  persistTheme,
  readThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY
} from "./theme";

const memoryStorage = (initialValue: string | null = null) => {
  let value = initialValue;
  return {
    getItem: (key: string) => (key === THEME_STORAGE_KEY ? value : null),
    removeItem: (key: string) => {
      if (key === THEME_STORAGE_KEY) value = null;
    },
    setItem: (key: string, nextValue: string) => {
      if (key === THEME_STORAGE_KEY) value = nextValue;
    }
  };
};

describe("theme preferences", () => {
  it("accepts only the two supported theme values", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBeNull();
    expect(parseTheme(null)).toBeNull();
  });

  it("falls back to the current system theme for missing or damaged preferences", () => {
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme("damaged", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("reads and persists only the non-sensitive theme enum", () => {
    const storage = memoryStorage();
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: "" }
    };
    expect(readThemePreference(storage)).toBeNull();
    persistTheme("dark", storage, root);
    expect(readThemePreference(storage)).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
  });

  it("applies both the document theme selector and native control color scheme", () => {
    const root = {
      dataset: {} as DOMStringMap,
      style: { colorScheme: "" }
    };
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
  });
});
