import type { FusePromptMode, StyleAnalysis } from "./types";

export const getFuseMode = (analysis: StyleAnalysis | null): FusePromptMode => {
  if (!analysis) return "subject_reference";
  if (analysis.information_layout_template.applies) return "information_layout";
  if (analysis.visual_system.chart_or_infographic.applies) return "information_layout";
  return ["chart_or_dashboard", "infographic", "ui_screenshot", "mixed_layout"].includes(
    analysis.image_classification.primary_type
  )
    ? "information_layout"
    : "subject_reference";
};

export const resolveFuseMode = (
  analysis: StyleAnalysis | null,
  selectedFuseMode: FusePromptMode | null
): FusePromptMode => selectedFuseMode ?? getFuseMode(analysis);

export const hasInformationLayoutMode = (analysis: StyleAnalysis | null): boolean =>
  getFuseMode(analysis) === "information_layout";
