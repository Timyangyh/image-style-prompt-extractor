import { describe, expect, it } from "vitest";
import { buildFuseUserPrompt, buildSystemPrompt } from "./prompt";

describe("image analysis prompt", () => {
  it("requires a complete generalized text-to-image instruction", () => {
    const prompt = buildSystemPrompt(true);

    expect(prompt).toContain("generation_guidance.for_text_to_image");
    expect(prompt).toContain("完整中文说明");
    expect(prompt).toContain("视觉风格、构图与排版系统、文字层级、配色、光影、字体气质、装饰语言和可替换内容槽位");
    expect(prompt).toContain("禁止写入原图具体文案、品牌、Logo、价格、型号、日期和数据");
    expect(prompt).toContain("[MAIN_TITLE]");
    expect(prompt).toContain("把专有内容抽象成占位符");
  });
});

describe("fusion prompt controls", () => {
  it("defaults to preserving subject hair and pose from the single input image", () => {
    const prompt = buildFuseUserPrompt("{}");

    expect(prompt).toContain("必须以图中主要人物自己的发型");
    expect(prompt).toContain("必须以图中主要人物自己的身体姿态");
    expect(prompt).toContain("不要迁移其他来源的发型结构或头发质感");
    expect(prompt).toContain("不要迁移其他来源的姿态动作");
  });

  it("can apply parsed style hair and pose references", () => {
    const prompt = buildFuseUserPrompt("{}", {
      useTargetHair: true,
      useTargetPose: true,
      useExtractedText: false
    });

    expect(prompt).toContain("visual_system.subject_appearance.hair_makeup_accessory_style");
    expect(prompt).toContain("visual_system.subject_appearance.pose_expression_style");
    expect(prompt).toContain("不要求保留原有发型");
    expect(prompt).toContain("不要求保留原有姿态");
  });

  it("frames the fused prompt as a single-image edit instruction", () => {
    const prompt = buildFuseUserPrompt("{}");

    expect(prompt).toContain("对这张图片进行改造");
    expect(prompt).toContain("只能看到这一张图片");
    expect(prompt).toContain("不要出现“请同时提供一张照片”");
    expect(prompt).toContain("保持段 → 改造段 → 负面段");
  });

  it("describes the information layout mode boundary", () => {
    const prompt = buildFuseUserPrompt(
      "{}",
      undefined,
      "information_layout",
      "产品 A：轻薄机身，长续航，对比产品 B 更适合通勤。"
    );

    expect(prompt).toContain("当前任务模式：information_layout");
    expect(prompt).toContain("这段文字就是最终画面中允许出现的唯一产品文字信息");
    expect(prompt).toContain("样式来源中的原文案、品牌、价格、型号、日期、数据和具体产品名都不能写入最终结果");
    expect(prompt).toContain("不得新增任何未输入的补充文字、卖点、参数、结论或营销表达");
    expect(prompt).toContain("如果用户输入中没有提供某个卡片、表格行或标签所需内容");
    expect(prompt).toContain("information_layout_adaptation.applies 必须为 true");
    expect(prompt).not.toContain("代入解析出的发型和头发质感");
  });

  it("injects edited extracted text as the only visible text when enabled", () => {
    const prompt = buildFuseUserPrompt(
      "{}",
      { useTargetHair: false, useTargetPose: false, useExtractedText: true },
      "subject_reference",
      "",
      "# 新品春季限定礼盒\n- 三层手工包装\n- 附赠定制贺卡"
    );

    expect(prompt).toContain("用户编辑后的图中文字");
    expect(prompt).toContain("# 新品春季限定礼盒");
    expect(prompt).toContain("唯一可读文字");
    expect(prompt).toContain("本次不使用 [SOCIAL_ASPECT_RATIO]");
  });

  it("keeps placeholder text zones when extracted text injection is off", () => {
    const prompt = buildFuseUserPrompt(
      "{}",
      undefined,
      "subject_reference",
      "",
      "# 新品春季限定礼盒"
    );

    expect(prompt).not.toContain("用户编辑后的图中文字");
    expect(prompt).toContain("[TOP_SUPER_TITLE]");
  });

  it("ignores extracted text injection in information layout mode", () => {
    const prompt = buildFuseUserPrompt(
      "{}",
      { useTargetHair: false, useTargetPose: false, useExtractedText: true },
      "information_layout",
      "产品文字",
      "# 标题"
    );

    expect(prompt).not.toContain("用户编辑后的图中文字");
  });
});
