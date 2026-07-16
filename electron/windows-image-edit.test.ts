import { describe, expect, it } from "vitest";
import type { ImageEditAnnotationResolution } from "../src/shared/types";
import { normalizeWindowsTextRemovalResolution } from "./windows-image-edit";

const resolution = (requestedChange: string): ImageEditAnnotationResolution => ({
  contentHash: "hash",
  source: "vision_model",
  modelName: "vision-test",
  createdAt: "2026-07-16T00:00:00.000Z",
  status: "needs_review",
  items: [
    {
      index: 1,
      targetObject: "左侧对话气泡",
      currentState: "气泡内文字为深度思考",
      requestedChange,
      preserve: [],
      spatialAnchors: [],
      originalText: "深度思考",
      replacementText: undefined,
      confidence: 0.95,
      ambiguity: "",
      userConfirmed: false
    }
  ]
});

describe("Windows image-edit deletion normalization", () => {
  it("treats a pure text deletion as deletion instead of an incomplete replacement on Windows", () => {
    const normalized = normalizeWindowsTextRemovalResolution(
      resolution("删除该对话气泡及其内部文字"),
      "win32"
    );

    expect(normalized.items[0].originalText).toBeUndefined();
    expect(normalized.items[0].replacementText).toBeUndefined();
  });

  it("does not weaken replacement validation or change macOS behavior", () => {
    const replacement = resolution("删除旧文字并替换为新标题");
    const preservedText = resolution("不要删除文字，只移除气泡阴影");
    const macDeletion = resolution("删除该对话气泡及其内部文字");

    expect(normalizeWindowsTextRemovalResolution(replacement, "win32")).toBe(replacement);
    expect(normalizeWindowsTextRemovalResolution(preservedText, "win32")).toBe(preservedText);
    expect(normalizeWindowsTextRemovalResolution(macDeletion, "darwin")).toBe(macDeletion);
  });
});
