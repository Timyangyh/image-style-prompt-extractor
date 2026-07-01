import { z } from "zod";
import type {
  EditableSubjectSlot,
  EditableTemplateSlot,
  EditableWardrobeSlot,
  FusedPromptJson,
  FusedPromptResult,
  SourceCapture,
  SourceCaptureSourceType,
  StyleTerm,
  StyleAnalysis
} from "./types";

const imageTypes = [
  "product_image",
  "poster",
  "infographic",
  "chart_or_dashboard",
  "social_media_banner",
  "photography",
  "illustration",
  "ui_screenshot",
  "mixed_layout"
] as const;

const imageTypeSchema = z.enum(imageTypes);

const sourceCaptureSourceTypes = [
  "uploaded_image",
  "clipboard_image",
  "browser_viewport",
  "browser_region",
  "browser_image"
] as const;

const sourceCaptureModes = ["visible_viewport", "selected_region", "page_image"] as const;

const styleTermCategories = [
  "layout",
  "color",
  "typography",
  "material",
  "lighting",
  "ui",
  "mood",
  "rendering"
] as const;

const sourceCaptureSourceTypeSchema = z.enum(sourceCaptureSourceTypes);
const sourceCaptureModeSchema = z.enum(sourceCaptureModes);
const styleTermCategorySchema = z.enum(styleTermCategories);

const selectionRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  device_pixel_ratio: z.number().positive()
});

export const sourceCaptureSchema = z.object({
  source_type: sourceCaptureSourceTypeSchema,
  source_url: z.string(),
  page_title: z.string(),
  domain: z.string(),
  capture_mode: z.union([sourceCaptureModeSchema, z.literal("")]),
  selection_rect: selectionRectSchema,
  captured_at: z.string()
});

const editableTemplateSlotSchema = z.object({
  slot: z.string(),
  purpose: z.string(),
  recommended_position: z.string(),
  style_notes: z.string(),
  fill_value: z.literal("")
});

const editableSubjectSlotSchema = z.object({
  slot: z.string(),
  purpose: z.string(),
  count_policy: z.string(),
  recommended_position: z.string(),
  pose_or_expression_placeholder: z.string(),
  outfit_placeholder: z.string(),
  style_notes: z.string(),
  fill_value: z.literal("")
});

const editableWardrobeSlotSchema = z.object({
  slot: z.string(),
  applies_to: z.string(),
  style_function: z.string(),
  fill_value: z.literal("")
});

export const styleAnalysisSchema = z.object({
  version: z.literal("1.3"),
  analysis_mode: z.literal("style_reference_not_exact_replication"),
  source_capture: sourceCaptureSchema,
  image_classification: z.object({
    primary_type: z.union([imageTypeSchema, z.literal("")]),
    secondary_types: z.array(imageTypeSchema),
    content_domain: z.string(),
    visual_purpose: z.string()
  }),
  content_abstraction: z.object({
    original_subject_summary: z.string(),
    reusable_subject_placeholder: z.string(),
    text_handling_policy: z.literal("do_not_copy_exact_text"),
    slot_value_policy: z.literal("leave_blank_for_user_input"),
    specific_content_to_ignore: z.array(z.string()),
    generic_content_slots: z.array(z.string())
  }),
  editable_template: z.object({
    template_usage: z.string(),
    text_slots: z.array(editableTemplateSlotSchema),
    subject_slots: z.array(editableSubjectSlotSchema),
    wardrobe_slots: z.array(editableWardrobeSlotSchema),
    product_or_object_slots: z.array(editableTemplateSlotSchema),
    layout_keep_rules: z.array(z.string()),
    prompt_template: z.string()
  }),
  information_layout_template: z.object({
    applies: z.boolean(),
    layout_family: z.string(),
    recommended_aspect_ratio: z.string(),
    structure_prompt: z.string(),
    table_or_card_layout_prompt: z.string(),
    text_hierarchy_prompt: z.string(),
    content_slots: z.array(editableTemplateSlotSchema),
    comparison_slots: z.array(editableTemplateSlotSchema),
    copy_ready_json_prompt: z.string()
  }),
  extracted_text: z.object({
    applies: z.boolean(),
    markdown: z.string(),
    extraction_notes: z.string()
  }),
  style_reference: z.object({
    universal_style_prompt: z.string(),
    layout_prompt: z.string(),
    color_prompt: z.string(),
    lighting_prompt: z.string(),
    typography_prompt: z.string(),
    decorative_elements_prompt: z.string(),
    negative_prompt: z.string()
  }),
  visual_system: z.object({
    composition: z.object({
      layout_type: z.string(),
      grid_or_alignment: z.string(),
      visual_hierarchy: z.string(),
      information_density: z.string(),
      spacing_style: z.string(),
      focal_area: z.string()
    }),
    color: z.object({
      palette: z.array(z.string()),
      dominant_colors: z.array(z.string()),
      accent_colors: z.array(z.string()),
      background_color_strategy: z.string(),
      contrast_level: z.string(),
      saturation_level: z.string(),
      temperature: z.string()
    }),
    typography: z.object({
      has_text: z.boolean(),
      font_mood: z.string(),
      font_weight_strategy: z.string(),
      title_body_relationship: z.string(),
      text_block_layout: z.string(),
      copy_exact_text: z.literal(false)
    }),
    product_or_object_presentation: z.object({
      applies: z.boolean(),
      object_positioning: z.string(),
      background_treatment: z.string(),
      shadow_reflection_style: z.string(),
      material_emphasis: z.string(),
      commercial_visual_style: z.string()
    }),
    chart_or_infographic: z.object({
      applies: z.boolean(),
      chart_types: z.array(z.string()),
      data_visual_style: z.string(),
      axis_grid_style: z.string(),
      label_style: z.string(),
      highlight_strategy: z.string(),
      data_exactness_policy: z.literal("do_not_copy_values")
    }),
    poster_or_banner: z.object({
      applies: z.boolean(),
      headline_position: z.string(),
      subtext_position: z.string(),
      callout_style: z.string(),
      decorative_layout: z.string(),
      campaign_mood: z.string()
    }),
    lighting_and_depth: z.object({
      light_type: z.string(),
      shadow_style: z.string(),
      depth_style: z.string(),
      camera_angle_or_perspective: z.string(),
      lens_feel: z.string()
    }),
    subject_appearance: z.object({
      applies: z.boolean(),
      subject_role_style: z.string(),
      wardrobe_style: z.string(),
      outfit_color_materials: z.string(),
      hair_makeup_accessory_style: z.string(),
      pose_expression_style: z.string(),
      scene_fit_notes: z.string(),
      transfer_limit: z.string()
    })
  }),
  web_design_context: z.object({
    applies: z.boolean(),
    page_style_summary: z.string(),
    layout_system: z.string(),
    ui_component_style: z.string(),
    interaction_surface_style: z.string(),
    css_token_hints: z.object({
      colors: z.array(z.string()),
      font_mood: z.string(),
      radius_style: z.string(),
      shadow_style: z.string(),
      spacing_density: z.string()
    })
  }),
  style_terms: z.array(
    z.object({
      name: z.string(),
      category: styleTermCategorySchema,
      confidence: z.number().min(0).max(1),
      copyable: z.boolean()
    })
  ),
  generation_guidance: z.object({
    for_image_to_image: z.string(),
    for_text_to_image: z.string(),
    for_style_transfer: z.string(),
    replaceable_content_slots: z.array(z.string()),
    recommended_aspect_ratio: z.string(),
    recommended_style_strength: z.string()
  }),
  quality_control: z.object({
    must_preserve: z.array(z.string()),
    must_not_copy: z.array(z.string()),
    risk_notes: z.array(z.string()),
    confidence: z.number().min(0).max(1)
  })
});

