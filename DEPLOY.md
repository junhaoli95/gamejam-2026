# DEPLOY.md — itch.io 手动上传指南

## 首次设置（约10分钟）

1. 注册/登录 itch.io → 右上角头像 → **Upload new project**
2. 填写：
   - **Title**：游戏名（可先占位，随时改）
   - **Project URL**：会成为 `你的名字.itch.io/游戏名`，想好再填
   - **Kind of project**：选 **HTML**（关键！别选错）
   - **Pricing**：$0 or donate（No payments）
3. 先 **Save & view page** 存草稿（Draft 状态，别人看不到）

## 每次上传构建包

1. 项目根目录执行：`npm run pack`
2. 得到 `gamejam-2026-日期-时间.zip`
3. 回到 itch 项目编辑页 → **Upload files** → 上传该 zip
4. 上传后勾选 **This file will be played in the browser**（关键！）
5. **Viewport dimensions**：填 960 × 540 起步（之后按游戏实际调整）
6. 勾选 **Fullscreen button**、**Mobile friendly**（如果适配了触屏）
7. Save → 点页面上的 **Run game** 验证能玩

## 页面物料清单（评分期前必须补齐）

| 物料 | 规格 | 备注 |
|------|------|------|
| Cover 封面图 | 630×500 最小，推荐 1920×1080 裁切 | 决定点开率，D11 前做 |
|  gameplay GIF | ≤3MB，6秒以内 | 比截图转化高得多 |
| 截图 | 3-5 张 | 展示最好看的瞬间 |
| Short description | 一句话钩子 | 列表页显示 |
| Description 正文 | 玩法 + **AI 工作流实录**（AI Usage 是评分项） | 写清楚哪些部分是 AI 生成 |
| devlog | 至少 2 篇 | 开发过程也是内容 |

## 时间节点提醒

- **8/1 开赛当天**：先上传一个空壳占位（证明开发起点，顺便跑通流程）
- **8/14 前**：完成最终上传，别卡截止时刻（itch 服务器会抽风）
- 评分期开始后游戏文件会**锁定**，提前确认最终版没问题
