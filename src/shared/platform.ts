export const isWindowsPlatform = (platform: string): boolean => platform.toLowerCase().startsWith("win");

export const clipboardPasteShortcut = (platform: string): "Ctrl + V" | "Cmd + V" =>
  isWindowsPlatform(platform) ? "Ctrl + V" : "Cmd + V";

export const localDataScopeLabel = (platform: string): "当前 Windows 设备" | "当前 Mac" =>
  isWindowsPlatform(platform) ? "当前 Windows 设备" : "当前 Mac";