export const fusedPromptResultSchema = z.object({
  fused_prompt: z.string().min(1),
  fused_prompt_json: z.object({
    subject_reference_policy: z.string(),
    style_transfer_scope: z.string(),
    pose_transfer: z.object({
      target_pose_reference: z.string(),
      transfer_instruction: z.string(),
      subject_identity_boundary: z.string(),
      scene_fit_instruction: z.string(),
      negative_prompt: z.string()
    }),
    wardrobe_transfer: z.object({
      target_wardrobe_style: z.string(),
      transfer_instruction: z.string(),
      subject_identity_boundary: z.string(),
      scene_fit_instruction: z.string(),
      negative_prompt: z.string()
    }),
    style_reference: z.object({
      universal_style_prompt: z.string(),
      layout_prompt: z.string(),
      color_prompt: z.string(),
      lighting_prompt: z.string(),
      typography_prompt: z.string(),
      decorative_elements_prompt: z.string(),
      negative_prompt: z.string()
    }),
    social_cover_text_layout: z.object({
      aspect_ratio_placeholder: z.string(),
      top_text_placeholder: z.string(),
      bottom_text_placeholder: z.string(),
      typography_style: z.string(),
      alignment_and_safe_area: z.string(),
      text_replacement_policy: z.string()
    }),
    information_layout_adaptation: z.object({
      applies: z.boolean(),
      source_layout_reference: z.string(),
      product_information_source: z.string(),
      content_mapping_instruction: z.string(),
      table_or_card_structure: z.string(),
      copy_ready_json_prompt: z.string(),
      negative_prompt: z.string()
    }),
    generation_guidance: z.object({
      image_reference_instruction: z.string(),
      style_strength: z.string(),
      copy_ready_prompt: z.string().min(1)
    }),
    quality_control: z.object({
      must_preserve: z.array(z.string()),
      must_not_copy: z.array(z.string()),
      risk_notes: z.array(z.string())
    })
  }),
  subject_policy: z.string(),
  style_transfer_scope: z.string(),
  risk_notes: z.array(z.string()),
  confidence: z.number().min(0).max(1)
});

export const emptyStyleAnalysis = (): StyleAnalysis => ({
  version: "1.3",
  analysis_mode: "style_reference_not_exact_replication",
  source_capture: {
    source_type: "uploaded_image",
    source_url: "",
    page_title: "",
    domain: "",
    capture_mode: "",
    selection_rect: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      device_pixel_ratio: 1
    },
    captured_at: ""
  },
  image_classification: {
    primary_type: "",
    secondary_types: [],
    content_domain: "",
    visual_purpose: ""
  },
  content_abstraction: {
    original_subject_summary: "",
    reusable_subject_placeholder: "",
    text_handling_policy: "do_not_copy_exact_text",
    slot_value_policy: "leave_blank_for_user_input",
    specific_content_to_ignore: [],
    generic_content_slots: []
  },
  editable_template: {
    template_usage:
      "把 fill_value 留空的占位符填成新封面需要的内容；只复用风格、配色、排版、视觉层级和装饰语言。",
    text_slots: [
      {
        slot: "[MAIN_TITLE]",
        purpose: "封面主标题，替换为新主题最醒目的标题文案",
        recommended_position: "沿用原图主标题所在的大视觉焦点区域",
        style_notes: "只继承字号层级、描边、阴影、倾斜、立体感和颜色关系，不复制原文",
        fill_value: ""
      },
      {
        slot: "[SUBTITLE]",
        purpose: "副标题或补充说明，替换为新主题的解释性文案",
        recommended_position: "沿用原图副标题或中等文字块的位置",
        style_notes: "保持与主标题的大小对比、方向和间距关系",
        fill_value: ""
      },
      {
        slot: "[SUPPORTING_TEXT]",
        purpose: "角标、卖点、标签或短促提示语",
        recommended_position: "沿用原图小标签、贴纸或角落文字区域",
        style_notes: "保留醒目色块、描边或贴纸感，但不复制具体措辞",
        fill_value: ""
      }
    ],
    subject_slots: [
      {
        slot: "[SUBJECT_GROUP]",
        purpose: "封面主体人物或产品，可以替换为任意人数、角色或主体",
        count_policy: "按新封面需求填写人数，例如 1 人、2 人、多人或无人物",
        recommended_position: "沿用原图主体的大致视觉重心和占画面比例",
        pose_or_expression_placeholder: "[POSE_OR_EXPRESSION]",
        outfit_placeholder: "[OUTFIT_STYLE]",
        style_notes: "只继承主体轮廓强调、白边、抠图感、前后景层级和视线引导",
        fill_value: ""
      }
    ],
    wardrobe_slots: [
      {
        slot: "[OUTFIT_STYLE]",
        applies_to: "[SUBJECT_GROUP]",
        style_function: "填写新封面需要的穿搭、职业造型、风格方向或服装颜色",
        fill_value: ""
      }
    ],
    product_or_object_slots: [
      {
        slot: "[MAIN_OBJECT]",
        purpose: "可替换为新封面中的核心产品、道具、图表或视觉符号",
        recommended_position: "沿用原图主要物体或装饰元素的层级位置",
        style_notes: "只继承摆放、遮挡、阴影、描边、装饰节奏和画面占比",
        fill_value: ""
      }
    ],
    layout_keep_rules: [
      "保留原图的视觉层级和注意力路径",
      "保留主标题、副标题、主体、装饰元素之间的相对位置关系",
      "文字、人物服装、人物数量、具体产品和数据均由占位符重新填写"
    ],
    prompt_template:
      "使用同款封面视觉风格：参考原图的配色、构图、文字层级、描边阴影、装饰元素和画面节奏；将主标题替换为 [MAIN_TITLE]，副标题替换为 [SUBTITLE]，辅助标签替换为 [SUPPORTING_TEXT]，主体替换为 [SUBJECT_GROUP]，人物姿态替换为 [POSE_OR_EXPRESSION]，服装造型替换为 [OUTFIT_STYLE]，不要复制原图具体文字、人物身份、穿搭、品牌、价格或数据。"
  },
  information_layout_template: {
    applies: false,
    layout_family: "",
    recommended_aspect_ratio: "",
    structure_prompt: "",
    table_or_card_layout_prompt: "",
    text_hierarchy_prompt: "",
    content_slots: [
      {
        slot: "[PRODUCT_NAME]",
        purpose: "新产品或新主题名称",
        recommended_position: "沿用资料卡中主名称或核心标题所在区域",
        style_notes: "继承字号层级、字重、对齐方式和色彩关系，不复制原图文字",
        fill_value: ""
      },
      {
        slot: "[PRODUCT_FEATURES]",
        purpose: "新产品核心卖点、参数、步骤或笔记条目",
        recommended_position: "沿用卡片、表格行、标签组或信息分区的位置",
        style_notes: "保持原有信息密度、项目符号、分组标题和行距节奏",
        fill_value: ""
      },
      {
        slot: "[DATA_CALLOUT]",
        purpose: "需要突出展示的数字、结论、对比结果或利益点",
        recommended_position: "沿用高亮标签、角标、色块或重点数据区",
        style_notes: "继承强调色、描边、底色、图标陪衬和视觉权重",
        fill_value: ""
      }
    ],
    comparison_slots: [
      {
        slot: "[COMPARISON_ITEM_A]",
        purpose: "对比表格或横向卡片中的第一项新产品信息",
        recommended_position: "沿用第一组对比列、卡片或行块位置",
        style_notes: "只继承对比区的卡片样式、分隔线、标签和层级关系",
        fill_value: ""
      },
      {
        slot: "[COMPARISON_ITEM_B]",
        purpose: "对比表格或横向卡片中的第二项新产品信息",
        recommended_position: "沿用第二组对比列、卡片或行块位置",
        style_notes: "与第一项保持同级对齐、同等卡片尺寸和同类视觉权重",
        fill_value: ""
      }
    ],
    copy_ready_json_prompt:
      "生成同款社交媒体产品资料卡 JSON 提示词：只复用已解析出的信息分区、表格/卡片结构、对齐网格、字体层级、色彩、圆角、阴影、图标点缀和留白节奏；把原图文字、品牌、价格、型号和具体数据全部替换为 [PRODUCT_NAME]、[PRODUCT_FEATURES]、[DATA_CALLOUT]、[COMPARISON_ITEM_A]、[COMPARISON_ITEM_B] 等新内容占位符。"
  },
  extracted_text: {
    applies: false,
    markdown: "",
    extraction_notes: ""
  },
  style_reference: {
    universal_style_prompt: "",
    layout_prompt: "",
    color_prompt: "",
    lighting_prompt: "",
    typography_prompt: "",
    decorative_elements_prompt: "",
    negative_prompt: ""
  },
  visual_system: {
    composition: {
      layout_type: "",
      grid_or_alignment: "",
      visual_hierarchy: "",
      information_density: "",
      spacing_style: "",
      focal_area: ""
    },
    color: {
      palette: [],
      dominant_colors: [],
      accent_colors: [],
      background_color_strategy: "",
      contrast_level: "",
      saturation_level: "",
      temperature: ""
    },
    typography: {
      has_text: false,
      font_mood: "",
      font_weight_strategy: "",
      title_body_relationship: "",
      text_block_layout: "",
      copy_exact_text: false
    },
    product_or_object_presentation: {
      applies: false,
      object_positioning: "",
      background_treatment: "",
      shadow_reflection_style: "",
      material_emphasis: "",
      commercial_visual_style: ""
    },
    chart_or_infographic: {
      applies: false,
      chart_types: [],
      data_visual_style: "",
      axis_grid_style: "",
      label_style: "",
      highlight_strategy: "",
      data_exactness_policy: "do_not_copy_values"
    },
    poster_or_banner: {
      applies: false,
      headline_position: "",
      subtext_position: "",
      callout_style: "",
      decorative_layout: "",
      campaign_mood: ""
    },
    lighting_and_depth: {
      light_type: "",
      shadow_style: "",
      depth_style: "",
      camera_angle_or_perspective: "",
      lens_feel: ""
    },
    subject_appearance: {
      applies: false,
      subject_role_style: "",
      wardrobe_style: "",
      outfit_color_materials: "",
      hair_makeup_accessory_style: "",
      pose_expression_style: "",
      scene_fit_notes: "",
      transfer_limit:
        "只记录可迁移的服装造型、轮廓、材质、颜色关系和场景适配气质，不复制品牌、logo、文字、具体身份或不可泛化的个人特征。"
    }
  },
  web_design_context: {
    applies: false,
    page_style_summary: "",
    layout_system: "",
    ui_component_style: "",
    interaction_surface_style: "",
    css_token_hints: {
      colors: [],
      font_mood: "",
      radius_style: "",
      shadow_style: "",
      spacing_density: ""
    }
  },
  style_terms: [],
  generation_guidance: {
    for_image_to_image: "",
    for_text_to_image: "",
    for_style_transfer: "",
    replaceable_content_slots: [],
    recommended_aspect_ratio: "",
    recommended_style_strength: ""
  },
  quality_control: {
    must_preserve: [],
    must_not_copy: [
      "不要复制原图中的具体文字",
      "不要复制品牌、logo、价格、日期、型号或具体数据",
      "不要把原图主体内容作为必须复现对象"
    ],
    risk_notes: [],
    confidence: 0
  }
});

