import { describe, expect, it } from "vitest";
import { getFuseMode, resolveFuseMode } from "./fuse-mode";
import { normalizeStyleAnalysis } from "./schema";

describe("fuse mode routing", () => {
  it("defaults information-layout analyses to product information layout mode", () => {
    const analysis = normalizeStyleAnalysis({
      information_layout_template: {
        applies: true,
        structure_prompt: "顶部标题区，中部卡片区，底部参数表格。",
        table_or_card_layout_prompt: "浅色圆角卡片、细分隔线和紧凑表格。",
        text_hierarchy_prompt: "标题加粗，正文分组排列，重点数据用色块突出。",
        copy_ready_json_prompt: "生成同款资料卡 JSON 提示词，只复用信息架构和卡片排版。"
      }
    });

    expect(getFuseMode(analysis)).toBe("information_layout");
  });

  it("defaults poster analyses to subject reference mode", () => {
    const analysis = normalizeStyleAnalysis({
      image_classification: {
        primary_type: "poster"
      }
    });

    expect(getFuseMode(analysis)).toBe("subject_reference");
  });

  it("lets the user's explicit tab choice override the inferred default", () => {
    const analysis = normalizeStyleAnalysis({
      information_layout_template: {
        applies: true,
        structure_prompt: "多卡片资料页结构。",
        table_or_card_layout_prompt: "双列圆角卡片和底部表格。",
        text_hierarchy_prompt: "主标题醒目，参数文字紧凑。",
        copy_ready_json_prompt: "生成同款产品资料卡 JSON 提示词。"
      }
    });

    expect(resolveFuseMode(analysis, null)).toBe("information_layout");
    expect(resolveFuseMode(analysis, "subject_reference")).toBe("subject_reference");
  });
});
