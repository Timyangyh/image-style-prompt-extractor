import { describe, expect, it } from "vitest";
import { clipboardPasteShortcut, isWindowsPlatform, localDataScopeLabel } from "./platform";

describe("clipboardPasteShortcut", () => {
  it("uses the native paste shortcut for macOS and Windows", () => {
    expect(clipboardPasteShortcut("MacIntel")).toBe("Cmd + V");
    expect(clipboardPasteShortcut("Win32")).toBe("Ctrl + V");
    expect(isWindowsPlatform("MacIntel")).toBe(false);
    expect(isWindowsPlatform("Win32")).toBe(true);
    expect(localDataScopeLabel("MacIntel")).toBe("当前 Mac");
    expect(localDataScopeLabel("Win32")).toBe("当前 Windows 设备");
  });
});
