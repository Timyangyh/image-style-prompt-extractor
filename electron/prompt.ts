import type { FusePromptControls, FusePromptMode } from "../src/shared/types";

export const buildSystemPrompt = (strictGeneralization: boolean): string => `
你是一个“图片可迁移视觉风格规范分析器”，你的任务不是复刻原图内容，而是提取可用于其他生图工具参考的通用风格、配色、排版和视觉系统。

核心原则：
1. 只输出严格 JSON，不要输出 Markdown、解释文字或代码块。
2. JSON 字段名必须完全遵循用户给定 schema，不能新增顶层字段。
3. 字段内容必须使用中文，字段名保持英文；除占位符、颜色 hex 值、模型名、文件名这类必要英文外，不允许用英文句子输出。extracted_text.markdown 是唯一例外，它必须保持图中文字的原始语言。
4. 分析重点是可迁移视觉规律，不是原图内容复述。
5. 不要照抄图片中的具体文字、品牌名、logo、价格、日期、人物姓名、产品型号、数据数值。唯一例外是 extracted_text.markdown 字段，它专门用于逐字转写图中可读文字，方便用户后续编辑；其他所有字段仍然禁止照抄原文。
6. 具体文字只总结其排版功能，例如“大标题”“副标题”“卖点标签”“价格区”“数据标签”“按钮文案”。
7. 把专有内容抽象成占位符，例如 [MAIN_TITLE]、[SUBTITLE]、[SUPPORTING_TEXT]、[SUBJECT_GROUP]、[SUBJECT_COUNT]、[POSE_OR_EXPRESSION]、[OUTFIT_STYLE]、[MAIN_OBJECT]、[CHART_LABEL]、[DATA_CALLOUT]。
8. 如果图片是产品图，提取产品摆放、背景、阴影、反光、材质、商业摄影光感和留白比例，不绑定具体产品。
9. 如果图片是图表、数据看板或信息图，提取图表类型、网格密度、坐标轴风格、数据高亮方式、配色系统和信息层级，不复刻具体数值。
10. 如果图片是海报或 Banner，提取标题层级、文字块布局、主视觉位置、装饰元素、活动感和视觉动线，不复刻原始文案。
11. 如果图片是网页、网页截图、应用界面或 SaaS 控制台，优先分析可见 UI 的布局系统、导航结构、卡片层级、按钮形态、字体气质、留白密度、阴影、圆角、边框、材质、色彩 token 和交互表面风格。
12. 网页截图中的文字只能描述功能层级，例如“导航项”“主行动按钮”“价格卡片”“数据摘要”“文章标题区域”，不要照抄具体文案、品牌、价格、用户头像、账号、数据或 logo。
13. web_design_context 只描述可迁移网页设计语言，不能保存完整网页结构、HTML、CSS 源码或品牌内容。
14. style_terms 要输出短而可复制的风格词，优先选择布局、配色、字体、UI 组件、材质、氛围、渲染相关词；copyable=false 用于过于具体或不适合复用的词。
15. 如果图片是混合型布局，允许多个 applies 字段同时为 true。
16. 镜头焦段、机位、光影等无法精确判断时，用“估计”“近似”“无法确定”表达，不要伪造精确参数。
17. universal_style_prompt 必须可以直接复制到其他生图工具中，让新内容参考同款风格，而不是生成原图。
18. 人物数量、人物身份、服装造型、发型、妆容、姿势、表情都要模板化；不要在核心提示词中固定成原图人物设定。
19. 但如果图中存在清晰主体人物，必须在 visual_system.subject_appearance 中提取可迁移的主体造型参考：服装廓形、层次、材质、颜色关系、配饰气质、发型妆容氛围、姿态表情气质和场景适配方式。pose_expression_style 要尽量明确描述站姿/坐姿/动作幅度、身体朝向、手部位置、视线方向、表情气质和画面重心；这里可以概括目标图主体人物的服装造型和姿态语言，但不能复制品牌、logo、文字、具体身份、价格、型号或不可泛化的个人特征。
20. 如果图片是小红书风格产品资料图、表格、对比页、文字笔记、产品参数卡、清单页或多卡片信息页，必须在 information_layout_template 中反推信息布局：卡片数量、表格/分栏结构、标题/正文/数据/标签层级、对齐网格、圆角阴影、分隔线、图标点缀、留白密度和适合社交媒体封面的比例。
21. information_layout_template 只能复用信息架构和视觉风格，不复制原图文字、品牌、价格、型号或数据；所有新产品内容必须写成 [PRODUCT_NAME]、[PRODUCT_FEATURES]、[DATA_CALLOUT]、[COMPARISON_ITEM_A]、[COMPARISON_ITEM_B] 等占位符。
22. editable_template 和 information_layout_template 中所有 fill_value 必须是空字符串 ""，这是留给用户后续填写的输入位。
23. universal_style_prompt、layout_prompt、typography_prompt、generation_guidance 里的主体和文字必须使用占位符，不要写具体文案、具体职业、具体穿搭。
24. 所有提示词模板必须用中文展示，尤其是 universal_style_prompt、layout_prompt、color_prompt、lighting_prompt、typography_prompt、decorative_elements_prompt、negative_prompt、editable_template.prompt_template、information_layout_template.copy_ready_json_prompt。
25. negative_prompt 也必须是中文，例如“避免低对比、灰暗配色、细弱字体、杂乱背景、真实阴影过重、小字过多”，不要写成英文 negative prompt。
26. 如果图片包含清晰可读的文字（图表、表格、资料卡、海报、笔记、清单、UI 界面等），extracted_text.applies 必须为 true，并把所有清晰可读的文字按视觉层级逐字转写进 extracted_text.markdown：画面最大标题用 #，分组或区块标题用 ##，列表条目用 -，表格用 Markdown 表格语法，被强调的数据或结论用 **加粗**。保持原文语言和原始用词，不翻译、不改写、不补全、不总结；看不清的部分写 [无法识别]；extraction_notes 用中文说明模糊、截断或被遮挡的部分。图中没有可读文字时 applies=false，markdown 留空。
27. generation_guidance.for_text_to_image 必须输出一段可直接用于纯文生图的完整中文说明，覆盖视觉风格、构图与排版系统、文字层级、配色、光影、字体气质、装饰语言和可替换内容槽位；只能使用 [MAIN_TITLE]、[SUBTITLE]、[SUPPORTING_TEXT]、[SUBJECT_GROUP]、[MAIN_OBJECT]、[DATA_CALLOUT] 等抽象占位符，禁止写入原图具体文案、品牌、Logo、价格、型号、日期和数据。

严格通用化：${strictGeneralization ? "开启。必须弱化所有具体内容，只保留风格、排版、配色、光影和视觉系统。" : "关闭。可以保留更具体的主体摘要，但仍然不要照抄品牌、完整文字、价格、型号和具体数据。"}
`;

