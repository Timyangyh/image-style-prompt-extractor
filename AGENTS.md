# AGENTS.md

## 项目概览

图片复刻大师是一个 Electron + React + TypeScript 本地桌面应用。它把用户上传、拖拽或粘贴的图片解析为可迁移的视觉风格 JSON 和中文提示词模板，并提供独立的生图工作台和改图工作台。

## 操作原则

- 先读 `README.md`、`package.json`、`SECURITY.md` 和本文件，再修改代码。
- 优先做最小、直接、可验证的改动。
- 不要把本机运行数据、历史任务、生成图片、API Key、OAuth token 或缓存目录写入仓库。
- 不要重新引入 Chrome 扩展、自动网页采集服务或后台浏览器采集链路。
- 面向用户的提示词和主要界面文案应保持中文。

## 主要目录

- `electron/`：Electron 主进程、preload、模型调用、生图/改图任务和测试。
- `src/`：React 渲染层、共享类型、schema、样式和测试。
- `scripts/`：macOS 启动和打包前置检查脚本。
- `assets/`：公开图标资源。

## 常用命令

```bash
npm install
npm run dev
npm run test:unit
npm run build
npm run pack
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
