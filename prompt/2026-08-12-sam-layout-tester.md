# Sam — 布局测试员:有解验证 + 风格探索

**Dispatched**: 2026-08-12
**Agent**: Sam
**Branch**: `feat/layout-experiments`
**Estimated**: 60-90 min(hard stop 120 min)

## 背景

游戏布局现在是 `src/scene/layout.json` 数据驱动(编辑器保存 → Vite HMR → 游戏秒级生效)。下一步要**随机化布局**(每局 procedural 生成),但首先要搞清楚:**什么样的布局"有解"?什么样的布局好玩?**

你(Sam)的任务:**用布局编辑器画 3-5 个不同风格的布局,每个都试玩验证有解,记录感受**。为将来的随机化积累"有解约束"的经验。

## 前置

用户帮你建好 worktree,你等通知后在里面工作。

- 游戏 dev server 与 save-server 已在主工作区运行(5173 / 8899),你画布局 → 保存 → HMR 生效。
- 编辑器用 MCP chrome-devtools 打开:`navigate_page` → `file://<你的 worktree 绝对路径>/tools/layout-editor.html`

## 关键:用 `window.layout.*` API 操作(禁合成 Pointer 事件)

编辑器暴露了 JS API,**直接用这些,不要用合成 PointerEvent**(上次 David 的教训:合成事件被 MCP 真实事件污染,debug 半小时):

```js
// 在编辑器页面的 console 或 evaluate_script 里:
window.layout.clear();                          // 清空
window.layout.place('T', 12, -3);               // 放桌(col=12, z=-3)
window.layout.place('★', 8, 0);                 // 放摸奖桌
window.layout.place('C', 5, 5);                  // 放柱
window.layout.place('B', 3, -8);                 // 放书架(默认横)
window.layout.place('#', 0, -11);                // 放墙
window.layout.resize(40, 32);                    // 改房间大小
window.layout.save();                           // 保存到游戏(触发 HMR)
window.layout.json();                           // 导出当前 JSON
window.layout.ascii();                          // ASCII 预览
window.layout.size;                             // 当前房间 {w, h}
```

**kind 参数对照**:`'T'`(自习桌)/`'★'`(摸奖桌)/`'C'`(柱)/`'B'`(书架)/`'#'`(墙)/`'R'`(readingTable)/`'S'`(wallSocket)/`'E'`(端板盒)

**col/z 坐标**:col = x 轴(0~W,左→右),z = z 轴(上→下,中心=0)。`place('T', 12, -3)` = 放在 x=12, z=-3。

## "有解"判定标准(每个布局必须满足)

| 条件 | 为什么 |
|---|---|
| **电位桌 ≥ 5 张**(studyTable + studyTable-charge)| 180s 内玩家至少要充 1 次,5 桩保证找到 |
| **玩家出生点 (0, 8.5) 周围 3m 内无遮挡** | 出生不被墙/书架围死 |
| **出生点→最近桌桩有无障碍路径** | 玩家起步能走到至少一个桩 |
| **桌之间有过道 ≥ 1m**(玩家直径 0.64m + dash)| 玩家能在桌区穿行,不会卡死 |
| **柱电位柱 ≥ 2 根**(layout.json 的 column 数)| 随机柱电位从 column 里选,columnCount [4,6] 需要 ≥ 6 柱 |

**验证方法**:`window.layout.save()` 保存 → save-server 写主工作区 layout.json → Vite HMR 自动 reload → `navigate_page` 到 `http://localhost:5173` → `evaluate_script` 确认游戏加载成功(看 console 的 `[Layout] outlets seed=...` 日志)→ **通知用户试玩**(不用自己跑游戏走 180s)。

## 要画的 3-5 个布局(不同风格)

### 布局 1:稀疏大堂(当前风格延伸)
- 5-8 张桌散布,大量空地
- 验证:基础有解,玩家走动顺畅
- 目的:baseline,确认工具链通

### 布局 2:紧凑自习室(密排)
- 15-20 张桌密排(像图书馆自习区)
- 过道窄(≥1m 即可)
- 验证:桌密度高时玩家能否穿行 + 桩够不够
- 目的:测容量上限

