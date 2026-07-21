import type { StyleAnalysis } from "./types";

const TASK_DECLARATION =
  "只使用文字生成一张全新的画面。复用以下解析出的视觉风格、设计语言和排版系统，但不要复用原图的具体内容。";

const TEXT_EXECUTION_RULES =
  "把最终可见文字中的 Markdown 结构转换为画面文字层级：标题对应主标题或分组标题，列表对应有序的信息条目，表格对应对齐的行列结构，加粗内容对应重点信息。保持文字原有顺序、分组和强调关系。";

const PLACEHOLDER_RULES =
  "版式模板中的 [MAIN_TITLE]、[SUBTITLE]、[SUPPORTING_TEXT]、[SUBJECT_GROUP]、[MAIN_OBJECT]、[DATA_CALLOUT] 等占位符只表示版式槽位，不得把占位符本身渲染为可见文字；用户编辑稿没有对应内容的槽位直接省略。";

const CONTENT_BOUNDARY =
  "最终画面只允许出现“最终可见文字”中的文字。不得恢复原图旧文案，不得沿用或补充原图品牌、Logo、价格、型号、日期、数据，也不得添加用户未提供的事实或营销表达。";

const clean = (value: string | null | undefined): string => (typeof value === "string" ? value.trim() : "");

const uniqueFragments = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>();
  return values.reduce<string[]>((result, value) => {
    const fragment = clean(value);
    if (!fragment || seen.has(fragment)) return result;
    seen.add(fragment);
    result.push(fragment);
    return result;
  }, []);
};

const section = (title: string, body: string): string => `${title}\n${body}`;

export const buildDirectTextToImagePrompt = (
  analysis: StyleAnalysis,
  editedTextMarkdown: string
): string => {
  const guidance = clean(analysis.generation_guidance?.for_text_to_image);
  const styleFragments = guidance
    ? [guidance]
    : uniqueFragments([
        analysis.style_reference?.universal_style_prompt,
        analysis.style_reference?.layout_prompt,
        analysis.style_reference?.color_prompt,
        analysis.style_reference?.lighting_prompt,
        analysis.style_reference?.typography_prompt,
        analysis.style_reference?.decorative_elements_prompt
      ]);
  const layoutTemplate = clean(
    analysis.information_layout_template?.applies
      ? analysis.information_layout_template.copy_ready_json_prompt
      : analysis.editable_template?.prompt_template
  );
  const visibleText = clean(editedTextMarkdown);
  const negativePrompt = clean(analysis.style_reference?.negative_prompt);

  const parts = [section("任务声明", TASK_DECLARATION)];
  if (styleFragments.length) {
    parts.push(section("文生图基础说明", styleFragments.join("\n\n")));
  }
  if (layoutTemplate && !styleFragments.includes(layoutTemplate)) {
    parts.push(section("版式模板", layoutTemplate));
  }
  if (visibleText) {
    parts.push(section("最终可见文字（必须原样使用）", visibleText));
  }
  parts.push(section("文字执行规则", TEXT_EXECUTION_RULES));
  parts.push(section("占位符规则", PLACEHOLDER_RULES));
  parts.push(section("内容边界", CONTENT_BOUNDARY));
  if (negativePrompt && !styleFragments.includes(negativePrompt) && negativePrompt !== layoutTemplate) {
    parts.push(section("负面约束", negativePrompt));
  }

  return parts.join("\n\n");
};
