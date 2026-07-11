import { describe, expect, it } from "vitest";
import {
  assertConfirmedAnnotationResolution,
  buildOriginRegenerationPrompt,
  describeImageEditGeometry,
  normalizeImageEditAnnotationGeometry,
  parseImageEditAnnotationResolution
} from "./image-edit-regeneration";
import type {
  ImageEditAnnotationItem,
  ImageEditAnnotationResolution,
  ImageEditRequestSettings
} from "./types";

const items: ImageEditAnnotationItem[] = [
  {
    index: 1,
    label: "标注 1",
    tool: "box",
    note: "只把扩音器外壳改成青绿色。",
    geometry: {
      tool: "box",
      left: 0.97234,
      top: 0.21845,
      right: 0.85125,
      bottom: 0.01234,
      centerX: 0,
      centerY: 0,
      width: 0,
      height: 0
    }
  },
  {
    index: 2,
    label: "标注 2",
    tool: "text",
    note: "把原文字改为新品上市。",
    geometry: { tool: "text", anchorX: 1.2, anchorY: -0.1, text: "新品上市" }
  }
];

const settings: ImageEditRequestSettings = {
  apiMode: "images",
  imageModel: "gpt-image-2",
  mainModel: "gpt-5.5",
  resolution: "1k",
  aspectRatio: "9:16",
  size: "864x1536",
  quality: "high",
  outputFormat: "png",
  moderation: "auto",
  background: "auto",
  n: 1
};

const confirmedResolution = (): ImageEditAnnotationResolution => ({
  contentHash: "hash",
  source: "vision_model",
  modelName: "vision-test",
  createdAt: "2026-07-11T00:00:00.000Z",
  confirmedAt: "2026-07-11T00:01:00.000Z",
  status: "confirmed",
  items: [
    {
      index: 1,
      targetObject: "右侧人物头顶上方的扩音器",
      currentState: "橙色外壳、白色喇叭口",
      requestedChange: "只将橙色外壳改为青绿色",
      preserve: ["保持大小、位置、角度和白色喇叭口", "不改变相邻人物脸部和手势"],
      spatialAnchors: ["位于右侧人物头顶上方"],
      confidence: 0.94,
      ambiguity: "",
      userConfirmed: true
    },
    {
      index: 2,
      targetObject: "底部标题文字",
      currentState: "文字为旧品推荐",
      requestedChange: "替换底部标题文字",
      preserve: ["保持字体、字号和位置"],
      spatialAnchors: ["位于画面底部中央"],
      originalText: "旧品推荐",
      replacementText: "新品上市",
      confidence: 0.72,
      ambiguity: "原文字边缘略模糊",
      userConfirmed: true
    }
  ]
});

describe("origin regeneration annotation geometry", () => {
  it("normalizes reversed boxes, clamps coordinates and keeps 0.1% prompt precision", () => {
    const box = normalizeImageEditAnnotationGeometry(items[0].geometry!);
    expect(box).toMatchObject({ left: 0.8513, top: 0.0123, right: 0.9723, bottom: 0.2185 });
    expect(describeImageEditGeometry(box)).toBe("画布横向 85.1%-97.2%、纵向 1.2%-21.9%");
    const textGeometry = normalizeImageEditAnnotationGeometry(items[1].geometry!);
    expect(textGeometry).toMatchObject({ anchorX: 1, anchorY: 0 });
  });

  it("rejects zero-area boxes and zero-length arrows", () => {
    expect(() =>
      normalizeImageEditAnnotationGeometry({
        tool: "box",
        left: 0.2,
        top: 0.2,
        right: 0.2,
        bottom: 0.5,
        centerX: 0.2,
        centerY: 0.35,
        width: 0,
        height: 0.3
      })
    ).toThrow(/面积不能为零/);
    expect(() =>
      normalizeImageEditAnnotationGeometry({ tool: "arrow", startX: 0.3, startY: 0.4, endX: 0.3, endY: 0.4 })
    ).toThrow(/长度不能为零/);
  });

  it("normalizes arrow targets and brush summaries without serializing dense paths", () => {
    expect(
      normalizeImageEditAnnotationGeometry({ tool: "arrow", startX: -1, startY: 0.25, endX: 1.2, endY: 0.75 })
    ).toEqual({ tool: "arrow", startX: 0, startY: 0.25, endX: 1, endY: 0.75 });
    expect(
      normalizeImageEditAnnotationGeometry({
        tool: "brush",
        left: 0.2,
        top: 0.3,
        right: 0.4,
        bottom: 0.5,
        centerX: 0.31,
        centerY: 0.39,
        coverageRatio: 0.03,
        effectiveLineWidth: 0.012
      })
    ).toEqual({
      tool: "brush",
      left: 0.2,
      top: 0.3,
      right: 0.4,
      bottom: 0.5,
      centerX: 0.31,
      centerY: 0.39,
      coverageRatio: 0.03,
      effectiveLineWidth: 0.012
    });
  });
});

describe("origin regeneration annotation resolution", () => {
  it("rejects missing, duplicate and extra indexes", () => {
    const base = {
      contentHash: "hash",
      source: "vision_model" as const,
      modelName: "vision-test",
      createdAt: "2026-07-11T00:00:00.000Z"
    };
    const resolved = (index: number) => ({
      index,
      target_object: "对象",
      current_state: "当前状态",
      requested_change: "目标修改",
      preserve: [],
      spatial_anchors: [],
      confidence: 0.9,
      ambiguity: ""
    });
    expect(() => parseImageEditAnnotationResolution({ items: [resolved(1)] }, items, base)).toThrow(/数量/);
    expect(() => parseImageEditAnnotationResolution({ items: [resolved(1), resolved(1)] }, items, base)).toThrow(/缺号、重号或额外编号/);
    expect(() => parseImageEditAnnotationResolution({ items: [resolved(1), resolved(3)] }, items, base)).toThrow(/缺号、重号或额外编号/);
  });

  it("keeps low-confidence and ambiguous items in review until the user confirms them", () => {
    const resolution = confirmedResolution();
    expect(assertConfirmedAnnotationResolution(resolution, items)).toBe(resolution);
    expect(() =>
      assertConfirmedAnnotationResolution(
        { ...resolution, status: "needs_review", confirmedAt: undefined },
        items
      )
    ).toThrow(/尚未完成确认/);
    const mismatchedText = confirmedResolution();
    mismatchedText.items[1] = { ...mismatchedText.items[1], originalText: undefined };
    expect(() => assertConfirmedAnnotationResolution(mismatchedText, items)).toThrow(/同时填写原文字和新文字/);
  });
});

describe("origin regeneration prompt compiler", () => {
  it("uses each numbered revision exactly once with geometry, anchors and exact replacement text", () => {
    const prompt = buildOriginRegenerationPrompt(
      "原始融合提示词正文。",
      "保持人物身份与构图。",
      items,
      confirmedResolution(),
      settings
    );
    expect(prompt.startsWith("原始融合提示词正文。")).toBe(true);
    expect(prompt.match(/局部修订 1：/g)).toHaveLength(1);
    expect(prompt.match(/局部修订 2：/g)).toHaveLength(1);
    expect(prompt).toContain("画布横向 85.1%-97.2%、纵向 1.2%-21.9%");
    expect(prompt).toContain("空间锚点：位于右侧人物头顶上方");
    expect(prompt).toContain("新文字必须逐字使用“新品上市”");
    expect(prompt).toContain("输出规格：864x1536 像素，比例 9:16，格式 PNG");
    expect(prompt).not.toMatch(/看标注图|按红框|修改这里/);
  });
});
