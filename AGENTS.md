# AGENTS.md — 项目约定（AI 协作守则）

## 项目背景

AI Browser Game Jam 4 参赛练习项目（2026-08-01 ~ 08-15），赛后演进为「动物咖啡厅」放置类多人游戏。
开发者是职业程序员、游戏开发新手，使用 AI 辅助编码（vibe coding）。

## 技术栈

- Vite + TypeScript + Three.js（无框架，纯代码驱动，无编辑器）
- AI 3D 物料：Meshy 生成的 GLB（放 `assets/`，经 GLTFLoader 加载）
- 音乐/音效：Suno 生成（放 `assets/audio/`）
- 部署：itch.io 网页手动上传（`npm run pack` 产出 zip）

## 架构纪律（为日后微信小游戏移植而设，必须遵守）

```
src/
  game/      纯 TS 游戏逻辑：顾客、经济、计时器。零 DOM、零 Three.js 依赖，可单测
  scene/     Three.js 场景：只用 GLTFLoader / TextureLoader（微信适配层已验证的 loader）
  ui/        DOM 界面层：只读游戏状态、只发用户意图。薄，可整体替换
  platform/  平台适配层：存储/音频/网络各一个接口，游戏代码只依赖接口
  main.ts    入口：渲染器、相机、主循环
snippets/    可复用代码片段（loadGlb、sceneSwitcher、tween 等）
assets/      模型/贴图/音频（GLB 走 CDN 友好路径，纹理 ≤2048px）
```

## 硬性规则

1. **`game/` 里禁止 import three 或访问 DOM/window**——保证逻辑可移植、可测试
2. 微信禁忌：纹理不得超过 2048px；模型统一 GLB 内嵌纹理；不用 ImageBitmapLoader
3. 所有动画优先代码驱动（snippets/tween.ts），不依赖骨骼动画
4. 场景默认无灯光——新场景必须显式加 AmbientLight + DirectionalLight
5. dt 一律 clamp（主循环已做 0.1s 上限），防止切后台后跳变
6. 提交信息用英文，格式：`type: summary`（如 `feat: add customer spawner`）

## AI 协作偏好（重要）

- **核心 gameplay 代码（game/ 目录）：先解释思路，给骨架，留关键逻辑让人类手写**——这是学习目标区
- boilerplate / UI / 加载器 / 构建脚本：可以直接完整生成
- 遇到 bug：先分析根因再改，不要无上下文地重写
- 生成新文件前先检查 snippets/ 是否已有可复用实现
