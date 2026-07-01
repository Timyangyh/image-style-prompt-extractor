# 图片复刻大师

图片复刻大师是一个本地 Electron 桌面应用，用于把上传、拖拽或粘贴的图片解析为可迁移的视觉风格 JSON 和中文提示词模板。它关注配色、排版、视觉层级、光影、材质、字体气质、信息布局和可编辑占位符，不用于 1:1 复制原图文字、品牌、价格、型号或数据。

项目适合这些场景：

- 从海报、产品图、图表、资料卡、网页截图或 UI 截图中提取可复用的视觉风格。
- 生成中文提示词模板，用于后续在外部图像模型中复用布局、光影、配色和视觉层级。
- 把主体图、产品信息或编辑要求代入已解析出的风格结构。
- 在本地完成提示词提取、生图、改图和结果对比，不把本机历史或密钥写进仓库。

如果需要分析网页或应用界面，可以先截图，然后直接粘贴或上传到应用中分析。项目不包含 Chrome 浏览器插件或自动网页采集服务。

## 功能

- 本地图片上传、拖拽上传和剪贴板截图粘贴。
- 视觉风格 JSON 提取和中文提示词模板生成。
- 可读文字提取面板，用于单独转写图片中的文字。
- 主体参考图融合，支持按需代入发型、头发质感、姿态和动作造型。
- 产品信息布局融合，适配资料卡、表格、图表、产品参数页和小红书笔记型信息页。
- 独立生图工作台，支持提示词导入、参考图、任务队列、历史任务、全屏预览、下载和原图/生成图左右对比。
- 独立改图工作台，支持单源图标注、多编号修改要求、参考生成模式、兼容后端的严格 mask 模式和本地保护版。
- 本机历史、JSON 导出和本机数据清理。

## 系统要求

- M 系列 Mac。
- Node.js 和 npm。
- 可用的 OpenAI-compatible 视觉模型 API，用于图片分析。

内置脚本只面向 Apple Silicon Mac。Intel Mac 或其他系统需要自行调整 Electron 打包流程。

## 安装

```bash
npm install
```

## 一键启动

在 M 系列 Mac 上，可以直接双击：

```text
start.command
```

它会检查本机环境，准备项目依赖，然后启动开发版应用。

也可以在终端运行：

```bash
npm run dev
```

## 模型配置

打开应用后，在“模型配置”里填写：

- API Base URL，例如 `https://api.openai.com/v1`
- Model Name，例如 `gpt-4o-mini`
- API Key

图片分析流程使用 OpenAI-compatible Chat Completions Vision 接口。API Key 只保存在本机运行环境中，不包含在仓库里。

## 生图和改图配置

生图工作台和改图工作台可以使用：

- Codex OAuth 本机登录：主进程读取本机 `~/.codex/auth.json`，渲染层只显示登录状态。
- OpenAI-compatible Images API 或 Responses 图像工具。
- OpenRouter Images API 供应商。

API Key 和 OAuth token 属于本机运行密钥，不应提交到 Git 仓库。

## 常用命令

```bash
npm run dev       # 启动开发版应用
npm run test:unit # 运行单元测试
npm run build     # TypeScript 与 Electron Vite 构建检查
npm run pack      # 生成未压缩 macOS app
npm run dist:mac  # 生成 macOS dmg / zip
```

## 生成便携包

在 M 系列 Mac 上，可以双击或运行：

```bash
./make-portable.command
```

脚本会生成：

```text
portable/图片复刻大师-便携包
portable/图片复刻大师-便携包.zip
```

这些都是本地构建产物，已被 `.gitignore` 排除，不应提交到 GitHub。

只发布源码到 GitHub 时，不需要 Apple Developer ID 签名。只有把 `.app`、`.dmg` 或可直接运行的 zip 作为下载包分发时，才需要考虑 Developer ID 签名和 Apple notarization。

## Agent 操作建议

如果让 AI Agent 接手这个项目，建议给它以下步骤：

```text
请先阅读 README.md、AGENTS.md、package.json 和 SECURITY.md。
这是一个 Electron + React + TypeScript 项目。
不要提交 node_modules、out、release、portable、dist、build、.env、本机历史、API Key、OAuth token 或生成任务数据。
修改后至少运行：
npm run test:unit
npm run build
需要本机启动时运行：
npm run dev
或在 M 系列 Mac 上双击 start.command。
```

更多 Agent 约束见 `AGENTS.md`。

## 仓库卫生

不要提交：

- `node_modules/`
- `out/`、`release/`、`portable/`、`dist/`、`build/`
- `.env*`
- API Key、OAuth token、cookie、credential 文件或本机应用数据
- 私人图片、生成历史、任务文件或本机日志

## 安全

请通过 GitHub Security Advisories 报告安全问题。不要在公开 issue 中粘贴 API Key、OAuth token、cookie、私人截图、生成图片或本机运行数据。

详见 `SECURITY.md`。

## License

MIT License. See `LICENSE`.