export const buildUserPrompt = (): string => `
请分析这张图片，并输出以下完全一致结构的 JSON：

{
  "version": "1.3",
  "analysis_mode": "style_reference_not_exact_replication",
  "source_capture": {
    "source_type": "uploaded_image",
    "source_url": "",
    "page_title": "",
    "domain": "",
    "capture_mode": "",
    "selection_rect": {
      "x": 0,
      "y": 0,
      "width": 0,
      "height": 0,
      "device_pixel_ratio": 1
    },
    "captured_at": ""
  },
  "image_classification": {
    "primary_type": "",
    "secondary_types": [],
    "content_domain": "",
    "visual_purpose": ""
  },
  "content_abstraction": {
    "original_subject_summary": "",
    "reusable_subject_placeholder": "",
    "text_handling_policy": "do_not_copy_exact_text",
    "slot_value_policy": "leave_blank_for_user_input",
    "specific_content_to_ignore": [],
    "generic_content_slots": []
  },
  "editable_template": {
    "template_usage": "",
    "text_slots": [
      {
        "slot": "[MAIN_TITLE]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      },
      {
        "slot": "[SUBTITLE]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      },
      {
        "slot": "[SUPPORTING_TEXT]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      }
    ],
    "subject_slots": [
      {
        "slot": "[SUBJECT_GROUP]",
        "purpose": "",
        "count_policy": "",
        "recommended_position": "",
        "pose_or_expression_placeholder": "[POSE_OR_EXPRESSION]",
        "outfit_placeholder": "[OUTFIT_STYLE]",
        "style_notes": "",
        "fill_value": ""
      }
    ],
    "wardrobe_slots": [
      {
        "slot": "[OUTFIT_STYLE]",
        "applies_to": "[SUBJECT_GROUP]",
        "style_function": "",
        "fill_value": ""
      }
    ],
    "product_or_object_slots": [
      {
        "slot": "[MAIN_OBJECT]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      }
    ],
    "layout_keep_rules": [],
    "prompt_template": ""
  },
  "information_layout_template": {
    "applies": false,
    "layout_family": "",
    "recommended_aspect_ratio": "",
    "structure_prompt": "",
    "table_or_card_layout_prompt": "",
    "text_hierarchy_prompt": "",
    "content_slots": [
      {
        "slot": "[PRODUCT_NAME]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      },
      {
        "slot": "[PRODUCT_FEATURES]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      },
      {
        "slot": "[DATA_CALLOUT]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      }
    ],
    "comparison_slots": [
      {
        "slot": "[COMPARISON_ITEM_A]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      },
      {
        "slot": "[COMPARISON_ITEM_B]",
        "purpose": "",
        "recommended_position": "",
        "style_notes": "",
        "fill_value": ""
      }
    ],
    "copy_ready_json_prompt": ""
  },
  "extracted_text": {
    "applies": false,
    "markdown": "",
    "extraction_notes": ""
  },
  "style_reference": {
    "universal_style_prompt": "",
    "layout_prompt": "",
    "color_prompt": "",
    "lighting_prompt": "",
    "typography_prompt": "",
    "decorative_elements_prompt": "",
    "negative_prompt": ""
  },
  "visual_system": {
    "composition": {
      "layout_type": "",
      "grid_or_alignment": "",
      "visual_hierarchy": "",
      "information_density": "",
      "spacing_style": "",
      "focal_area": ""
    },
    "color": {
      "palette": [],
      "dominant_colors": [],
      "accent_colors": [],
      "background_color_strategy": "",
      "contrast_level": "",
      "saturation_level": "",
      "temperature": ""
    },
    "typography": {
      "has_text": false,
      "font_mood": "",
      "font_weight_strategy": "",
      "title_body_relationship": "",
      "text_block_layout": "",
      "copy_exact_text": false
    },
    "product_or_object_presentation": {
      "applies": false,
      "object_positioning": "",
      "background_treatment": "",
      "shadow_reflection_style": "",
      "material_emphasis": "",
      "commercial_visual_style": ""
    },
    "chart_or_infographic": {
      "applies": false,
      "chart_types": [],
      "data_visual_style": "",
      "axis_grid_style": "",
      "label_style": "",
      "highlight_strategy": "",
      "data_exactness_policy": "do_not_copy_values"
    },
    "poster_or_banner": {
      "applies": false,
      "headline_position": "",
      "subtext_position": "",
      "callout_style": "",
      "decorative_layout": "",
      "campaign_mood": ""
    },
    "lighting_and_depth": {
      "light_type": "",
      "shadow_style": "",
      "depth_style": "",
      "camera_angle_or_perspective": "",
      "lens_feel": ""
    },
    "subject_appearance": {
      "applies": false,
      "subject_role_style": "",
      "wardrobe_style": "",
      "outfit_color_materials": "",
      "hair_makeup_accessory_style": "",
      "pose_expression_style": "",
      "scene_fit_notes": "",
      "transfer_limit": ""
    }
  },
  "web_design_context": {
    "applies": false,
    "page_style_summary": "",
    "layout_system": "",
    "ui_component_style": "",
    "interaction_surface_style": "",
    "css_token_hints": {
      "colors": [],
      "font_mood": "",
      "radius_style": "",
      "shadow_style": "",
      "spacing_density": ""
    }
  },
  "style_terms": [
    {
      "name": "",
      "category": "layout",
      "confidence": 0.8,
      "copyable": true
    }
  ],
  "generation_guidance": {
    "for_image_to_image": "",
    "for_text_to_image": "",
    "for_style_transfer": "",
    "replaceable_content_slots": [],
    "recommended_aspect_ratio": "",
    "recommended_style_strength": ""
  },
  "quality_control": {
    "must_preserve": [],
    "must_not_copy": [],
    "risk_notes": [],
    "confidence": 0
  }
}

primary_type 必须从以下值选择：
product_image, poster, infographic, chart_or_dashboard, social_media_banner, photography, illustration, ui_screenshot, mixed_layout

source_capture 由本地采集链路补全；如果你无法从图片判断来源，保持默认空值，不要编造 URL、标题或域名。
style_terms.category 必须从以下值选择：
layout, color, typography, material, lighting, ui, mood, rendering

请特别注意：
- universal_style_prompt 要写成中文，可直接复用的一段通用生图风格提示词，必须使用 [MAIN_TITLE]、[SUBTITLE]、[SUBJECT_GROUP]、[POSE_OR_EXPRESSION]、[OUTFIT_STYLE] 等占位符，不要固定原图人物和衣服。
- layout_prompt、color_prompt、negative_prompt 要用中文输出并可单独复制使用，其中 layout_prompt 只能描述占位符的位置和层级，不要复述原图文字。
- editable_template 是给用户改封面用的模板区；所有 fill_value 必须留空字符串 ""。
- text_slots 描述每个文字占位符应该填写什么、放在哪里、继承什么字体/描边/颜色风格。
- subject_slots 描述主体人物/产品占位符，可以支持不同人数、不同穿搭、不同姿势，不要写死原图人数和穿搭。
- wardrobe_slots 只说明服装造型槽位怎么填写，不要填入原图服装。
- 如果图片是资料卡、图表、表格、对比卡片、产品说明页或小红书笔记型信息页，information_layout_template.applies 必须为 true；layout_family 写具体类型，例如“多卡片参数页”“左右对比表格”“瀑布式笔记卡片”“顶部标题 + 中部产品卡 + 底部清单”。
- information_layout_template.structure_prompt 要描述整体结构；table_or_card_layout_prompt 要描述表格/卡片数量、分栏、圆角、阴影、分隔线、标签和图标点缀；text_hierarchy_prompt 要描述主标题、分组标题、正文、数据高亮和注释的字号、字重、颜色、对齐、行距关系。
- information_layout_template.content_slots 和 comparison_slots 只保留新产品内容占位符，所有 fill_value 必须是空字符串；copy_ready_json_prompt 必须是一段中文 JSON 提示词说明，可以直接让生图模型生成同款风格产品介绍图，但不能复制原图文字、品牌、价格、型号或具体数据。
- extracted_text 用于把图中可读文字按层级逐字转写为 Markdown，方便用户后续编辑；applies 只在图中确实有可读文字时为 true。markdown 保持原文语言，逐字转写，不翻译、不改写、不补全；最大标题用 #，分组标题用 ##，列表用 -，表格用 Markdown 表格语法，强调数据用 **加粗**，看不清的写 [无法识别]。这是唯一允许照抄原文的字段。
- visual_system.subject_appearance 只在图中存在清晰主体人物时 applies=true；它用于后续主体融合时迁移目标图的服装造型气质和姿态语言，必须提取非品牌化、非身份化的可迁移服装参考，例如“利落商务套装廓形、低饱和深色面料、简洁配饰、与冷调办公室光影匹配”，不能照抄 logo、文字、具体身份或不可泛化的个人特征。
- subject_appearance.wardrobe_style 要描述目标图主体人物的服装廓形、层次、版型和风格功能；outfit_color_materials 要描述服装颜色、材质、纹理和反光关系；hair_makeup_accessory_style 只描述整体气质，不要固定个人身份；pose_expression_style 要具体写出人物姿态、动作幅度、身体朝向、手部位置、视线方向、表情气质和画面重心，避免只写“自然姿态”“参考原图姿态”。
- prompt_template 是一段中文的、带占位符的封面生成模板，不要包含原图具体文案、人物身份、穿搭、品牌、价格、型号、数据。
- 如果图片明显是网页或应用界面，web_design_context.applies 必须为 true，primary_type 优先使用 ui_screenshot 或 mixed_layout，并输出网页/应用 UI 的布局、组件、字体、留白、阴影、圆角、色彩 token 和交互表面风格。
- 如果图片不是网页或应用界面，web_design_context.applies 必须为 false，style_terms 可以为空数组或只保留通用视觉风格词。
- 所有面向用户复制使用的提示词模板都必须是中文，不能输出英文句子。
- must_preserve 写应该保留的风格规律。
- must_not_copy 写不应该复制的具体内容类型。
- confidence 是 0 到 1 的数字。
`;

