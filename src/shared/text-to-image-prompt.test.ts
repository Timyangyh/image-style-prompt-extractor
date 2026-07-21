import { describe, expect, it } from "vitest";
import { emptyStyleAnalysis } from "./schema";
import { buildDirectTextToImagePrompt } from "./text-to-image-prompt";

describe("buildDirectTextToImagePrompt", () => {
  it("prefers the complete text-to-image guidance", () => {
    const analysis = emptyStyleAnalysis();
    analysis.generation_guidance.for_text_to_image = "完整文生图说明";
    analysis.style_reference.universal_style_prompt = "不应进入结果的回退说明";

    const prompt = buildDirectTextToImagePrompt(analysis, "# 新标题");

    expect(prompt).toContain("完整文生图说明");
    expect(prompt).not.toContain("不应进入结果的回退说明");
  });

  it("falls back to all legacy style fragments and removes exact duplicates", () => {
    const analysis = emptyStyleAnalysis();
    analysis.style_reference = {
      universal_style_prompt: "通用视觉风格",
      layout_prompt: "排版系统",
      color_prompt: "配色关系",
      lighting_prompt: "柔和侧光",
      typography_prompt: "排版系统",
      decorative_elements_prompt: "几何装饰",
      negative_prompt: "避免杂乱背景"
    };

    const prompt = buildDirectTextToImagePrompt(analysis, "");

    expect(prompt).toContain("通用视觉风格");
    expect(prompt).toContain("配色关系");
    expect(prompt).toContain("柔和侧光");
    expect(prompt).toContain("几何装饰");
    expect(prompt.match(/^排版系统$/gm)).toHaveLength(1);
  });

  it("uses the information layout template for information graphics", () => {
    const analysis = emptyStyleAnalysis();
    analysis.information_layout_template.applies = true;
    analysis.information_layout_template.copy_ready_json_prompt = "信息卡片版式";

    const prompt = buildDirectTextToImagePrompt(analysis, "# 数据概览");

    expect(prompt).toContain("信息卡片版式");
    expect(prompt).not.toContain(analysis.editable_template.prompt_template);
  });

  it("uses the editable template for ordinary posters", () => {
    const analysis = emptyStyleAnalysis();
    analysis.editable_template.prompt_template = "普通海报版式 [MAIN_TITLE]";

    const prompt = buildDirectTextToImagePrompt(analysis, "# 夏日新章");

    expect(prompt).toContain("普通海报版式 [MAIN_TITLE]");
  });

  it("preserves edited Markdown exactly and never restores extracted source text", () => {
    const analysis = emptyStyleAnalysis();
    analysis.extracted_text = {
      applies: true,
      markdown: "# 已删除的原图标题\n- 旧卖点",
      extraction_notes: ""
    };
    const edited = "# 全新标题\n\n## 参数\n\n| 项目 | 内容 |\n| --- | --- |\n| 续航 | **全天** |\n\n- 轻巧\n- 安静";

    const prompt = buildDirectTextToImagePrompt(analysis, edited);

    expect(prompt).toContain(`最终可见文字（必须原样使用）\n${edited}\n\n文字执行规则`);
    expect(prompt).not.toContain("已删除的原图标题");
    expect(prompt).not.toContain("旧卖点");
  });

  it("skips empty fragments, explains placeholder handling, and appends the negative prompt", () => {
    const analysis = emptyStyleAnalysis();
    analysis.editable_template.prompt_template = "海报模板 [MAIN_TITLE] [SUBTITLE]";
    analysis.style_reference.negative_prompt = "避免小字过多和低对比";

    const prompt = buildDirectTextToImagePrompt(analysis, "  ");

    expect(prompt).not.toContain("最终可见文字（必须原样使用）");
    expect(prompt).toContain("占位符本身渲染为可见文字");
    expect(prompt).toContain("没有对应内容的槽位直接省略");
    expect(prompt).toContain("负面约束\n避免小字过多和低对比");
  });
});