type FusedPromptDefaultsOptions = {
  textInjection?: boolean;
};

const emptyFusedPromptJson = (options: FusedPromptDefaultsOptions = {}): FusedPromptJson => ({
  subject_reference_policy:
    "以图中画面占比最大、清晰度最高、视觉焦点最强的前景人物或物体作为主体依据，保持其身份和形态特征不变；不要把图片背景、边缘杂物或随机小道具写成必须保留项。",
  style_transfer_scope:
    "迁移已解析出的排版结构、配色、字体气质、光影、装饰语言和可泛化服装造型适配，不复制任何具体品牌、文案、价格、型号、日期或数据。",
  pose_transfer: {
    target_pose_reference:
      "优先参考解析 JSON 中的 subject_appearance.pose_expression_style、主体槽位、物体槽位、layout_prompt 和构图焦点，提取可迁移的人物姿态、动作、朝向、手势、视线表情气质或物体摆放动态。",
    transfer_instruction:
      "在保留图中主要主体识别度的前提下，将解析出的姿态语言自然应用到该主体身上；如果主要主体是物体，则迁移解析出的摆放角度、朝向、层叠关系和动态重心。",
    subject_identity_boundary:
      "图中主要主体的脸部、体态比例、数量、材质结构和关键识别特征必须保持原样；解析出的风格信息只提供姿态动作、肢体方向、视线表情气质、主视觉朝向或物体摆放动态。",
    scene_fit_instruction:
      "姿态要与解析出的构图重心、留白、文字层级、光影方向和场景透视自然衔接，避免主体像被硬贴到画面中。",
    negative_prompt:
      "避免引入其他来源的具体人物身份或不可泛化特征，避免让姿态破坏图中人物的身份识别度、体态比例、物体结构或物理合理性。"
  },
  wardrobe_transfer: {
    target_wardrobe_style:
      "优先参考解析 JSON 中的 subject_appearance、wardrobe_slots 和场景风格线索，提取可迁移的服装造型方向。",
    transfer_instruction:
      "在保留图中主要主体识别度的前提下，将解析出的服装轮廓、层次、材质、颜色关系和配饰气质迁移到该主体身上。",
    subject_identity_boundary:
      "图中主要主体的脸部、体态、数量、相对站位和关键识别特征必须保持原样；解析出的风格信息只改造服装造型和场景适配气质。",
    scene_fit_instruction:
      "服装造型要与解析出的场景、光影、色彩、材质和画面层级自然融合，避免像后期拼贴或错场景穿搭。",
    negative_prompt:
      "避免保留图中与新场景冲突的原始服装，避免引入任何品牌、logo、文字、价格、型号或具体身份。"
  },
  style_reference: {
    universal_style_prompt: "",
    layout_prompt: "",
    color_prompt: "",
    lighting_prompt: "",
    typography_prompt: "",
    decorative_elements_prompt: "",
    negative_prompt: ""
  },
  social_cover_text_layout: options.textInjection
    ? {
        aspect_ratio_placeholder:
          "按解析出的版式选择适合的封面比例，优先适配小红书、短视频封面或社交媒体信息流常用比例。",
        top_text_placeholder:
          "把用户编辑后图中文字里的主标题放在画面上方安全边距内，字体醒目、工整、对齐清晰，并匹配解析出的视觉风格。",
        bottom_text_placeholder:
          "把用户编辑后图中文字里的次级标题或补充信息放在画面下方安全边距内，与上方文字保持轴线、间距和视觉重量协调；没有对应内容时该区域留白。",
        typography_style:
          "根据解析出的字体气质生成标题风格，例如粗黑体、圆角综艺字、描边立体字、细腻杂志标题或科技感几何字。",
        alignment_and_safe_area:
          "文字区避开主体脸部、产品核心卖点和关键视觉焦点，保持网格对齐、边距一致、行距稳定和移动端可读性。",
        text_replacement_policy:
          "画面可见文字只来自用户编辑后的图中文字，按原文使用，不照抄图片原有文字，也不新增用户没有提供的文字。"
      }
    : {
        aspect_ratio_placeholder:
          "使用 [SOCIAL_ASPECT_RATIO] 占位符填写封面比例，优先适配小红书、短视频封面或社交媒体信息流常用比例。",
        top_text_placeholder:
          "在画面上方安全边距内预留 [TOP_SUPER_TITLE] 超大标题区，字体必须醒目、工整、对齐清晰，并匹配解析出的视觉风格。",
        bottom_text_placeholder:
          "在画面下方安全边距内预留 [BOTTOM_SUPER_TITLE] 超大标题区，与上方标题保持轴线、间距和视觉重量协调。",
        typography_style:
          "根据解析出的字体气质生成标题风格，例如粗黑体、圆角综艺字、描边立体字、细腻杂志标题或科技感几何字。",
        alignment_and_safe_area:
          "上下文字区避开主体脸部、产品核心卖点和关键视觉焦点，保持网格对齐、边距一致、行距稳定和移动端可读性。",
        text_replacement_policy:
          "不要照抄这张图片中原有的任何文字；只在这些占位符位置留出可替换文字区域，由用户后续替换成自己的标题。"
      },
  information_layout_adaptation: {
    applies: false,
    source_layout_reference:
      "仅复用已解析出的资料卡、表格、笔记页或对比卡片的设计风格和 UI 排版结构。",
    product_information_source:
      "新产品信息优先且严格来自用户输入的文字；用户输入文字时不得从产品信息图片或模型常识中补充额外可见文字。只有用户未输入文字时，才可使用当前一同提供的产品信息图片中明确可识别的产品事实；不要使用样式来源中的原文案。",
    content_mapping_instruction:
      "把新产品名称、卖点、参数、适用场景、优缺点或对比项映射到对应标题、卡片、表格行、标签、角标和重点数据区。",
    table_or_card_structure:
      "保持原有卡片数量、分栏、表格网格、分隔线、圆角、阴影、色块和图标点缀节奏，但内容换成新产品信息。",
    copy_ready_json_prompt: "",
    negative_prompt:
      "不要复制样式来源中的品牌、logo、原文案、价格、型号、日期或具体数据；不要新增用户没有输入的标题、卖点、参数、结论、适用场景、评价词或营销词；不要把新产品信息套进不合逻辑的字段。"
  },
  generation_guidance: {
    image_reference_instruction:
      "使用方式：把这张需要改造的图片和本段提示词一起提交给生图模型即可，以图中最清晰、最突出的前景主体作为身份、形态和识别特征依据，无需再提交其他图片。",
    style_strength: "高强度迁移解析出的视觉风格，但不覆盖图中主要主体的身份和形态特征。",
    copy_ready_prompt: ""
  },
  quality_control: {
    must_preserve: [
      "图中主要主体的数量、外貌、体态比例、材质、结构和关键识别特征；姿态迁移时保持自然可信"
    ],
    must_not_copy: ["具体品牌、logo、价格、型号、日期、数据数值或原文案"],
    risk_notes: []
  }
});

