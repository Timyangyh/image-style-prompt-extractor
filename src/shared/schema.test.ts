import { describe, expect, it } from "vitest";
import {
  createLocalSourceCapture,
  normalizeFusedPromptResult,
  normalizeStyleAnalysis
} from "./schema";
import type { SourceCapture } from "./types";

const cleanFusedPrompt =
  "对这张图片进行风格化重绘：保持图中最清晰前景人物的外貌、体态比例和人数不变，将画面改为冷调商务海报式构图、低饱和配色、利落字体气质和柔和侧光层级，不要出现品牌、logo、价格或原文案。";

describe("style analysis schema", () => {
  it("normalizes legacy analysis into the 1.3 shape", () => {
    const analysis = normalizeStyleAnalysis({
      version: "1.1",
      analysis_mode: "style_reference_not_exact_replication"
    });

    expect(analysis.version).toBe("1.3");
    expect(analysis.source_capture.source_type).toBe("uploaded_image");
    expect(analysis.web_design_context.applies).toBe(false);
    expect(analysis.style_terms).toEqual([]);
    expect(analysis.visual_system.subject_appearance.applies).toBe(false);
    expect(analysis.visual_system.subject_appearance.transfer_limit).toContain("服装造型");
    expect(analysis.information_layout_template.applies).toBe(false);
    expect(analysis.information_layout_template.content_slots.some((slot) => slot.slot === "[PRODUCT_NAME]")).toBe(true);
    expect(analysis.extracted_text.applies).toBe(false);
    expect(analysis.extracted_text.markdown).toBe("");
  });

  it("fills local source_capture defaults for clipboard images", () => {
    const source = createLocalSourceCapture("clipboard_image", "2026-04-30T00:00:00.000Z");
    const analysis = normalizeStyleAnalysis({}, source);

    expect(analysis.source_capture.source_type).toBe("clipboard_image");
    expect(analysis.source_capture.captured_at).toBe("2026-04-30T00:00:00.000Z");
  });

  it("keeps legacy browser source metadata compatible", () => {
    const source: SourceCapture = {
      source_type: "browser_region",
      source_url: "https://example.com/page",
      page_title: "Example",
      domain: "example.com",
      capture_mode: "selected_region",
      selection_rect: { x: 1, y: 2, width: 300, height: 200, device_pixel_ratio: 2 },
      captured_at: "2026-04-30T00:00:00.000Z"
    };
    const analysis = normalizeStyleAnalysis({}, source);

    expect(analysis.source_capture.source_type).toBe("browser_region");
    expect(analysis.web_design_context.applies).toBe(true);
    expect(analysis.image_classification.primary_type).toBe("ui_screenshot");
  });

  it("normalizes style term category and confidence", () => {
    const analysis = normalizeStyleAnalysis({
      style_terms: [
        { name: "玻璃拟态卡片", category: "ui", confidence: 1.3, copyable: true },
        { name: "无效分类", category: "unknown", confidence: -1, copyable: "yes" }
      ]
    });

    expect(analysis.style_terms).toEqual([
      { name: "玻璃拟态卡片", category: "ui", confidence: 1, copyable: true },
      { name: "无效分类", category: "mood", confidence: 0, copyable: true }
    ]);
  });

  it("keeps generalized subject appearance references for fusion", () => {
    const analysis = normalizeStyleAnalysis({
      visual_system: {
        subject_appearance: {
          applies: true,
          subject_role_style: "都市通勤人物气质",
          wardrobe_style: "利落西装外套与垂坠长裤的商务廓形",
          outfit_color_materials: "深灰羊毛质感与低反光黑色皮革配饰",
          hair_makeup_accessory_style: "干净发型、低调妆容和极简金属配饰",
          pose_expression_style: "稳定自信的站姿和克制表情",
          scene_fit_notes: "服装线条与冷调办公室光影保持一致",
          transfer_limit: "只迁移可泛化服装造型，不复制品牌、logo、文字或个人身份。"
        }
      }
    });

    expect(analysis.visual_system.subject_appearance.applies).toBe(true);
    expect(analysis.visual_system.subject_appearance.wardrobe_style).toContain("商务廓形");
  });

  it("normalizes information layout templates with blank fill values", () => {
    const analysis = normalizeStyleAnalysis({
      information_layout_template: {
        applies: true,
        layout_family: "小红书多卡片产品资料页",
        structure_prompt: "顶部大标题，中部双列卡片，底部参数表格。",
        table_or_card_layout_prompt: "卡片使用圆角、浅色底、细分隔线和轻阴影。",
        text_hierarchy_prompt: "主标题超大字重，卡片标题加粗，正文紧凑对齐。",
        content_slots: [{ slot: "[PRODUCT_NAME]", fill_value: "不应保留" }],
        comparison_slots: [{ slot: "[COMPARISON_ITEM_A]", fill_value: "不应保留" }],
        copy_ready_json_prompt: "生成同款产品资料卡 JSON 提示词，只保留卡片布局和字体层级。"
      }
    });

    expect(analysis.information_layout_template.applies).toBe(true);
    expect(analysis.information_layout_template.content_slots[0].fill_value).toBe("");
    expect(analysis.information_layout_template.comparison_slots[0].fill_value).toBe("");
    expect(analysis.information_layout_template.copy_ready_json_prompt).toContain("产品资料卡");
  });

  it("keeps extracted text markdown verbatim without Chinese enforcement", () => {
    const analysis = normalizeStyleAnalysis({
      extracted_text: {
        applies: true,
        markdown: "# Premium Wireless Headphones\n- Long Battery Life\n- Comfortable Fit Design",
        extraction_notes: "右下角小字模糊，无法识别。"
      }
    });

    expect(analysis.version).toBe("1.3");
    expect(analysis.extracted_text.applies).toBe(true);
    expect(analysis.extracted_text.markdown).toContain("# Premium Wireless Headphones");
    expect(analysis.extracted_text.extraction_notes).toContain("模糊");
  });

  it("downgrades extracted text applies when markdown is empty", () => {
    const analysis = normalizeStyleAnalysis({
      extracted_text: { applies: true, markdown: "", extraction_notes: "" }
    });

    expect(analysis.extracted_text.applies).toBe(false);
  });

  it("joins extracted text line arrays into markdown", () => {
    const analysis = normalizeStyleAnalysis({
      extracted_text: { applies: true, markdown: ["# 标题", "- 第一条"], extraction_notes: "" }
    });

    expect(analysis.extracted_text.markdown).toBe("# 标题\n- 第一条");
  });
});