export const buildFuseSystemPrompt = (): string => `
你是“视觉风格融合与产品信息布局提示词生成器”。你的任务是把已解析出的视觉风格 JSON，融合到当前一同输入的主体图片或新产品信息上，生成可直接复制给其他生图模型使用的中文提示词和结构化融合 JSON。

最终使用场景（必须时刻牢记）：
用户会把 fused_prompt 复制给外部生图模型，并且只上传当前这一张主体图片（就是你现在一同收到的这张）。外部生图模型看不到视觉风格 JSON 的来源图，也不理解“参考图”“主体图”这类概念；它只能看到一张图和一段文字。所以 fused_prompt 必须写成“对这张图片进行改造”的单图编辑指令。

核心原则：
1. 只输出严格 JSON，不要输出 Markdown、解释文字或代码块。
2. 字段名必须完全遵循用户给定 schema，不能新增顶层字段。
3. fused_prompt 必须是一段完整中文自然语言；fused_prompt_json.generation_guidance.copy_ready_prompt 必须与 fused_prompt 表达同一个最终提示词。
4. 在 subject_reference 模式中，当前一同输入的图片只保留主体。主体通常是画面占比最大、清晰度最高、视觉焦点最强的前景人物或物体。
5. 如果图中有多个并列主主体，保留这个主体组合的数量、相对站位、外貌或形态特征。
6. 不要把图片背景、边缘杂物、随机小道具、无关环境装饰写成必须保留项。
7. 视觉风格 JSON 只提供视觉风格、排版结构、色彩系统、字体气质、光影层级、材质和装饰语言。
8. 不要迁移视觉风格 JSON 来源中的具体主体身份、人物、产品、品牌、logo、价格、日期、型号、数据数值或原文案。
9. fused_prompt 必须按“保持段 → 改造段 → 负面段”组织：保持段以“保持图中……不变”开头，写清主体的脸部、体态比例、数量等身份特征；改造段用“将画面/将人物的……改为……”句式，把解析出的风格、构图、配色、光影、字体装饰、服装、发型、姿态逐项展开成具体描述；负面段集中所有“不要出现……”约束。
10. 融合提示词不能假装做像素级分割；只能用清晰文字约束主体保留和风格迁移范围。
11. fused_prompt、copy_ready_prompt、wardrobe_transfer 以及 fused_prompt_json.style_reference 内所有提示词都不能留下 [MAIN_TITLE]、[SUBJECT_GROUP]、[MAIN_OBJECT] 等任何待填占位符；只有 fused_prompt_json.social_cover_text_layout 在常规模式下可以使用 [SOCIAL_ASPECT_RATIO]、[TOP_SUPER_TITLE]、[BOTTOM_SUPER_TITLE]。
12. fused_prompt_json 要尽量承接视觉风格 JSON 中 style_reference 的字段结构，分别输出融合后的通用风格、布局、配色、光影、字体、装饰和负面约束。
13. 指代禁令：面向最终复制的所有字段都禁止出现“第一张图”“第二张图”“第1张”“第2张”这类图片顺序描述，也禁止出现“参考图”“主体参考图”“样式参考图”“风格参考图”“目标图”“目标视觉风格图”“目标视觉参考图”“当前解析图”“随附”“主体照片”这类双图视角表述，更不能要求“请同时提供一张照片/图片”。指代图片只能用“这张图片”“图中”“画面中”；视觉风格来源必须改写成具体画面描述，例如“冷调商务海报式构图”“低饱和蓝灰配色”“中心人物半侧身站姿”。
14. 默认必须以图中人物自己的身体姿态和动作造型为准，只让解析出的视觉风格负责构图、光影、场景和排版适配；如果用户融合控制明确要求代入解析出的身体姿态和动作造型，则改为参考解析 JSON 中 visual_system.subject_appearance.pose_expression_style、editable_template.subject_slots、editable_template.product_or_object_slots、style_reference.layout_prompt 和构图焦点来重塑姿态，并把姿态写成具体动作描述。
15. 必须把解析 JSON 中 visual_system.subject_appearance、editable_template.wardrobe_slots 和其他场景线索作为服装造型迁移依据；如果 subject_appearance.applies=true，融合提示词要明确写出服装廓形、材质、颜色关系、配饰气质和场景适配感，再迁移到图中主要人物身上。
16. 主体身份保留优先级高于姿态和服装迁移：图中主体的脸部、体态比例、数量、关键识别特征和主要形态必须保持不变；发型头发质感以及身体姿态动作是否迁移解析 JSON 中的造型线索，由用户融合控制决定。未开启对应控制时，必须写成“保持图中人物原有发型/姿态不变”；开启对应控制时，必须从解析 JSON 提取对应的发型质感或姿态动作，改写成具体描述后写进 fused_prompt 和 fused_prompt_json。
17. 如果解析 JSON 没有清晰人物服装线索，也要根据已解析出的场景、光影、色彩、材质和画面用途，为图中主要人物生成与环境匹配的服装造型方向，避免保留明显不合场景的原始穿搭。
18. 在 information_layout 模式中，不生成主体身份保留要求；必须承接 information_layout_template、chart_or_infographic、web_design_context、style_reference 和 visual_system.composition，把新产品文字或当前一同提供的产品信息图片中的新事实适配为同款表格/卡片/资料页 JSON 提示词。
19. information_layout 模式绝对不能复制样式来源中的原文案、品牌、价格、型号、日期或数据；用户输入的新产品文字是新内容，可以写入最终 JSON；如果同时提供产品信息图片和文字，以文字为准，图片只补充可识别事实。
20. social_cover_text_layout 在常规模式下必须说明社交媒体封面比例占位符、上方超大标题占位符、下方超大标题占位符、对齐方式、安全边距和匹配当前视觉风格的字体描述，并明确不照抄这张图片或样式来源中的任何原有文字；在用户提供了编辑后图中文字的模式下，改为描述这些真实文字的排布，不使用占位符。
`;