const singleImageReferenceInstruction = emptyFusedPromptJson().generation_guidance.image_reference_instruction;

const emptyFusedPromptResult = (options: FusedPromptDefaultsOptions = {}): FusedPromptResult => ({
  fused_prompt: "",
  fused_prompt_json: emptyFusedPromptJson(options),
  subject_policy: emptyFusedPromptJson(options).subject_reference_policy,
  style_transfer_scope: emptyFusedPromptJson(options).style_transfer_scope,
  risk_notes: [],
  confidence: 0
});

const mergeDefaults = (defaults: unknown, value: unknown): unknown => {
  if (Array.isArray(defaults)) return Array.isArray(value) ? value : defaults;
  if (typeof defaults === "boolean") return typeof value === "boolean" ? value : defaults;
  if (typeof defaults === "number") return typeof value === "number" ? value : defaults;
  if (typeof defaults === "string") return typeof value === "string" ? value : defaults;
  if (defaults && typeof defaults === "object") {
    const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return Object.fromEntries(
      Object.entries(defaults).map(([key, defaultValue]) => [
        key,
        mergeDefaults(defaultValue, (input as Record<string, unknown>)[key])
      ])
    );
  }
  return value ?? defaults;
};

const isImageType = (value: unknown): value is (typeof imageTypes)[number] =>
  typeof value === "string" && imageTypes.includes(value as (typeof imageTypes)[number]);

const isSourceCaptureSourceType = (value: unknown): value is SourceCaptureSourceType =>
  typeof value === "string" && sourceCaptureSourceTypes.includes(value as SourceCaptureSourceType);

const isSourceCaptureMode = (value: unknown): value is (typeof sourceCaptureModes)[number] =>
  typeof value === "string" && sourceCaptureModes.includes(value as (typeof sourceCaptureModes)[number]);

const isStyleTermCategory = (value: unknown): value is (typeof styleTermCategories)[number] =>
  typeof value === "string" && styleTermCategories.includes(value as (typeof styleTermCategories)[number]);

const isBrowserSourceType = (value: SourceCaptureSourceType): boolean => value.startsWith("browser_");

const scalarToText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map(scalarToText).filter(Boolean).join("，");
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = ["slot", "placeholder", "name", "label", "type", "value", "description", "purpose"];
    const parts = preferred
      .filter((key) => record[key] !== undefined)
      .map((key) => scalarToText(record[key]))
      .filter(Boolean);

    if (parts.length > 0) return parts.join("：");

    return Object.entries(record)
      .map(([key, entryValue]) => {
        const text = scalarToText(entryValue);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("；");
  }

  return "";
};

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    const text = scalarToText(value);
    return text ? [text] : [];
  }

  return value.map(scalarToText).filter(Boolean);
};

const markdownText = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(markdownText).filter(Boolean).join("\n");
  }
  return scalarToText(value);
};

