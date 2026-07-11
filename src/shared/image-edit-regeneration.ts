import type {
  ImageEditAnnotationGeometry,
  ImageEditAnnotationItem,
  ImageEditAnnotationResolution,
  ImageEditRequestSettings,
  ImageEditResolvedAnnotation
} from "./types";

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
const round4 = (value: number): number => Math.round(clamp01(value) * 10_000) / 10_000;
const finite = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(number)) throw new Error("标注坐标必须是有限数值。");
  return round4(number);
};
const text = (value: unknown, maxLength = 800): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => text(item, 500)).filter(Boolean).slice(0, 20) : [];

export const normalizeImageEditAnnotationGeometry = (
  geometry: ImageEditAnnotationGeometry
): ImageEditAnnotationGeometry => {
  if (!geometry || typeof geometry !== "object") throw new Error("标注缺少结构化几何。");
  if (geometry.tool === "box") {
    const left = Math.min(finite(geometry.left), finite(geometry.right));
    const right = Math.max(finite(geometry.left), finite(geometry.right));
    const top = Math.min(finite(geometry.top), finite(geometry.bottom));
    const bottom = Math.max(finite(geometry.top), finite(geometry.bottom));
    if (right <= left || bottom <= top) throw new Error("框选标注面积不能为零。");
    return {
      tool: "box",
      left,
      top,
      right,
      bottom,
      centerX: round4((left + right) / 2),
      centerY: round4((top + bottom) / 2),
      width: round4(right - left),
      height: round4(bottom - top)
    };
  }
  if (geometry.tool === "arrow") {
    const startX = finite(geometry.startX);
    const startY = finite(geometry.startY);
    const endX = finite(geometry.endX);
    const endY = finite(geometry.endY);
    if (startX === endX && startY === endY) throw new Error("箭头标注长度不能为零。");
    return { tool: "arrow", startX, startY, endX, endY };
  }
  if (geometry.tool === "brush") {
    const left = Math.min(finite(geometry.left), finite(geometry.right));
    const right = Math.max(finite(geometry.left), finite(geometry.right));
    const top = Math.min(finite(geometry.top), finite(geometry.bottom));
    const bottom = Math.max(finite(geometry.top), finite(geometry.bottom));
    const effectiveLineWidth = finite(geometry.effectiveLineWidth);
    const coverageRatio = finite(geometry.coverageRatio);
    if ((right <= left && effectiveLineWidth <= 0) || (bottom <= top && effectiveLineWidth <= 0)) {
      throw new Error("画笔标注缺少有效覆盖范围。");
    }
    return {
      tool: "brush",
      left,
      top,
      right,
      bottom,
      centerX: finite(geometry.centerX),
      centerY: finite(geometry.centerY),
      coverageRatio,
      effectiveLineWidth
    };
  }
  if (geometry.tool === "text") {
    const value = text(geometry.text, 600);
    if (!value) throw new Error("文字批注内容不能为空。");
    return { tool: "text", anchorX: finite(geometry.anchorX), anchorY: finite(geometry.anchorY), text: value };
  }
  throw new Error("标注工具类型无效。");
};

export const normalizeOriginAnnotationItems = (items: ImageEditAnnotationItem[]): ImageEditAnnotationItem[] => {
  if (!Array.isArray(items) || !items.length) throw new Error("重新生成修订版至少需要 1 个编号标注。");
  const indexes = new Set<number>();
  return items.map((item, offset) => {
    const index = Number(item.index);
    if (!Number.isInteger(index) || index < 1 || index !== offset + 1 || indexes.has(index)) {
      throw new Error("标注编号必须从 1 开始连续且不能重复。");
    }
    indexes.add(index);
    if (!item.geometry || item.geometry.tool !== item.tool) throw new Error(`标注 ${index} 缺少匹配的结构化几何。`);
    const note = text(item.note, 600);
    if (!note || note === "按总体改图说明处理此处。" || note === "修改这里") {
      throw new Error(`标注 ${index} 必须填写明确的局部修改要求。`);
    }
    return {
      index,
      label: `标注 ${index}`,
      tool: item.tool,
      note,
      positionHint: text(item.positionHint, 160) || undefined,
      geometry: normalizeImageEditAnnotationGeometry(item.geometry)
    };
  });
};