const defaultFusePromptControls: FusePromptControls = {
  useTargetHair: false,
  useTargetPose: false,
  useExtractedText: false
};

const normalizeFusePromptControls = (controls?: Partial<FusePromptControls>): FusePromptControls => ({
  useTargetHair: Boolean(controls?.useTargetHair),
  useTargetPose: Boolean(controls?.useTargetPose),
  useExtractedText: Boolean(controls?.useExtractedText)
});

const buildFuseControlPolicy = (controls?: Partial<FusePromptControls>): string => {
  const normalized = normalizeFusePromptControls(controls);
  const hairPolicy = normalized.useTargetHair
    ? "开启。必须从解析 JSON 的 visual_system.subject_appearance.hair_makeup_accessory_style 和相关场景线索中提取人物发型、发量轮廓、刘海/分缝/卷直/扎发结构、头发质感或妆发气质，改写成具体造型描述后应用到图中主要人物身上；图中人物只保留脸部身份、五官识别度和体态比例，不要求保留原有发型。"
    : "关闭。必须以图中主要人物自己的发型、发量轮廓、刘海/分缝/卷直/扎发结构和头发质感为准，并在提示词中写成“保持图中人物原有发型和头发质感不变”；解析出的风格信息只能调整光影、色彩和整体场景氛围，不要迁移其他来源的发型结构或头发质感。";
  const posePolicy = normalized.useTargetPose
    ? "开启。必须从解析 JSON 的 visual_system.subject_appearance.pose_expression_style、主体槽位、布局提示词和构图焦点中提取人物身体姿态、动作造型、身体朝向、手部位置、视线表情气质和动态重心，改写成具体动作描述后应用到图中主要人物身上；图中人物只保留脸部身份、体态比例、数量和关键识别特征，不要求保留原有姿态。"
    : "关闭。必须以图中主要人物自己的身体姿态、动作造型、身体朝向、手部位置、躯干与腿部姿势和动态重心为准，并在提示词中写成“保持图中人物原有姿态和动作不变”；解析出的风格信息只做构图、光影、透视、场景和排版适配，不要迁移其他来源的姿态动作。";

  return `
用户融合控制：
- 代入解析出的发型和头发质感：${hairPolicy}
- 代入解析出的身体姿态和动作造型：${posePolicy}

融合控制写入要求：
- 如果某个控制开启，fused_prompt、fused_prompt_json.subject_reference_policy、fused_prompt_json.generation_guidance.image_reference_instruction 和对应的 pose_transfer 或 style_reference/quality_control 字段都要明确写出该项来自解析 JSON 的具体画面特征，不能只写“来自某某图”。
- 如果某个控制关闭，fused_prompt 和 fused_prompt_json 必须明确该项以图中人物原样为准，不要写成来自其他图片。
- 如果解析 JSON 没有清晰人物发型、头发质感、身体姿态或动作造型线索，对应开启项要基于解析出的造型氛围和构图语言做概括迁移，不要编造过细个人特征；如果图中主体不是人物，则对应字段降级为主体形态保护。
`;
};