const hasMostlyEnglishSentence = (value: string): boolean => {
  const withoutPlaceholders = value
    .replace(/\[[A-Z0-9_]+\]/g, "")
    .replace(/#[0-9a-fA-F]{3,8}/g, "");
  const englishWords = withoutPlaceholders.match(/[A-Za-z]{3,}/g)?.length ?? 0;
  const chineseChars = withoutPlaceholders.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return englishWords >= 6 && chineseChars < 8;
};

const enforceChinesePrompt = (fieldName: string, value: string): void => {
  if (value && hasMostlyEnglishSentence(value)) {
    throw new Error(`${fieldName} 必须使用中文提示词，请重新分析。`);
  }
};

const getTemplatePlaceholders = (value: string): string[] => value.match(/\[[A-Z0-9_]+\]/g) ?? [];

const hasTemplatePlaceholder = (value: string): boolean => getTemplatePlaceholders(value).length > 0;

const allowedSocialCoverPlaceholders = new Set([
  "[SOCIAL_ASPECT_RATIO]",
  "[TOP_SUPER_TITLE]",
  "[BOTTOM_SUPER_TITLE]"
]);

const hasImageOrderReference = (value: string): boolean => /第[一二三四五六七八九十\d]+张/.test(value);

const hasDualImagePerspectiveReference = (value: string): boolean =>
  /目标(?:视觉)?(?:参考|风格)?图|当前解析图|参考图|主体照片|随附|同时提供[^。；，]{0,10}(?:照片|图片)/.test(value);

const stripUserTextFragments = (value: string, userText?: string): string => {
  if (!userText?.trim()) return value;

  let stripped = value;
  const fragments = new Set<string>();
  for (const line of userText.split(/\r?\n/)) {
    const rawLine = line.trim();
    if (rawLine.length >= 2) fragments.add(rawLine);
    const cleanedLine = rawLine.replace(/^[#>\-*\d.、\s|]+/, "").replace(/\*\*/g, "").trim();
    if (cleanedLine.length >= 2) fragments.add(cleanedLine);
    for (const cell of rawLine.split("|")) {
      const cellText = cell.replace(/\*\*/g, "").trim();
      if (cellText.length >= 2) fragments.add(cellText);
    }
  }
  for (const fragment of fragments) {
    stripped = stripped.split(fragment).join("");
  }
  return stripped;
};

const enforceCompleteFusedPrompt = (
  fieldName: string,
  value: string,
  allowedPlaceholders: Set<string> | null = null,
  userText?: string
): void => {
  const checked = stripUserTextFragments(value, userText);
  enforceChinesePrompt(fieldName, checked);
  const placeholders = getTemplatePlaceholders(checked);
  if (checked && placeholders.length > 0 && !allowedPlaceholders) {
    throw new Error(`${fieldName} 不能包含占位符，请重新生成。`);
  }
  const disallowedPlaceholders = allowedPlaceholders
    ? placeholders.filter((placeholder) => !allowedPlaceholders.has(placeholder))
    : [];
  if (disallowedPlaceholders.length > 0) {
    throw new Error(`${fieldName} 不能包含不支持的占位符，请重新生成。`);
  }
  if (checked && hasImageOrderReference(checked)) {
    throw new Error(`${fieldName} 不能使用“第一张、第二张”这类图片顺序描述，请重新生成。`);
  }
  if (checked && hasDualImagePerspectiveReference(checked)) {
    throw new Error(
      `${fieldName} 不能使用“参考图、主体照片”这类双图指代，外部生图模型只能看到一张图，请改写成“这张图片”“图中”和具体画面描述。`
    );
  }
};

const templateSlot = (value: unknown, fallback: EditableTemplateSlot): EditableTemplateSlot => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    slot: scalarToText(record.slot) || fallback.slot,
    purpose: scalarToText(record.purpose) || fallback.purpose,
    recommended_position: scalarToText(record.recommended_position) || fallback.recommended_position,
    style_notes: scalarToText(record.style_notes) || fallback.style_notes,
    fill_value: ""
  };
};

const subjectSlot = (value: unknown, fallback: EditableSubjectSlot): EditableSubjectSlot => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    slot: scalarToText(record.slot) || fallback.slot,
    purpose: scalarToText(record.purpose) || fallback.purpose,
    count_policy: scalarToText(record.count_policy) || fallback.count_policy,
    recommended_position: scalarToText(record.recommended_position) || fallback.recommended_position,
    pose_or_expression_placeholder:
      scalarToText(record.pose_or_expression_placeholder) || fallback.pose_or_expression_placeholder,
    outfit_placeholder: scalarToText(record.outfit_placeholder) || fallback.outfit_placeholder,
    style_notes: scalarToText(record.style_notes) || fallback.style_notes,
    fill_value: ""
  };
};

const wardrobeSlot = (value: unknown, fallback: EditableWardrobeSlot): EditableWardrobeSlot => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    slot: scalarToText(record.slot) || fallback.slot,
    applies_to: scalarToText(record.applies_to) || fallback.applies_to,
    style_function: scalarToText(record.style_function) || fallback.style_function,
    fill_value: ""
  };
};

const normalizeTemplateSlots = <T>(
  values: unknown,
  fallbacks: T[],
  normalizeItem: (value: unknown, fallback: T) => T
): T[] => {
  const source = Array.isArray(values) && values.length > 0 ? values : fallbacks;
  const normalized = source.map((item, index) => normalizeItem(item, fallbacks[index] ?? fallbacks[0]));
  const existingSlots = new Set(
    normalized
      .map((item) => (item as { slot?: string }).slot)
      .filter((slot): slot is string => Boolean(slot))
  );

  for (const fallback of fallbacks) {
    const fallbackSlot = (fallback as { slot?: string }).slot;
    if (fallbackSlot && !existingSlots.has(fallbackSlot)) {
      normalized.push(fallback);
    }
  }

  return normalized;
};

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const createLocalSourceCapture = (
  sourceType: "uploaded_image" | "clipboard_image",
  capturedAt = new Date().toISOString()
): SourceCapture => ({
  source_type: sourceType,
  source_url: "",
  page_title: "",
  domain: "",
  capture_mode: "",
  selection_rect: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    device_pixel_ratio: 1
  },
  captured_at: capturedAt
});

const normalizeSourceCapture = (value: unknown, fallback: SourceCapture): SourceCapture => {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rect = record.selection_rect && typeof record.selection_rect === "object" && !Array.isArray(record.selection_rect)
    ? (record.selection_rect as Record<string, unknown>)
    : {};
  const sourceType = isSourceCaptureSourceType(record.source_type) ? record.source_type : fallback.source_type;
  const captureMode = isSourceCaptureMode(record.capture_mode) ? record.capture_mode : fallback.capture_mode;

  return {
    source_type: sourceType,
    source_url: scalarToText(record.source_url) || fallback.source_url,
    page_title: scalarToText(record.page_title) || fallback.page_title,
    domain: scalarToText(record.domain) || fallback.domain,
    capture_mode: captureMode,
    selection_rect: {
      x: finiteNumber(rect.x, fallback.selection_rect.x),
      y: finiteNumber(rect.y, fallback.selection_rect.y),
      width: finiteNumber(rect.width, fallback.selection_rect.width),
      height: finiteNumber(rect.height, fallback.selection_rect.height),
      device_pixel_ratio: Math.max(
        0.1,
        finiteNumber(rect.device_pixel_ratio, fallback.selection_rect.device_pixel_ratio)
      )
    },
    captured_at: scalarToText(record.captured_at) || fallback.captured_at
  };
};

