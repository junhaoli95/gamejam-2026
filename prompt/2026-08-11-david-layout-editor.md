# David — ASCII 布局编辑器

**Dispatched**: 2026-08-11
**Agent**: David
**Branch**: `tools/layout-editor`
**Estimated**: 30-45 min (hard stop 60 min)

## 背景

jam 还剩 4 天(8/15 截止),需要把自习桌阵从 20 张扩到 60+ 张 + 加摸奖桌(★,1-2 个全场,有绿桩)。当前用 ASCII 手画 + 我翻译坐标太低效。

决策:先让 David 做一个 standalone HTML ASCII 布局编辑器,用户在网页上拖动元素 → 一键 Copy ASCII → 把 ASCII 交给 David 翻译成代码。

## 产出

单一文件:`tools/layout-editor.html`。用浏览器打开 `file://` URL 即用,无构建步骤、无依赖、无网络请求。

> David 你是 AI agent,没有桌面环境 —— 验证时用 MCP chrome-devtools 的 `navigate_page` tool 加载 `file://<绝对路径>/tools/layout-editor.html`,再用 `take_snapshot` / `take_screenshot` 验证,不要写自动化 CDP 长循环脚本(参见 AGENTS.md 效率规则)。

## 编辑器规格

### 画布

- 房间 32m(x,水平)× 24m(z,垂直),1m 一格 → 32 列 × 24 行
- 网格线显示 + 每 4 格标一次 x/z 坐标(角落)
- HTML 顶部固定显示尺寸解说:列=x(0~31,左→右),行=z(-12~+11,上→下,中心=0)

### 元素库(左侧栏)

| 字符 | 含义 | 说明 |
|---|---|---|
| `T` | studyTable | 4 人自习桌(桌 1.8×1.2m,椅突出沿 x±0.95) |
| `★` | studyTable-charge | 摸奖桌(全图 1-2 个,有绿桩)— T 的特殊变体 |
| `C` | column | 0.9×0.9 柱 |
| `B` | bookshelf | 3.0×0.6 书架(Shift 切换横/竖 rotY 90°) |
| `#` | wall | 墙体 |
| (空) | 走道 | 不放元素即空地 |

### 交互

- 点击元素库选中当前 brush(高亮)
- 左键单击空 cell → 放置当前 brush
- 拖动已放置元素 → snap 到 0.5m 网格
- 右键已放置元素 → 删除
- Shift + 拖动 B → 在横/竖朝向间切换
- Brush 选 "走道"(空白橡皮)→ 左键清空

### 输出

- 右上角按钮 "Copy ASCII"
- 点击后剪贴板 = 24 行 × 32 列字符
  + 顶部坐标轴标 x 列号一行
  + 左侧每行前缀 z 值
- 格式样例(STATUS bar 显示 "copied 24×32"):

```
       0    4    8    12   16   20   24   28
z=-12 ################################
-11   T       T
-10   T       T
...
```

- 同时在按钮下方 `<pre>` 实时预览 ASCII(每次画完自动刷新)

### 简化原则

- 别做撤销/重做/保存 JSON,够用就行
- 桌/柱/书架直接用 colored div 占位即可,不要画椅子 collider
- 不集成进游戏,纯独立 HTML

## 验收(你自跑,用 MCP chrome-devtools,禁自动化长循环 CDP)

1. 用 `navigate_page` 打开 `file://<你的 worktree 绝对路径>/tools/layout-editor.html`
2. `take_snapshot` 确认画布、左侧元素库、右上 "Copy ASCII" 按钮都渲染出来
3. 用 `click` tool:点 T brush → 点 (12, -3) cell;点 ★ brush → 点 (8, 0) cell
4. `take_screenshot` 截一张当前画面确认 T 和 ★ 已放置
5. 点 "Copy ASCII" → 用 `evaluate_script` 读剪贴板 `await navigator.clipboard.readText()`,断言输出含 `T` 和 `★` 在对应坐标
6. `take_screenshot` 一张含 20 桌 + 1 ★ 的预览,放 PR 说明里

## 工时上限

预计 30-45 分钟。超 60 分钟停下报告卡哪。

## Git

- 分支 `tools/layout-editor`
- commit author 你自己(用 `git -c user.name=David -c user.email=david@local` 不碰主 config)
- PR 标题:`tools: ASCII layout editor for terrain design`
- PR 说明含:screenshot + 用法 README 段落

## 后续流程(完成后)

1. 用户在编辑器里画出 60+ 桌 + 1~2 ★ + 柱阵 + 书架布局
2. 点 Copy ASCII → 贴给 Snake/David
3. David 按图施工:ASCII 坐标映射到 `buildStudyTablePlacements` / `buildStaticPlacements` 实际坐标
4. 同步改 NPC 系统(红/闲逛 + dash 修正桌过道)+ PR #17 terrain 一起跑