const normalizeFusePromptMode = (mode?: FusePromptMode): FusePromptMode =>
  mode === "information_layout" ? "information_layout" : "subject_reference";

const buildProductInfoBlock = (productInfoText = ""): string => {
  const trimmed = productInfoText.trim();
  return trimmed
    ? `用户输入的新产品信息（唯一可见文字来源，必须逐条按原意使用，不得新增任何未输入文字信息）：\n${trimmed}`
    : "用户没有输入新产品文字；如果当前一同提供了产品信息图片，只抽取其中明确可识别的新产品事实，不迁移它的版式风格，也不要补写图片中没有出现的卖点、参数或结论。";
};

const buildTextInjectionPolicy = (editedTextMarkdown = ""): string => {
  const trimmed = editedTextMarkdown.trim();
  if (!trimmed) return "";

  return `
用户编辑后的图中文字（唯一可见文字来源）：
${trimmed}

图中文字代入要求：
- 上面这段 Markdown 是最终画面中允许出现的唯一可读文字，必须按原文使用，不得增删、改写、翻译、补全或总结。
- 层级映射：# 一级标题对应画面最大标题区，## 二级标题对应分组标题，列表条目对应条目区，Markdown 表格对应表格区，**加粗**内容对应高亮数据或结论区；具体位置、字号层级和字体风格按解析出的版式分配。
- fused_prompt 的改造段必须写明这些文字内容和它们的排布要求，让外部生图模型直接把这些文字渲染进画面。
- social_cover_text_layout 本次不使用 [SOCIAL_ASPECT_RATIO]、[TOP_SUPER_TITLE]、[BOTTOM_SUPER_TITLE] 占位符，各字段改为描述这些真实文字的排布、字号层级、对齐和安全边距；text_replacement_policy 写明画面可见文字只来自用户编辑后的图中文字。
- 用户文字中没有对应内容的文字区必须留白或省略，不得为填满版面编造文字。
`;
};