const normalizeStyleTerms = (value: unknown): StyleTerm[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value
    .map((item): StyleTerm | null => {
      const record = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
      const name = scalarToText(record.name);
      if (!name) return null;
      const category = isStyleTermCategory(record.category) ? record.category : "mood";
      const confidence = Math.max(0, Math.min(1, finiteNumber(record.confidence, 0.8)));
      const copyable = typeof record.copyable === "boolean" ? record.copyable : true;
      return { name, category, confidence, copyable };
    })
    .filter((item): item is StyleTerm => {
      if (!item) return false;
      const key = `${item.category}:${item.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const normalizeStyleAnalysis = (
  value: unknown,
  sourceCaptureOverride?: SourceCapture,
  options: { enforceChinese?: boolean } = {}
): StyleAnalysis => {
  const defaults = emptyStyleAnalysis();
  const merged = mergeDefaults(emptyStyleAnalysis(), value) as StyleAnalysis;
  merged.version = "1.3";
  merged.analysis_mode = "style_reference_not_exact_replication";
  merged.source_capture = normalizeSourceCapture(
    sourceCaptureOverride ?? merged.source_capture,
    sourceCaptureOverride ?? defaults.source_capture
  );
  merged.image_classification.primary_type = isImageType(merged.image_classification.primary_type)
    ? merged.image_classification.primary_type
    : "";
  merged.image_classification.secondary_types = Array.isArray(merged.image_classification.secondary_types)
    ? merged.image_classification.secondary_types.filter(isImageType)
    : [];
  merged.content_abstraction.text_handling_policy = "do_not_copy_exact_text";
  merged.content_abstraction.slot_value_policy = "leave_blank_for_user_input";
  merged.content_abstraction.specific_content_to_ignore = stringArray(
    merged.content_abstraction.specific_content_to_ignore
  );
  merged.content_abstraction.generic_content_slots = stringArray(
    merged.content_abstraction.generic_content_slots
  );
  merged.content_abstraction.generic_content_slots = Array.from(
    new Set([
      ...merged.content_abstraction.generic_content_slots,
      "[MAIN_TITLE]",
      "[SUBTITLE]",
      "[SUPPORTING_TEXT]",
      "[SUBJECT_GROUP]",
      "[SUBJECT_COUNT]",
      "[POSE_OR_EXPRESSION]",
      "[OUTFIT_STYLE]",
      "[MAIN_OBJECT]",
      "[BACKGROUND_CONTEXT]",
      "[SOCIAL_ASPECT_RATIO]",
      "[TOP_SUPER_TITLE]",
      "[BOTTOM_SUPER_TITLE]",
      "[PRODUCT_NAME]",
      "[PRODUCT_FEATURES]",
      "[DATA_CALLOUT]",
      "[COMPARISON_ITEM_A]",
      "[COMPARISON_ITEM_B]"
    ])
  );
  merged.editable_template.text_slots = normalizeTemplateSlots(
    merged.editable_template.text_slots,
    defaults.editable_template.text_slots,
    templateSlot
  );
  merged.editable_template.subject_slots = normalizeTemplateSlots(
    merged.editable_template.subject_slots,
    defaults.editable_template.subject_slots,
    subjectSlot
  );
  merged.editable_template.wardrobe_slots = normalizeTemplateSlots(
    merged.editable_template.wardrobe_slots,
    defaults.editable_template.wardrobe_slots,
    wardrobeSlot
  );
  merged.editable_template.product_or_object_slots = normalizeTemplateSlots(
    merged.editable_template.product_or_object_slots,
    defaults.editable_template.product_or_object_slots,
    templateSlot
  );
  merged.editable_template.layout_keep_rules = stringArray(merged.editable_template.layout_keep_rules);
  merged.editable_template.prompt_template =
    scalarToText(merged.editable_template.prompt_template) || defaults.editable_template.prompt_template;
  merged.information_layout_template.applies = Boolean(merged.information_layout_template.applies);
  merged.information_layout_template.layout_family = scalarToText(merged.information_layout_template.layout_family);
  merged.information_layout_template.recommended_aspect_ratio = scalarToText(
    merged.information_layout_template.recommended_aspect_ratio
  );
  merged.information_layout_template.structure_prompt = scalarToText(
    merged.information_layout_template.structure_prompt
  );
  merged.information_layout_template.table_or_card_layout_prompt = scalarToText(
    merged.information_layout_template.table_or_card_layout_prompt
  );
  merged.information_layout_template.text_hierarchy_prompt = scalarToText(
    merged.information_layout_template.text_hierarchy_prompt
  );
  merged.information_layout_template.content_slots = normalizeTemplateSlots(
    merged.information_layout_template.content_slots,
    defaults.information_layout_template.content_slots,
    templateSlot
  );
  merged.information_layout_template.comparison_slots = normalizeTemplateSlots(
    merged.information_layout_template.comparison_slots,
    defaults.information_layout_template.comparison_slots,
    templateSlot
  );
  merged.information_layout_template.copy_ready_json_prompt =
    scalarToText(merged.information_layout_template.copy_ready_json_prompt) ||
    defaults.information_layout_template.copy_ready_json_prompt;
  const rawExtractedText =
    value && typeof value === "object" && !Array.isArray(value)
      ? ((value as Record<string, unknown>).extracted_text as Record<string, unknown> | undefined)
      : undefined;
  const rawMarkdown =
    rawExtractedText && typeof rawExtractedText === "object" && !Array.isArray(rawExtractedText)
      ? rawExtractedText.markdown
      : undefined;
  merged.extracted_text.markdown = markdownText(rawMarkdown ?? merged.extracted_text.markdown);
  merged.extracted_text.applies =
    Boolean(merged.extracted_text.applies) && Boolean(merged.extracted_text.markdown);
  merged.extracted_text.extraction_notes = scalarToText(merged.extracted_text.extraction_notes);
  merged.visual_system.color.palette = stringArray(merged.visual_system.color.palette);
  merged.visual_system.color.dominant_colors = stringArray(merged.visual_system.color.dominant_colors);
  merged.visual_system.color.accent_colors = stringArray(merged.visual_system.color.accent_colors);
  merged.visual_system.typography.copy_exact_text = false;
  merged.visual_system.chart_or_infographic.chart_types = stringArray(
    merged.visual_system.chart_or_infographic.chart_types
  );
  merged.visual_system.chart_or_infographic.data_exactness_policy = "do_not_copy_values";
  merged.visual_system.subject_appearance.applies = Boolean(merged.visual_system.subject_appearance.applies);
  merged.visual_system.subject_appearance.subject_role_style = scalarToText(
    merged.visual_system.subject_appearance.subject_role_style
  );
  merged.visual_system.subject_appearance.wardrobe_style = scalarToText(
    merged.visual_system.subject_appearance.wardrobe_style
  );
  merged.visual_system.subject_appearance.outfit_color_materials = scalarToText(
    merged.visual_system.subject_appearance.outfit_color_materials
  );
  merged.visual_system.subject_appearance.hair_makeup_accessory_style = scalarToText(
    merged.visual_system.subject_appearance.hair_makeup_accessory_style
  );
  merged.visual_system.subject_appearance.pose_expression_style = scalarToText(
    merged.visual_system.subject_appearance.pose_expression_style
  );
  merged.visual_system.subject_appearance.scene_fit_notes = scalarToText(
    merged.visual_system.subject_appearance.scene_fit_notes
  );
  merged.visual_system.subject_appearance.transfer_limit =
    scalarToText(merged.visual_system.subject_appearance.transfer_limit) ||
    defaults.visual_system.subject_appearance.transfer_limit;
  merged.web_design_context.applies =
    Boolean(merged.web_design_context.applies) || isBrowserSourceType(merged.source_capture.source_type);
  merged.web_design_context.css_token_hints.colors = stringArray(
    merged.web_design_context.css_token_hints.colors
  );
  merged.style_terms = normalizeStyleTerms(merged.style_terms);
  if (isBrowserSourceType(merged.source_capture.source_type) && !merged.image_classification.primary_type) {
    merged.image_classification.primary_type =
      merged.source_capture.source_type === "browser_image" ? "mixed_layout" : "ui_screenshot";
  }
  merged.generation_guidance.replaceable_content_slots = stringArray(
    merged.generation_guidance.replaceable_content_slots
  );
  merged.quality_control.must_preserve = stringArray(merged.quality_control.must_preserve);
  merged.quality_control.must_not_copy = stringArray(merged.quality_control.must_not_copy);
  merged.quality_control.risk_notes = stringArray(merged.quality_control.risk_notes);
  merged.quality_control.confidence = Math.max(0, Math.min(1, merged.quality_control.confidence));

  if (options.enforceChinese !== false) {
    enforceChinesePrompt("universal_style_prompt", merged.style_reference.universal_style_prompt);
    enforceChinesePrompt("layout_prompt", merged.style_reference.layout_prompt);
    enforceChinesePrompt("color_prompt", merged.style_reference.color_prompt);
    enforceChinesePrompt("lighting_prompt", merged.style_reference.lighting_prompt);
    enforceChinesePrompt("typography_prompt", merged.style_reference.typography_prompt);
    enforceChinesePrompt("decorative_elements_prompt", merged.style_reference.decorative_elements_prompt);
    enforceChinesePrompt("negative_prompt", merged.style_reference.negative_prompt);
    enforceChinesePrompt("prompt_template", merged.editable_template.prompt_template);
    enforceChinesePrompt(
      "information_layout_template.structure_prompt",
      merged.information_layout_template.structure_prompt
    );
    enforceChinesePrompt(
      "information_layout_template.table_or_card_layout_prompt",
      merged.information_layout_template.table_or_card_layout_prompt
    );
    enforceChinesePrompt(
      "information_layout_template.text_hierarchy_prompt",
      merged.information_layout_template.text_hierarchy_prompt
    );
    enforceChinesePrompt(
      "information_layout_template.copy_ready_json_prompt",
      merged.information_layout_template.copy_ready_json_prompt
    );
    enforceChinesePrompt(
      "subject_appearance.subject_role_style",
      merged.visual_system.subject_appearance.subject_role_style
    );
    enforceChinesePrompt("subject_appearance.wardrobe_style", merged.visual_system.subject_appearance.wardrobe_style);
    enforceChinesePrompt(
      "subject_appearance.outfit_color_materials",
      merged.visual_system.subject_appearance.outfit_color_materials
    );
    enforceChinesePrompt(
      "subject_appearance.hair_makeup_accessory_style",
      merged.visual_system.subject_appearance.hair_makeup_accessory_style
    );
    enforceChinesePrompt(
      "subject_appearance.pose_expression_style",
      merged.visual_system.subject_appearance.pose_expression_style
    );
    enforceChinesePrompt("subject_appearance.scene_fit_notes", merged.visual_system.subject_appearance.scene_fit_notes);
    enforceChinesePrompt("subject_appearance.transfer_limit", merged.visual_system.subject_appearance.transfer_limit);
  }

  const parsed = styleAnalysisSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.path.join(".")).join(", "));
  }

  return parsed.data;
};

export interface NormalizeFusedPromptOptions {
  enforceRules?: boolean;
  userText?: string;
}

export const normalizeFusedPromptResult = (
  value: unknown,
  options: NormalizeFusedPromptOptions = {}
): FusedPromptResult => {
  const userText = options.userText?.trim() || undefined;
  const textInjection = Boolean(userText);
  const defaults = emptyFusedPromptResult({ textInjection });
  const merged = mergeDefaults(defaults, value) as FusedPromptResult;
  merged.fused_prompt = scalarToText(merged.fused_prompt);
  merged.fused_prompt_json.subject_reference_policy =
    scalarToText(merged.fused_prompt_json.subject_reference_policy) ||
    defaults.fused_prompt_json.subject_reference_policy;
  merged.fused_prompt_json.style_transfer_scope =
    scalarToText(merged.fused_prompt_json.style_transfer_scope) ||
    defaults.fused_prompt_json.style_transfer_scope;
  merged.fused_prompt_json.pose_transfer.target_pose_reference =
    scalarToText(merged.fused_prompt_json.pose_transfer.target_pose_reference) ||
    defaults.fused_prompt_json.pose_transfer.target_pose_reference;
  merged.fused_prompt_json.pose_transfer.transfer_instruction =
    scalarToText(merged.fused_prompt_json.pose_transfer.transfer_instruction) ||
    defaults.fused_prompt_json.pose_transfer.transfer_instruction;
  merged.fused_prompt_json.pose_transfer.subject_identity_boundary =
    scalarToText(merged.fused_prompt_json.pose_transfer.subject_identity_boundary) ||
    defaults.fused_prompt_json.pose_transfer.subject_identity_boundary;
  merged.fused_prompt_json.pose_transfer.scene_fit_instruction =
    scalarToText(merged.fused_prompt_json.pose_transfer.scene_fit_instruction) ||
    defaults.fused_prompt_json.pose_transfer.scene_fit_instruction;
  merged.fused_prompt_json.pose_transfer.negative_prompt =
    scalarToText(merged.fused_prompt_json.pose_transfer.negative_prompt) ||
    defaults.fused_prompt_json.pose_transfer.negative_prompt;
  merged.fused_prompt_json.wardrobe_transfer.target_wardrobe_style =
    scalarToText(merged.fused_prompt_json.wardrobe_transfer.target_wardrobe_style) ||
    defaults.fused_prompt_json.wardrobe_transfer.target_wardrobe_style;
  merged.fused_prompt_json.wardrobe_transfer.transfer_instruction =
    scalarToText(merged.fused_prompt_json.wardrobe_transfer.transfer_instruction) ||
    defaults.fused_prompt_json.wardrobe_transfer.transfer_instruction;
  merged.fused_prompt_json.wardrobe_transfer.subject_identity_boundary =
    scalarToText(merged.fused_prompt_json.wardrobe_transfer.subject_identity_boundary) ||
    defaults.fused_prompt_json.wardrobe_transfer.subject_identity_boundary;
  merged.fused_prompt_json.wardrobe_transfer.scene_fit_instruction =
    scalarToText(merged.fused_prompt_json.wardrobe_transfer.scene_fit_instruction) ||
    defaults.fused_prompt_json.wardrobe_transfer.scene_fit_instruction;
  merged.fused_prompt_json.wardrobe_transfer.negative_prompt =
    scalarToText(merged.fused_prompt_json.wardrobe_transfer.negative_prompt) ||
    defaults.fused_prompt_json.wardrobe_transfer.negative_prompt;
  merged.fused_prompt_json.style_reference.universal_style_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.universal_style_prompt
  );
  merged.fused_prompt_json.style_reference.layout_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.layout_prompt
  );
  merged.fused_prompt_json.style_reference.color_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.color_prompt
  );
  merged.fused_prompt_json.style_reference.lighting_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.lighting_prompt
  );
  merged.fused_prompt_json.style_reference.typography_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.typography_prompt
  );
  merged.fused_prompt_json.style_reference.decorative_elements_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.decorative_elements_prompt
  );
  merged.fused_prompt_json.style_reference.negative_prompt = scalarToText(
    merged.fused_prompt_json.style_reference.negative_prompt
  );
  merged.fused_prompt_json.social_cover_text_layout.aspect_ratio_placeholder =
    scalarToText(merged.fused_prompt_json.social_cover_text_layout.aspect_ratio_placeholder) ||
    defaults.fused_prompt_json.social_cover_text_layout.aspect_ratio_placeholder;
  merged.fused_prompt_json.social_cover_text_layout.top_text_placeholder =
    scalarToText(merged.fused_prompt_json.social_cover_text_layout.top_text_placeholder) ||
    defaults.fused_prompt_json.social_cover_text_layout.top_text_placeholder;
  merged.fused_prompt_json.social_cover_text_layout.bottom_text_placeholder =
    scalarToText(merged.fused_prompt_json.social_cover_text_layout.bottom_text_placeholder) ||
    defaults.fused_prompt_json.social_cover_text_layout.bottom_text_placeholder;
  merged.fused_prompt_json.social_cover_text_layout.typography_style =
    scalarToText(merged.fused_prompt_json.social_cover_text_layout.typography_style) ||
    defaults.fused_prompt_json.social_cover_text_layout.typography_style;
  merged.fused_prompt_json.social_cover_text_layout.alignment_and_safe_area =
    scalarToText(merged.fused_prompt_json.social_cover_text_layout.alignment_and_safe_area) ||
    defaults.fused_prompt_json.social_cover_text_layout.alignment_and_safe_area;
  merged.fused_prompt_json.social_cover_text_layout.text_replacement_policy =
    scalarToText(merged.fused_prompt_json.social_cover_text_layout.text_replacement_policy) ||
    defaults.fused_prompt_json.social_cover_text_layout.text_replacement_policy;
  merged.fused_prompt_json.information_layout_adaptation.applies = Boolean(
    merged.fused_prompt_json.information_layout_adaptation.applies
  );
  merged.fused_prompt_json.information_layout_adaptation.source_layout_reference =
    scalarToText(merged.fused_prompt_json.information_layout_adaptation.source_layout_reference) ||
    defaults.fused_prompt_json.information_layout_adaptation.source_layout_reference;
  merged.fused_prompt_json.information_layout_adaptation.product_information_source =
    scalarToText(merged.fused_prompt_json.information_layout_adaptation.product_information_source) ||
    defaults.fused_prompt_json.information_layout_adaptation.product_information_source;
  merged.fused_prompt_json.information_layout_adaptation.content_mapping_instruction =
    scalarToText(merged.fused_prompt_json.information_layout_adaptation.content_mapping_instruction) ||
    defaults.fused_prompt_json.information_layout_adaptation.content_mapping_instruction;
  merged.fused_prompt_json.information_layout_adaptation.table_or_card_structure =
    scalarToText(merged.fused_prompt_json.information_layout_adaptation.table_or_card_structure) ||
    defaults.fused_prompt_json.information_layout_adaptation.table_or_card_structure;
  merged.fused_prompt_json.information_layout_adaptation.copy_ready_json_prompt =
    scalarToText(merged.fused_prompt_json.information_layout_adaptation.copy_ready_json_prompt);
  merged.fused_prompt_json.information_layout_adaptation.negative_prompt =
    scalarToText(merged.fused_prompt_json.information_layout_adaptation.negative_prompt) ||
    defaults.fused_prompt_json.information_layout_adaptation.negative_prompt;
  merged.fused_prompt_json.generation_guidance.image_reference_instruction =
    singleImageReferenceInstruction;
  merged.fused_prompt_json.generation_guidance.style_strength =
    scalarToText(merged.fused_prompt_json.generation_guidance.style_strength) ||
    defaults.fused_prompt_json.generation_guidance.style_strength;
  merged.fused_prompt_json.generation_guidance.copy_ready_prompt = scalarToText(
    merged.fused_prompt_json.generation_guidance.copy_ready_prompt
  );
  merged.fused_prompt_json.quality_control.must_preserve = stringArray(
    merged.fused_prompt_json.quality_control.must_preserve
  );
  merged.fused_prompt_json.quality_control.must_not_copy = stringArray(
    merged.fused_prompt_json.quality_control.must_not_copy
  );
  merged.fused_prompt_json.quality_control.risk_notes = stringArray(
    merged.fused_prompt_json.quality_control.risk_notes
  );
  if (!merged.fused_prompt && merged.fused_prompt_json.generation_guidance.copy_ready_prompt) {
    merged.fused_prompt = merged.fused_prompt_json.generation_guidance.copy_ready_prompt;
  }
  if (!merged.fused_prompt_json.generation_guidance.copy_ready_prompt && merged.fused_prompt) {
    merged.fused_prompt_json.generation_guidance.copy_ready_prompt = merged.fused_prompt;
  }
  merged.subject_policy = scalarToText(merged.subject_policy) || defaults.subject_policy;
  merged.style_transfer_scope = scalarToText(merged.style_transfer_scope) || defaults.style_transfer_scope;
  merged.risk_notes = stringArray(merged.risk_notes);
  merged.confidence = Math.max(0, Math.min(1, finiteNumber(merged.confidence, defaults.confidence)));

  if (!merged.fused_prompt) {
    throw new Error("fused_prompt 不能为空，请重新生成。");
  }
  if (options.enforceRules !== false) {
    const socialCoverAllowedPlaceholders = textInjection ? null : allowedSocialCoverPlaceholders;
    enforceCompleteFusedPrompt("fused_prompt", merged.fused_prompt, null, userText);
    enforceCompleteFusedPrompt(
      "fused_prompt_json.subject_reference_policy",
      merged.fused_prompt_json.subject_reference_policy,
      null,
      userText
    );
    enforceCompleteFusedPrompt(
      "fused_prompt_json.style_transfer_scope",
      merged.fused_prompt_json.style_transfer_scope,
      null,
      userText
    );
    Object.entries(merged.fused_prompt_json.pose_transfer).forEach(([fieldName, promptText]) => {
      if (promptText) {
        enforceCompleteFusedPrompt(`fused_prompt_json.pose_transfer.${fieldName}`, promptText, null, userText);
      }
    });
    Object.entries(merged.fused_prompt_json.wardrobe_transfer).forEach(([fieldName, promptText]) => {
      if (promptText) {
        enforceCompleteFusedPrompt(`fused_prompt_json.wardrobe_transfer.${fieldName}`, promptText, null, userText);
      }
    });
    enforceCompleteFusedPrompt(
      "fused_prompt_json.generation_guidance.copy_ready_prompt",
      merged.fused_prompt_json.generation_guidance.copy_ready_prompt,
      null,
      userText
    );
    enforceCompleteFusedPrompt(
      "fused_prompt_json.generation_guidance.image_reference_instruction",
      merged.fused_prompt_json.generation_guidance.image_reference_instruction,
      null,
      userText
    );
    enforceCompleteFusedPrompt(
      "fused_prompt_json.generation_guidance.style_strength",
      merged.fused_prompt_json.generation_guidance.style_strength,
      null,
      userText
    );
    Object.entries(merged.fused_prompt_json.style_reference).forEach(([fieldName, promptText]) => {
      if (promptText) {
        enforceCompleteFusedPrompt(`fused_prompt_json.style_reference.${fieldName}`, promptText, null, userText);
      }
    });
    Object.entries(merged.fused_prompt_json.social_cover_text_layout).forEach(([fieldName, promptText]) => {
      if (promptText) {
        enforceCompleteFusedPrompt(
          `fused_prompt_json.social_cover_text_layout.${fieldName}`,
          promptText,
          socialCoverAllowedPlaceholders,
          userText
        );
      }
    });
    Object.entries(merged.fused_prompt_json.information_layout_adaptation).forEach(([fieldName, promptText]) => {
      if (typeof promptText === "string" && promptText) {
        enforceCompleteFusedPrompt(
          `fused_prompt_json.information_layout_adaptation.${fieldName}`,
          promptText,
          null,
          userText
        );
      }
    });
    Object.entries(merged.fused_prompt_json.quality_control).forEach(([fieldName, values]) => {
      values.forEach((promptText, index) => {
        if (promptText) {
          enforceCompleteFusedPrompt(
            `fused_prompt_json.quality_control.${fieldName}.${index}`,
            promptText,
            null,
            userText
          );
        }
      });
    });
    enforceCompleteFusedPrompt("subject_policy", merged.subject_policy, null, userText);
    enforceCompleteFusedPrompt("style_transfer_scope", merged.style_transfer_scope, null, userText);
    merged.risk_notes.forEach((promptText, index) => {
      if (promptText) enforceCompleteFusedPrompt(`risk_notes.${index}`, promptText, null, userText);
    });
  }

  const parsed = fusedPromptResultSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.path.join(".")).join(", "));
  }

  return parsed.data;
};