export const parseImageEditAnnotationResolution = (
  value: unknown,
  annotationItems: ImageEditAnnotationItem[],
  metadata: Pick<ImageEditAnnotationResolution, "contentHash" | "source" | "modelName" | "createdAt">
): ImageEditAnnotationResolution => {
  const payload = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const expected = normalizeOriginAnnotationItems(annotationItems);
  if (rawItems.length !== expected.length) throw new Error("标注解析返回数量与请求编号数量不一致。");
  const seen = new Set<number>();
  const items = rawItems.map((raw): ImageEditResolvedAnnotation => {
    const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const index = Number(item.index);
    if (!Number.isInteger(index) || !expected.some((expectedItem) => expectedItem.index === index) || seen.has(index)) {
      throw new Error("标注解析存在缺号、重号或额外编号。");
    }
    seen.add(index);
    const targetObject = text(item.target_object ?? item.targetObject, 500);
    const requestedChange = text(item.requested_change ?? item.requestedChange, 800);
    if (!targetObject || !requestedChange) throw new Error(`标注 ${index} 缺少修改对象或目标修改。`);
    const confidenceValue = Number(item.confidence);
    const confidence = Number.isFinite(confidenceValue) ? Math.min(Math.max(confidenceValue, 0), 1) : 0;
    return {
      index,
      targetObject,
      currentState: text(item.current_state ?? item.currentState, 800),
      requestedChange,
      preserve: textList(item.preserve),
      spatialAnchors: textList(item.spatial_anchors ?? item.spatialAnchors),
      originalText: text(item.original_text ?? item.originalText, 500) || undefined,
      replacementText: text(item.replacement_text ?? item.replacementText ?? item.exact_text, 500) || undefined,
      confidence,
      ambiguity: text(item.ambiguity, 500),
      userConfirmed: false
    };
  });
  items.sort((left, right) => left.index - right.index);
  if (items.some((item, offset) => item.index !== offset + 1)) throw new Error("标注解析编号不连续。");
  return { ...metadata, status: "needs_review", items };
};

export const manualImageEditAnnotationResolution = (
  annotationItems: ImageEditAnnotationItem[],
  metadata: Pick<ImageEditAnnotationResolution, "contentHash" | "createdAt">,
  reason: string
): ImageEditAnnotationResolution => ({
  ...metadata,
  source: "manual_fallback",
  status: "needs_review",
  items: normalizeOriginAnnotationItems(annotationItems).map((item) => ({
    index: item.index,
    targetObject: "",
    currentState: "",
    requestedChange: item.note,
    preserve: [],
    spatialAnchors: [],
    originalText: undefined,
    replacementText: undefined,
    confidence: 0,
    ambiguity: reason,
    userConfirmed: false
  }))
});

const percent = (value: number): string => `${(round4(value) * 100).toFixed(1)}%`;

export const describeImageEditGeometry = (geometry: ImageEditAnnotationGeometry): string => {
  const normalized = normalizeImageEditAnnotationGeometry(geometry);
  if (normalized.tool === "box" || normalized.tool === "brush") {
    return `画布横向 ${percent(normalized.left)}-${percent(normalized.right)}、纵向 ${percent(normalized.top)}-${percent(normalized.bottom)}`;
  }
  if (normalized.tool === "arrow") {
    return `箭头目标点位于画布横向 ${percent(normalized.endX)}、纵向 ${percent(normalized.endY)}`;
  }
  return `文字锚点位于画布横向 ${percent(normalized.anchorX)}、纵向 ${percent(normalized.anchorY)}`;
};