const buildFuseModePolicy = (
  mode: FusePromptMode,
  productInfoText = "",
  textInjectionActive = false
): string => {
  if (mode === "information_layout") {
    return `
当前任务模式：information_layout（产品信息布局模式）。
${buildProductInfoBlock(productInfoText)}

模式写入要求：
- 样式来源只来自已解析视觉风格 JSON 中的信息布局、卡片/表格结构、配色、字体气质、装饰和留白节奏。
- 样式来源中的原文案、品牌、价格、型号、日期、数据和具体产品名都不能写入最终结果。
- 如果用户输入了新产品文字，这段文字就是最终画面中允许出现的唯一产品文字信息；只能重排、分组、压缩或按原意转写用户输入内容，不能新增任何用户没有输入的标题、卖点、参数、功效、结论、价格、型号、适用场景、评价词、营销词或对比项。
- 用户输入新产品文字时，即使同时有产品信息图片，也不得从图片中补充额外事实；图片只可作为产品外观或内容理解的弱参考，不能增加新的可见文字信息。
- 只有在用户完全没有输入新产品文字时，才允许从产品信息图片中抽取明确可见事实；仍不得脑补图片中没有出现的信息。
- fused_prompt 不要写任何“请提供照片”类要求，而是要求“根据以下新产品信息生成同款社交媒体产品介绍图”。
- information_layout_adaptation.applies 必须为 true，并输出能直接复制到生图平台的中文 JSON 提示词。
- 对空缺字段的处理：如果用户输入中没有提供某个卡片、表格行或标签所需内容，必须删除该信息块、保持留白装饰或写成“该位置留空”，不能为了填满版面自行编造文字。
`;
  }

  return `
当前任务模式：subject_reference（主体封面融合模式）。

模式写入要求：
- 当前一同输入的这张图片，就是用户之后会上传给外部生图模型的唯一图片；fused_prompt 必须围绕“对这张图片进行改造”来写，不要出现“请同时提供一张照片”这类要求。
- 只保留图中占比最大、最清晰、视觉焦点最明确的前景人物或物体。
${textInjectionActive
    ? "- 画面可见文字只能来自用户编辑后的图中文字（见下方“图中文字代入要求”），这张图片和样式来源里的其他原有文字都不能照抄。\n- social_cover_text_layout 本次不使用任何占位符，改为描述用户编辑后真实文字的排布；其他融合字段同样不能出现任何占位符。"
    : "- 这张图片和样式来源里的任何可读文字都不能照抄到最终提示词或融合 JSON。\n- 文字只保留社交媒体封面排版功能：比例、上方超大标题区、下方超大标题区、对齐方式、安全边距、字体风格和视觉层级。\n- social_cover_text_layout 必须使用 [SOCIAL_ASPECT_RATIO]、[TOP_SUPER_TITLE]、[BOTTOM_SUPER_TITLE] 这三个占位符；其他融合字段不能出现任何占位符。"}
- information_layout_adaptation.applies 默认为 false，除非解析 JSON 明确是产品资料卡、表格或卡片信息布局。
`;
};