### 布局 3:迷宫式(书架造走廊)
- 用书架 + 墙(# wallBlock)造 S 形走廊
- 桌放在走廊尽头的"房间"里
- 验证:玩家能否找到路 + 电位不被书架挡视线(los.ts 过滤矮家具 but 书架 2.4m 高会挡)
- 目的:测导航难度 + 视线规则

### 布局 4:岛屿群(4 个独立区域)
- 房间分 4 个区域,每区 3-5 张桌
- 区间用书架/墙隔开,留过道连接
- 验证:玩家能否在区间穿梭 + 每区都有桩
- 目的:测区域分布 + 探索感

### 布局 5:你自创
- 画一个你觉得"好玩"的布局
- 自由发挥(对称?不对称?中央竞技场?环形?)
- 验证:有解 + 你觉得有意思
- 目的:收集"fun"的主观数据

## 每个布局的工作流

1. `window.layout.clear()` 清空
2. 用 `window.layout.place(...)` 画布局(循环批量放桌最快)
3. `window.layout.save()` 保存 → 触发游戏 HMR
4. `navigate_page` 到 `http://localhost:5173` → `evaluate_script` 读 console:
   - 期望:`[Layout] outlets seed=... 柱 X/Y 墙 Z 总桩 N`
   - 期望:`[debug] rebuild table zone: tables=N, outlets=M`
   - 如有 error → 记录 bug
5. `take_screenshot` 一张游戏画面
6. `take_screenshot` 一张编辑器画面(含 ASCII 预览)
7. 记录:`布局名 / 桌数 / 柱数 / 总桩 / console 输出 / 截图路径 / 你的 1 句话感受`

## 交付物

### 最终 commit
- **只改 `src/scene/layout.json`**(你选的"最好玩 + 有解"的布局作为默认)
- 不要改游戏代码(loadLibraryScene/config/etc)

### PR body 必含
```markdown
## 5 个布局试玩记录

| 布局 | 桌数 | 柱数 | 总桩 | 有解? | 截图 | 感受 |
|---|---|---|---|---|---|---|
| 稀疏大堂 | ... | ... | ... | ✓/✗ | path | 一句话 |
| 紧凑自习室 | ... | ... | ... | ✓/✗ | path | 一句话 |
| 迷宫式 | ... | ... | ... | ✓/✗ | path | 一句话 |
| 岛屿群 | ... | ... | ... | ✓/✗ | path | 一句话 |
| 自创 | ... | ... | ... | ✓/✗ | path | 一句话 |

## "有解"约束总结(给将来随机化用)
- 电位桌 ≥ N 张
- 出生点周围 X m 无遮挡
- 过道 ≥ Y m
- ...(你试出来的实际数字)

## 最终默认布局:XX 式(桌 N / 桩 M)
选这个因为 ...
```

## 工时上限

60-90 分钟。超 120 分钟停下报告卡哪。

## Git

- 分支 `feat/layout-experiments`
- commit author Sam(`git -c user.name=Sam -c user.email=sam@local`)
- PR 标题:`feat(layout): 5 个布局有解验证 + 默认布局更新`
- commit message:`feat(layout): 5 个布局有解验证 + 选 [布局名] 作默认`

## 边界(不要碰)

- 只改 `src/scene/layout.json`,不改任何游戏代码
- 不要写自动化 CDP 长循环 / 合成 PointerEvent(用 `window.layout.*` API)
- 不要实现"随机化布局"本身(那是后续 PR,你只收集约束)
- 连续 build/test 失败 3 次停下报告
- 每个布局保存后,**通知用户试玩**(不要自己跑 180s 游戏验证;用 console 日志确认加载成功即可)

## 给将来的提示(你做完后这条会进 knowledge/)

你的"有解约束总结"是后续 procedural layout generator 的输入 — 那个 generator 要生成满足这些约束的随机布局。所以你的约束越具体越值钱(比如"出生点 5m 内必有 1 桩"比"桩要够"有用得多)。