import { describe, expect, it } from "vitest";
import { windowsApplicationMenuTemplate } from "./windows-menu";

describe("Windows application menu", () => {
  it("uses concise Chinese labels and preserves editing roles", () => {
    const template = windowsApplicationMenuTemplate(false);
    expect(template.map((item) => item.label)).toEqual(["文件", "编辑", "查看", "窗口"]);
    expect(JSON.stringify(template)).toContain('"role":"paste"');
    expect(JSON.stringify(template)).not.toContain("toggleDevTools");
  });

  it("keeps developer tools available in development builds", () => {
    expect(JSON.stringify(windowsApplicationMenuTemplate(true))).toContain("toggleDevTools");
  });
});
