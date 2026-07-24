import {
  AlertCircle,
  CheckCircle2,
  FileJson,
  Moon,
  PenLine,
  Settings,
  Sparkles,
  Sun
} from "lucide-react";
import appIconUrl from "../../assets/app-icon.png";
import type { AppTheme } from "./theme";

export type AppWorkspace = "extract" | "generate" | "edit";

const workspaceMeta: Record<
  AppWorkspace,
  { description: string; label: string }
> = {
  extract: {
    label: "提示词提取",
    description: "提取可迁移的风格、配色、排版与视觉系统，不做原图 1:1 复刻。"
  },
  generate: {
    label: "生图工作台",
    description: "组合提示词、参考图与生成参数，并持续跟踪任务结果。"
  },
  edit: {
    label: "改图工作台",
    description: "标注修改意图，确认清单后从原始素材重新生成修订版。"
  }
};

export function AppSidebarHeader({
  activeView,
  onOpenEdit,
  onOpenExtract,
  onOpenGenerate
}: {
  activeView: AppWorkspace;
  onOpenEdit: () => void;
  onOpenExtract: () => void;
  onOpenGenerate: () => void;
}): JSX.Element {
  return (
    <div className="app-sidebar-header">
      <div className="app-brand">
        <img alt="" src={appIconUrl} />
        <div>
          <strong>图片复刻大师</strong>
          <span>Liquid Pro</span>
        </div>
      </div>

      <nav className="page-tabs" aria-label="工作区切换">
        <button
          aria-current={activeView === "extract" ? "page" : undefined}
          className={activeView === "extract" ? "active" : ""}
          onClick={onOpenExtract}
          type="button"
        >
          <FileJson size={19} />
          <span>提示词提取</span>
        </button>
        <button
          aria-current={activeView === "generate" ? "page" : undefined}
          className={activeView === "generate" ? "active" : ""}
          onClick={onOpenGenerate}
          type="button"
        >
          <Sparkles size={19} />
          <span>生图工作台</span>
        </button>
        <button
          aria-current={activeView === "edit" ? "page" : undefined}
          className={activeView === "edit" ? "active" : ""}
          onClick={onOpenEdit}
          type="button"
        >
          <PenLine size={19} />
          <span>改图工作台</span>
        </button>
      </nav>
    </div>
  );
}

export function ContextToolbar({
  activeCount,
  activeView,
  hasError,
  onOpenGenerationConfig,
  onOpenModelConfig,
  onStrictGeneralizationChange,
  onToggleTheme,
  strictGeneralization,
  theme
}: {
  activeCount: number;
  activeView: AppWorkspace;
  hasError: boolean;
  onOpenGenerationConfig: () => void;
  onOpenModelConfig: () => void;
  onStrictGeneralizationChange: (checked: boolean) => void;
  onToggleTheme: () => void;
  strictGeneralization: boolean;
  theme: AppTheme;
}): JSX.Element {
  const meta = workspaceMeta[activeView];
  const statusLabel = hasError
    ? "需要处理"
    : activeCount > 0
      ? `进行中 ${activeCount}`
      : "就绪";
  const themeActionLabel = theme === "dark" ? "切换为浅色模式" : "切换为深色模式";

  return (
    <header className="topbar">
      <div className="topbar-context">
        <div className={hasError ? "topbar-status error" : "topbar-status"}>
          {hasError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <span>{statusLabel}</span>
        </div>
        <h1>{meta.label}</h1>
        <p>{meta.description}</p>
      </div>

      <div className="topbar-actions">
        {activeView === "extract" && (
          <label className="switch">
            <input
              checked={strictGeneralization}
              onChange={(event) => onStrictGeneralizationChange(event.target.checked)}
              type="checkbox"
            />
            <span aria-hidden="true" />
            <b>严格通用化</b>
          </label>
        )}
        <button
          aria-label={themeActionLabel}
          className="ghost-button toolbar-button theme-toggle-button"
          onClick={onToggleTheme}
          title={themeActionLabel}
          type="button"
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button
          aria-label="生图配置"
          className="ghost-button toolbar-button"
          onClick={onOpenGenerationConfig}
          title="生图配置"
          type="button"
        >
          <Sparkles size={18} />
          <span className="toolbar-button-label">生图配置</span>
        </button>
        <button
          aria-label="模型配置"
          className="ghost-button toolbar-button"
          onClick={onOpenModelConfig}
          title="模型配置"
          type="button"
        >
          <Settings size={18} />
          <span className="toolbar-button-label">模型配置</span>
        </button>
      </div>
    </header>
  );
}
