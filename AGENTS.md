# AGENTS.md

## 项目概览

图片复刻大师是一个 Electron + React + TypeScript 本地桌面应用。它把用户上传、拖拽或粘贴的图片解析为可迁移的视觉风格 JSON 和中文提示词模板，并提供独立的生图工作台和改图工作台。

改图工作台只保留“原始素材重生成修订版”：当前生成图和编号定位图用于解析修改意图，最终图像请求只使用第一次生图提示词、已确认清单和原始参考图。不要重新引入旁路参考、严格 mask 或本地像素保护合成器。

## 操作原则

- 先读 `README.md`、`package.json`、`SECURITY.md` 和本文件，再修改代码。
- 优先做最小、直接、可验证的改动。
- 不要把本机运行数据、历史任务、生成图片、API Key、OAuth token 或缓存目录写入仓库。
- 不要重新引入 Chrome 扩展、自动网页采集服务或后台浏览器采集链路。
- 面向用户的提示词和主要界面文案应保持中文。

## 主要目录

- `electron/`：Electron 主进程、preload、模型调用、生图/改图任务和测试。
- `src/`：React 渲染层、共享类型、schema、样式和测试。
- `src/shared/image-edit-regeneration.ts`：改图结构化标注、确认门禁和确定性重生成提示词。
- `scripts/`：macOS 启动和打包前置检查脚本。
- `assets/`：公开图标资源。

## 常用命令

```bash
npm install
npm run dev
npm run test:unit
npm run build
npm run pack
npm run verify:release
```

M 系列 Mac 上可以双击 `start.command` 启动开发版应用。

## 提交前检查

至少运行：

```bash
npm run test:unit
npm run build
```

如果改动了打包配置、图标、Electron 主进程或 preload，再运行：

```bash
npm run pack
```

准备公开提交时运行 `npm run verify:release`。它会检查禁止跟踪的目录、10MB 以上 Git 文件、常见密钥/本机路径，并执行单元测试和生产构建。

## 发布原则

- `main` 是公开仓库唯一发布基线，本机 `main` 应跟踪 `origin/main`。
- 不使用 `git push --force`；公开 `main` 只保留发布所需的源码、测试和文档。
- 每次只暂存本轮必要源码、测试、锁文件和公开文档；提交前查看 `git status --short --ignored` 和 staged diff。
- 安装包只作为 GitHub Release 资产上传，不提交到 Git 树。
- 发布新安装包时使用递增版本和新 tag，不覆盖已经发布的历史版本。

## 禁止提交

- `node_modules/`
- `out/`
- `release/`
- `portable/`
- `dist/`
- `build/`
- `.env`、`.env.*`
- `.DS_Store`
- `.claude/`
- `.omx/`
- `*.log`
- API Key、OAuth token、cookie、credential 文件
- 本机图片历史、生图任务、改图任务、私人截图或生成图片

## 密钥边界

API Key 和 Codex OAuth token 只能作为本机运行时密钥使用。渲染层只能接收是否已配置、是否已登录这类状态，不应接收明文密钥。