describe("fused prompt schema", () => {
  it("normalizes a minimal fused prompt result with single-image defaults", () => {
    const result = normalizeFusedPromptResult({
      fused_prompt: cleanFusedPrompt,
      confidence: 1.4
    });

    expect(result.fused_prompt).toContain("这张图片");
    expect(result.fused_prompt_json.generation_guidance.copy_ready_prompt).toBe(result.fused_prompt);
    expect(result.fused_prompt_json.style_reference.layout_prompt).toBe("");
    expect(result.fused_prompt_json.pose_transfer.transfer_instruction).toContain("姿态");
    expect(result.fused_prompt_json.wardrobe_transfer.transfer_instruction).toContain("服装");
    expect(result.fused_prompt_json.social_cover_text_layout.top_text_placeholder).toContain("[TOP_SUPER_TITLE]");
    expect(result.fused_prompt_json.generation_guidance.image_reference_instruction).toContain("一起提交");
    expect(result.subject_policy).toContain("前景人物");
    expect(result.subject_policy).not.toContain("主体照片");
    expect(result.style_transfer_scope).toContain("排版结构");
    expect(result.risk_notes).toEqual([]);
    expect(result.confidence).toBe(1);
  });

  it("rejects empty fused prompt text", () => {
    expect(() => normalizeFusedPromptResult({})).toThrow("fused_prompt 不能为空");
  });

  it("rejects placeholder tokens in fused prompt text", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: "对这张图片进行风格化重绘：保持图中主要主体不变，并将 [MAIN_TITLE] 放在画面上方。"
      })
    ).toThrow("fused_prompt 不能包含占位符");
  });

  it("rejects image order references in fused prompt text", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: "请按照第二张图保留主要主体，并迁移第一张图的排版、配色和光影。"
      })
    ).toThrow("fused_prompt 不能使用");
  });

  it("rejects dual-image wording like 主体照片 and 同时提供照片", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: "请同时提供一张主体照片，保持照片中最清晰的人物不变，并迁移冷调商务构图。"
      })
    ).toThrow("fused_prompt 不能使用");

    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: "保持主体参考图中的人物不变，并迁移冷调商务海报式构图和低饱和配色。"
      })
    ).toThrow("fused_prompt 不能使用");
  });

  it("rejects image order references across fused JSON fields", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          subject_reference_policy: "只保留第二张图里的主要主体。",
          generation_guidance: {
            copy_ready_prompt: cleanFusedPrompt
          }
        }
      })
    ).toThrow("fused_prompt_json.subject_reference_policy 不能使用");
  });

  it("normalizes unsafe image reference guidance to the canonical single-image instruction", () => {
    const result = normalizeFusedPromptResult({
      fused_prompt: cleanFusedPrompt,
      fused_prompt_json: {
        generation_guidance: {
          image_reference_instruction: "请把主体照片和参考图一起提交给生图模型。",
          copy_ready_prompt: cleanFusedPrompt
        }
      }
    });

    expect(result.fused_prompt_json.generation_guidance.image_reference_instruction).toContain("这张需要改造的图片");
    expect(result.fused_prompt_json.generation_guidance.image_reference_instruction).not.toContain("主体照片");
    expect(result.fused_prompt_json.generation_guidance.image_reference_instruction).not.toContain("参考图");
  });

  it("rejects image order references across wardrobe transfer fields", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          wardrobe_transfer: {
            transfer_instruction: "把第一张图人物服装换到图中人物身上。"
          },
          generation_guidance: {
            copy_ready_prompt: cleanFusedPrompt
          }
        }
      })
    ).toThrow("fused_prompt_json.wardrobe_transfer.transfer_instruction 不能使用");
  });

  it("rejects image order references across pose transfer fields", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          pose_transfer: {
            transfer_instruction: "把第一张图人物的站姿和手势应用到图中主要人物身上。"
          },
          generation_guidance: {
            copy_ready_prompt: cleanFusedPrompt
          }
        }
      })
    ).toThrow("fused_prompt_json.pose_transfer.transfer_instruction 不能使用");
  });

  it("uses copy_ready_prompt as the fallback final prompt", () => {
    const result = normalizeFusedPromptResult({
      fused_prompt_json: {
        generation_guidance: {
          copy_ready_prompt:
            "对这张图片进行风格化重绘：保留图中最清晰的前景主体，并迁移中心构图、青绿色点缀配色和柔和窗边光影。"
        }
      }
    });

    expect(result.fused_prompt).toBe(result.fused_prompt_json.generation_guidance.copy_ready_prompt);
  });

  it("rejects placeholder tokens in fused style reference prompts", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          style_reference: {
            layout_prompt: "将主要主体放在 [SUBJECT_GROUP] 原来的视觉重心位置。"
          }
        }
      })
    ).toThrow("fused_prompt_json.style_reference.layout_prompt 不能包含占位符");
  });

  it("allows the fixed social cover placeholders only in social_cover_text_layout", () => {
    const result = normalizeFusedPromptResult({
      fused_prompt: cleanFusedPrompt,
      fused_prompt_json: {
        social_cover_text_layout: {
          aspect_ratio_placeholder: "使用 [SOCIAL_ASPECT_RATIO] 设置小红书封面比例。",
          top_text_placeholder: "在上方安全区放置 [TOP_SUPER_TITLE]，使用超大粗体、居中对齐和清晰描边。",
          bottom_text_placeholder: "在下方安全区放置 [BOTTOM_SUPER_TITLE]，与上方标题保持工整对齐。",
          typography_style: "粗黑体标题配合轻微描边和柔和投影。",
          alignment_and_safe_area: "上下标题保持网格对齐，避开主体面部和产品焦点。",
          text_replacement_policy: "不照抄这张图片中原有的任何文字，只保留可替换标题区域。"
        }
      }
    });

    expect(result.fused_prompt_json.social_cover_text_layout.aspect_ratio_placeholder).toContain("[SOCIAL_ASPECT_RATIO]");
  });

  it("rejects unsupported placeholders in social cover text layout", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          social_cover_text_layout: {
            top_text_placeholder: "在上方放置 [MAIN_TITLE]。"
          }
        }
      })
    ).toThrow("fused_prompt_json.social_cover_text_layout.top_text_placeholder 不能包含不支持的占位符");
  });

  it("rejects mostly English fused prompt text", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: "Create a clean poster style with strong typography and vivid colors."
      })
    ).toThrow("fused_prompt 必须使用中文提示词");
  });

  it("rejects vague source image labels in fused prompt text", () => {
    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: "请参考随附主体图，保留主要主体，并迁移目标视觉风格图的排版和光影。"
      })
    ).toThrow("fused_prompt 不能使用");
  });

  it("keeps legacy dual-image wording readable in lenient mode", () => {
    const result = normalizeFusedPromptResult(
      {
        fused_prompt: "请同时提供一张主体照片，保持照片中最清晰前景人物的外貌和形态特征不变，并迁移冷调商务海报式构图。"
      },
      { enforceRules: false }
    );

    expect(result.fused_prompt).toContain("主体照片");
  });

  it("exempts user-provided edited text from the Chinese enforcement", () => {
    const englishHeavyField =
      "Premium Wireless Headphones Pro Max Edition Long Battery Life Comfortable Fit 标题排版";
    const userText =
      "# Premium Wireless Headphones Pro Max Edition\n- Long Battery Life\n- Comfortable Fit";

    expect(() =>
      normalizeFusedPromptResult({
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          style_reference: { typography_prompt: englishHeavyField }
        }
      })
    ).toThrow("必须使用中文提示词");

    const result = normalizeFusedPromptResult(
      {
        fused_prompt: cleanFusedPrompt,
        fused_prompt_json: {
          style_reference: { typography_prompt: englishHeavyField }
        }
      },
      { userText }
    );

    expect(result.fused_prompt_json.style_reference.typography_prompt).toContain("Premium Wireless Headphones");
  });

  it("forbids social cover placeholders when edited text is injected", () => {
    expect(() =>
      normalizeFusedPromptResult(
        {
          fused_prompt: cleanFusedPrompt,
          fused_prompt_json: {
            social_cover_text_layout: {
              top_text_placeholder: "在上方安全区放置 [TOP_SUPER_TITLE]。"
            }
          }
        },
        { userText: "# 春季新品礼盒" }
      )
    ).toThrow("fused_prompt_json.social_cover_text_layout.top_text_placeholder 不能包含占位符");
  });

  it("uses placeholder-free social cover defaults when edited text is injected", () => {
    const result = normalizeFusedPromptResult(
      { fused_prompt: cleanFusedPrompt },
      { userText: "# 春季新品礼盒" }
    );

    const socialCover = result.fused_prompt_json.social_cover_text_layout;
    expect(socialCover.top_text_placeholder).not.toContain("[");
    expect(socialCover.bottom_text_placeholder).not.toContain("[");
    expect(socialCover.aspect_ratio_placeholder).not.toContain("[");
    expect(socialCover.text_replacement_policy).toContain("用户编辑后的图中文字");
  });
});