export const buildFuseUserPrompt = (
  styleAnalysisJson: string,
  controls = defaultFusePromptControls,
  mode: FusePromptMode = "subject_reference",
  productInfoText = "",
  editedTextMarkdown = ""
): string => {
  const normalizedMode = normalizeFusePromptMode(mode);
  const normalizedControls = normalizeFusePromptControls(controls);
  const textInjectionActive =
    normalizedMode === "subject_reference" &&
    normalizedControls.useExtractedText &&
    Boolean(editedTextMarkdown.trim());

  return `
请根据下面的视觉风格 JSON、当前任务模式，以及当前一同输入的主体图片或产品信息图片，输出以下完全一致结构的 JSON：

{
  "fused_prompt": "",
  "fused_prompt_json": {
    "subject_reference_policy": "",
    "style_transfer_scope": "",
    "pose_transfer": {
      "target_pose_reference": "",
      "transfer_instruction": "",
      "subject_identity_boundary": "",
      "scene_fit_instruction": "",
      "negative_prompt": ""
    },
    "wardrobe_transfer": {
      "target_wardrobe_style": "",
      "transfer_instruction": "",
      "subject_identity_boundary": "",
      "scene_fit_instruction": "",
      "negative_prompt": ""
    },
    "style_reference": {
      "universal_style_prompt": "",
      "layout_prompt": "",
      "color_prompt": "",
      "lighting_prompt": "",
      "typography_prompt": "",
      "decorative_elements_prompt": "",
      "negative_prompt": ""
    },
    "social_cover_text_layout": {
      "aspect_ratio_placeholder": "",
      "top_text_placeholder": "",
      "bottom_text_placeholder": "",
      "typography_style": "",
      "alignment_and_safe_area": "",
      "text_replacement_policy": ""
    },
    "information_layout_adaptation": {
      "applies": false,
      "source_layout_reference": "",
      "product_information_source": "",
      "content_mapping_instruction": "",
      "table_or_card_structure": "",
      "copy_ready_json_prompt": "",
      "negative_prompt": ""
    },
    "generation_guidance": {
      "image_reference_instruction": "",
      "style_strength": "",
      "copy_ready_prompt": ""
    },
    "quality_control": {
      "must_preserve": [],
      "must_not_copy": [],
      "risk_notes": []
    }
  },
  "subject_policy": "",
  "style_transfer_scope": "",
  "risk_notes": [],
  "confidence": 0.8
}

视觉风格 JSON：
${styleAnalysisJson}

${buildFuseModePolicy(normalizedMode, productInfoText, textInjectionActive)}

${normalizedMode === "subject_reference" ? buildFuseControlPolicy(normalizedControls) : ""}

${textInjectionActive ? buildTextInjectionPolicy(editedTextMarkdown) : ""}

写作要求：
- fused_prompt 必须可以直接复制给其他生图模型使用，不需要用户再修改。它是写给一个只能看到这一张图片的模型的单图编辑指令。
- subject_reference 模式下，fused_prompt 按“保持段 → 改造段 → 负面段”组织：开头写“保持图中（占比最大、最清晰的前景人物或物体）的脸部、体态比例、数量等关键识别特征不变”；中段用“将画面/将人物的……改为……”句式逐项展开解析出的构图、配色、光影、字体装饰、服装、发型、姿态；结尾集中负面约束。
- fused_prompt_json 必须是 fused_prompt 的结构化拆解版本，按原始 style_reference 的字段承接解析出的视觉风格。
- fused_prompt_json.pose_transfer 必须单独拆解姿态迁移策略：姿态控制关闭时，target_pose_reference 写“图中主要人物原有的身体姿态和动作造型”，transfer_instruction 写如何在解析出的构图中保留该姿态；姿态控制开启时，target_pose_reference 写解析 JSON 中可迁移的具体姿态、动作、身体朝向、手势、视线表情气质、摆放角度、朝向、层叠关系或动态重心，并说明如何应用到图中主要主体上；subject_identity_boundary 写图中哪些主体身份、体态比例、数量、材质结构和关键识别特征必须保持原样；scene_fit_instruction 写姿态如何服务解析出的构图、留白、文字层级、光影方向和透视；negative_prompt 写不要引入其他来源的具体人物身份或破坏图中主体的识别度。
- fused_prompt_json.wardrobe_transfer 必须单独拆解服装造型迁移策略：target_wardrobe_style 写解析 JSON 中可迁移的具体服装造型，例如廓形、层次、版型、材质、颜色关系、配饰气质和场景功能；transfer_instruction 写如何把这套服装造型套到图中主要人物身上；subject_identity_boundary 写图中哪些主体特征必须保持原样；scene_fit_instruction 写服装如何与解析出的场景、光影、色彩和材质自然融合；negative_prompt 写不要保留不合场景的原始穿搭且不要引入品牌、logo、文字或具体身份。
- fused_prompt_json.style_reference.layout_prompt 要精确描述主体与文字块、主视觉、留白、装饰元素之间的相对位置和层级。
- fused_prompt_json.style_reference.color_prompt、lighting_prompt、typography_prompt、decorative_elements_prompt 要分别保留解析出的配色、光影、字体气质和装饰语言，不要压缩成一句泛泛描述。
- fused_prompt_json.style_reference.negative_prompt 要合并主体保护和原图去具体化约束。
- ${textInjectionActive
    ? "fused_prompt_json.social_cover_text_layout 本次必须描述用户编辑后真实文字的排布：aspect_ratio_placeholder 写适合的画面比例和用途；top_text_placeholder 和 bottom_text_placeholder 写哪些真实文字放在上方或下方安全区、字号、字重、对齐和视觉重量；typography_style 根据解析出的视觉风格生成匹配字体描述；alignment_and_safe_area 写清网格对齐、边距、行距和避让主体焦点；text_replacement_policy 写明画面可见文字只来自用户编辑后的图中文字，不照抄图片原有文字。所有字段都不能出现任何 [XXX] 形式占位符。"
    : "fused_prompt_json.social_cover_text_layout 必须拆分社交媒体封面文字占位：aspect_ratio_placeholder 写 [SOCIAL_ASPECT_RATIO] 适合的画面比例和用途；top_text_placeholder 写 [TOP_SUPER_TITLE] 位于上方安全区的超大标题、字号、字重、描边/阴影/颜色和对齐；bottom_text_placeholder 写 [BOTTOM_SUPER_TITLE] 位于下方安全区的超大标题、对齐和视觉重量；typography_style 必须根据解析出的视觉风格生成匹配字体描述；alignment_and_safe_area 必须写清网格对齐、边距、行距和避让主体/产品焦点；text_replacement_policy 必须说明不照抄这张图片或样式来源中的任何原有文字。"}
- fused_prompt_json.information_layout_adaptation 在 information_layout 模式下必须 applies=true，按新产品信息输出同款资料卡、表格或卡片页 JSON 提示词；如果用户输入了新产品文字，所有可见文字只能来自用户输入，不得新增任何未输入的补充文字、卖点、参数、结论或营销表达；在 subject_reference 模式下通常 applies=false，只保留必要的降级说明。
- fused_prompt_json.generation_guidance.copy_ready_prompt 必须是一段可直接复制的完整提示词，语义上等同 fused_prompt。
- fused_prompt_json.generation_guidance.image_reference_instruction 是写给用户看的使用说明：说明把这张需要改造的图片和本提示词一起提交给生图模型即可，无需再提交其他图片；不要写成提示词内容。
- subject_reference 模式下，fused_prompt 中必须明确描绘姿态要求：姿态控制关闭时，要写出保持图中主要人物的原身体姿态和动作造型不变，并让解析出的风格只适配构图、光影和场景；姿态控制开启时，如果解析 JSON 有清晰人物姿态，要写出人物应呈现的站姿/坐姿/动作幅度、身体朝向、手部位置、视线方向、表情气质和画面重心；如果主要是产品或物体，要写出物体的摆放角度、朝向、层叠关系、悬浮/倚靠/平放等状态和动态重心。不要只写“参考原图姿态”这类笼统句。
- subject_reference 模式下，fused_prompt 中必须包含服装造型迁移要求：保持图中主要人物的脸部、体态和关键识别特征不变，同时将解析出的服装廓形、层次、材质、颜色关系、配饰气质和场景适配感迁移到该人物身上；如果解析 JSON 没有清晰人物服装线索，则根据解析出的场景、光影、色彩、材质和画面用途自动生成匹配服装，避免原始穿搭与环境割裂。
- subject_reference 模式下，主要主体只指图中占比最大、最清晰、视觉焦点最明确的前景人物或物体。
- subject_reference 模式下，如果图中存在多个并列主主体，保留它们的数量、相对站位、外貌或形态特征，不要要求保留图片背景、边缘杂物、小道具或无关环境。
- 迁移解析出的构图比例、主视觉位置、文字块层级、色彩、光影、字体气质、材质、装饰元素和画面节奏。
- 文字只保留版式功能，不复刻具体品牌、价格、型号、日期、具体数据或原文案${textInjectionActive ? "；用户编辑后的图中文字是唯一例外，必须按原文写入" : ""}。
- information_layout 模式下，样式来源的原文案不能复制。用户输入新产品文字时，只能使用用户输入的新产品文字，不得再从产品信息图片或模型常识中增加内容；只有用户未输入文字时，才可使用当前产品信息图片中明确识别出的新产品事实。
- ${textInjectionActive
    ? "本次所有融合字段（包括 social_cover_text_layout）都不能出现任何 [MAIN_TITLE]、[SUBTITLE]、[SUBJECT_GROUP]、[SOCIAL_ASPECT_RATIO] 这类占位符。"
    : "fused_prompt、copy_ready_prompt 和 style_reference 内所有提示词里都不要出现任何 [MAIN_TITLE]、[SUBTITLE]、[SUBJECT_GROUP]、[MAIN_OBJECT] 这类占位符；只有 social_cover_text_layout 可以出现 [SOCIAL_ASPECT_RATIO]、[TOP_SUPER_TITLE]、[BOTTOM_SUPER_TITLE]。"}
- fused_prompt、copy_ready_prompt、subject_reference_policy、style_transfer_scope、pose_transfer、wardrobe_transfer、style_reference、social_cover_text_layout、information_layout_adaptation、quality_control 中都不要出现“第一张图”“第二张图”“第1张”“第2张”这类图片顺序描述，也不要出现“参考图”“主体参考图”“样式参考图”“风格参考图”“目标图”“目标视觉风格图”“目标视觉参考图”“当前解析图”“随附”“主体照片”这类双图视角标签，不要写“请同时提供一张照片/图片”；subject_reference 模式用具体画面内容、风格特征和“这张图片”“图中”来表达，information_layout 模式用“已解析出的资料卡布局风格”和“用户提供的新产品信息”来表达。
- 所有字段内容都必须是中文${textInjectionActive ? "（用户编辑后的图中文字保持原文语言）" : ""}；confidence 是 0 到 1 的数字。
`;
};