export const assertConfirmedAnnotationResolution = (
  resolution: ImageEditAnnotationResolution | undefined,
  annotationItems: ImageEditAnnotationItem[],
  expectedHash?: string
): ImageEditAnnotationResolution => {
  if (!resolution) throw new Error("请先解析并确认修改清单。");
  const expected = normalizeOriginAnnotationItems(annotationItems);
  if (expectedHash && resolution.contentHash !== expectedHash) throw new Error("源图、标注、说明或基础提示词已变化，请重新解析修改清单。");
  if (resolution.status !== "confirmed" || !resolution.confirmedAt) throw new Error("修改清单尚未完成确认。");
  if (resolution.items.length !== expected.length) throw new Error("确认清单与当前标注数量不一致。");
  resolution.items.forEach((item, offset) => {
    if (item.index !== offset + 1 || !item.userConfirmed || !text(item.targetObject) || !text(item.requestedChange)) {
      throw new Error(`局部修订 ${offset + 1} 尚未完整确认。`);
    }
    if ((item.confidence < 0.8 || item.ambiguity) && !item.userConfirmed) {
      throw new Error(`局部修订 ${item.index} 仍需人工确认。`);
    }
    if (Boolean(item.originalText?.trim()) !== Boolean(item.replacementText?.trim())) {
      throw new Error(`局部修订 ${item.index} 的文字修改必须同时填写原文字和新文字。`);
    }
  });
  return resolution;
};

export const buildOriginRegenerationPrompt = (
  basePrompt: string,
  instruction: string,
  annotationItems: ImageEditAnnotationItem[],
  resolution: ImageEditAnnotationResolution,
  settings: ImageEditRequestSettings
): string => {
  const prompt = text(basePrompt, 80_000);
  if (!prompt) throw new Error("重新生成修订版缺少原始生图基础提示词。");
  const items = normalizeOriginAnnotationItems(annotationItems);
  assertConfirmedAnnotationResolution(resolution, items);
  const resolvedByIndex = new Map(resolution.items.map((item) => [item.index, item]));
  const sections = items.map((annotation) => {
    const item = resolvedByIndex.get(annotation.index);
    if (!item) throw new Error(`确认清单缺少局部修订 ${annotation.index}。`);
    const lines = [
      `局部修订 ${annotation.index}：`,
      `目标区域为${describeImageEditGeometry(annotation.geometry as ImageEditAnnotationGeometry)}。`,
      `对象是${item.targetObject}。`,
      item.spatialAnchors.length ? `空间锚点：${item.spatialAnchors.join("；")}。` : "",
      item.currentState ? `当前状态为${item.currentState}。` : "",
      `${item.requestedChange}。`,
      item.originalText ? `原文字必须识别为“${item.originalText}”。` : "",
      item.replacementText ? `新文字必须逐字使用“${item.replacementText}”。` : "",
      item.preserve.length ? `必须保留：${item.preserve.join("；")}。` : ""
    ].filter(Boolean);
    return lines.join("\n");
  });
  const compiled = [
    prompt,
    "本轮是在原始生成意图基础上重新生成一张修订版，不是对上一张结果做像素级编辑。",
    instruction.trim() ? `本轮总体修订目标：${instruction.trim()}` : "本轮总体修订目标：只执行下列已确认的局部修订。",
    ...sections,
    "冲突优先级：已确认的局部修订高于本轮总体说明，本轮总体说明高于原始生成提示词。每处局部修订只执行一次，不得串用到其他对象。",
    "除已确认修改外，保持原始提示词中的主体身份、人物数量、宏观构图、视角、风格、光影、色彩和文字层级。不要新增未要求的人物、品牌、文字、道具或事实。",
    "负面约束：禁止斑驳暗纹、网格纹、水印感纹理、脏污颗粒、异常局部阴影、塑料皮肤、蜡像质感、过度磨皮和锐化噪点。最终画面不得出现编号圆点、箭头、框线、批注、选择边框、光标或工具界面痕迹。",
    `输出规格：${settings.size} 像素，比例 ${settings.aspectRatio}，格式 ${settings.outputFormat.toUpperCase()}。`
  ]
    .filter(Boolean)
    .join("\n\n");
  if (/(看标注图|按红框|修改这里)/.test(compiled)) throw new Error("最终提示词仍包含依赖未提交标注图的模糊指令。");
  return compiled;
};
