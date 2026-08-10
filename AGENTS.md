# AGENTS.md — 项目约定（AI 协作守则）

## 项目背景

AI Browser Game Jam 4 参赛作品（2026-08-01 ~ 08-15）。完整设计见 `spec/2026-08-01-1percent-battery-design.md`。

- **本作(jam)**：《1% 电》(working title, "Low Battery")——第三人称越肩 3D 探索生存小游戏。玩家是一只在图书馆只剩 1% 电的猫，3 分钟内冲到空充电桩保命，其他 NPC 动物也在抢桩；右下角 GTA5 式手机 UI，开地图/占用查询 app 帮你找桩，但 app 耗的就是你要保的电。冲刺抢桩耗能量 pip（局内不补，下局自动满）。
- **赛后**：架构同一套纪律演进为「动物咖啡厅」放置类多人游戏（微信小程序）。本作保留可复用基建（Three.js pipeline、AABB 碰撞、程序动画、saveStore、Phone-UI overlay 技法、NPC 状态机框架→咖啡馆顾客 arrive/wait/leave）。
- **开发者**：31 岁职业程序员、游戏开发新手，AI 辅助编码（vibe coding），全程在图书馆实地开发（见「参考资源」）。

## 技术栈

- Vite + TypeScript + Three.js（无框架，纯代码驱动，无编辑器）
- AI 3D 物料：Meshy 生成的 GLB（放 `public/library/`，Vite 静态目录运行时通过 `library/<name>.glb` URL 加载，`snippets/loadGlb.ts` 内的 `loadGlbNormalized` 归一化尺寸/落地；dev/prod 路径一致）
- 音乐/音效：Suno 生成 + 实地录环境音（放 `assets/audio/`）
- 部署：itch.io 网页手动上传（`npm run pack` 产出 zip）

## 架构纪律（为日后微信小游戏移植而设，必须遵守）

```
src/
  game/      纯 TS 游戏逻辑：run/battery/npc/level/rng/输入抽象。零 DOM、零 Three.js 依赖，可单测
  scene/     Three.js 场景：只用 GLTFLoader / TextureLoader（微信适配层已验证的 loader）
  ui/        DOM 界面层：只读游戏状态、只发用户意图。薄，可整体替换（Phone HUD / Top HUD / End Screens / Onboarding）
  platform/  平台适配层：saveStore / audio / inputProvider / net（stretch 多人）
  main.ts    入口：渲染器、相机、主循环
snippets/    可复用代码片段（loadGlb、sceneSwitcher、tween 等）
public/library/   Meshy 生成的 GLB（Vite 静态目录，运行时 URL `library/<name>.glb`，dev/prod 一致）
assets/      暂未使用（保留为未来贴图/音频沙盒）
```

**核心数据流单向**：`platform/inputProvider` → `game.step(input, dt) → WorldState` → `scene/` 渲染 + `ui/` 渲染。`game/` 层完全不知 Three/DOM 存在。这是可测与可移植的根基。

## OpponentController 抽象（D2 即立，为多人 stretch 预留）

`game/run.ts` 不知道"对手是 NPC 还是远程玩家"。统一抽象为 `OpponentController` 接口：

```ts
interface OpponentController {
  kind: 'npc' | 'remote';
  think(state: WorldState, dt: number): OpponentAction;
}
```

- `NpcController`：D2-D10 实现的状态机（pick-target → move → occupy → leave → repeat）
- `RemotePlayerController`：D11+ stretch 实现，从 `platform/net` 拿远端 action 喂入

`game/` 逻辑零改即可支持真人多人。`main.ts` 装配时选 controller，单机=全 NpcController，online=对应位置换 RemotePlayerController，30 秒无匹配自动 fallback 到 NpcController（防 jam 评审干等）。

## 硬性规则

1. **`game/` 里禁止 import three 或访问 DOM/window**——保证逻辑可移植、可测试
2. 微信禁忌：纹理不得超过 2048px；模型统一 GLB 内嵌纹理；不用 ImageBitmapLoader
3. 所有动画优先代码驱动（`snippets/tween.ts`：ease/bob/sway/pulse/popIn/damp），不依赖骨骼动画
4. 场景默认无灯光——新场景必须显式加 AmbientLight（main.ts 已加）
5. dt 一律 clamp（主循环已做 0.1s 上限），防止切后台后跳变
6. 提交信息用英文，格式：`type: summary`（如 `feat: add dash pip system`）
7. **Git 工作流（PR-based，开发者铁律）**：
   - AI 在 feature branch 上自由 commit，不再每次问用户
   - 所有变更通过 Pull Request 进入 `main`，开发者 review 后 merge
   - branch 命名：`feat/<x>` / `chore/<x>` / `fix/<x>`
   - 完成后 `git push -u origin <branch>` → `gh pr create`
   - 开发者在 GitHub 上 review + merge（推荐 rebase & merge 保留 AI 工作证据链；噪音分支才 squash）
   - merge 后 AI 本地同步：`git switch main && git pull --ff-only`，并删除已 merge 的 feature 分支（本地+远程）
   - 每个 PR 必须自包含：build 通过、`game/` 单测通过（若涉及）、commit 信息清楚
   - **一个功能增量 = 一个 PR**。AI 开完 PR 必须明确说 "READY FOR REVIEW" 并停手，不再往该分支 push（review 迭代的小修复除外，需在 PR 里说明）
   - 任何 push 前先 `gh pr view <n> --json state` 确认 PR 仍 OPEN（防止往已 merge 分支续推的事故）
   - commit 作者身份：仓库本地 `user.name` 设为当前 agent 名（主 agent 现 `Snake`；每个独立 agent 各用自己的命名；只设 repo-local，勿动全局配置）
   - **例外（docs-only 微修订可直接 commit main）**：纯文档措辞修订（`*.md`、≤10 行、无代码、无 build 影响、spec 未被任何实现消费）可直接 `git switch main && git pull --ff-only && git commit && git push`，无需 PR。适用场景：spec 措辞澄清、README 笔误、AGENTS.md 规则微调。一旦 spec 已被某 PR 引用为实现依据，后续修订必须走 PR（避免已审核的实现与静改的 spec 脱节）。
   - **PR / commit 语言约定（2026-08-06 加）**：PR title、PR body、review reply 全用中文；commit message 用中文摘要 + 英文 type 前缀（`feat: 中文摘要` / `fix: 中文摘要` / `docs: 中文摘要` / `refactor: 中文摘要` / `chore: 中文摘要`）。历史英文 commit 不补改。理由:项目主语言中文,John review 也用中文,统一便于检索。
8. 守住 scoped 边界：单场景图书馆、玩家+2~3 NPC、3 app、3 pip。多场景/多 app/升级树/roguelike 树 全部是 stretch，D11+ 时间够才碰。（2026-08-04 解锁：2 app → 3 app，加 RADAR app 补全信息梯度，详见 `spec/MASTER-SPEC.md` §3）
9. **调试资源闭环**：MCP 验证完成后**关闭游戏标签页**（`chrome-devtools_close_page`）即可；不要杀 MCP chrome 进程或 dev server —— 渲染中的标签页才是高能耗（10w→40w），闲置进程/空白页可忽略。开发者可能随时接手试玩，dev server 默认保持运行
10. **场景尺度目标（backlog）**：实地图书馆一层约为当前场景（32×24m）的 10+ 倍面积，目标场景尺度向实地看齐。当前 32×24 为占位阶段尺度，后续统一调整（影响布局密度、NPC 寻路、相机/雾效范围，属大改，单独 PR）
11. **并行独立 agent 工作流（地基后启用）**:
    - 主 agent 完成 Layer 1（config + SharedState interface + mount points）后才可并行
    - 用户在两个独立 opencode 会话里各自开 worktree：`git worktree add ../gamejam-2026-<branch> feat/<x>` 隔离工作目录（两 worktree 共享同一 .git，各自 checkout 各自分支，互不干扰）
    - 文件边界：UI 独立 agent 只改 `src/ui/` + 替换 `src/ui/phoneHud.ts` 的 mountPhoneHud 实现；Game 独立 agent 只改 `src/game/` + `src/player/` + 替换 `src/game/playerStats.ts` 的 mountPlayerStats 实现；两独立 agent 都不改 `src/main.ts` 的调用点（Layer 1 钉死）
    - 共享接口 = Layer 1 钉死的 TS interface，独立 agent 只 implements 不 invent
    - 两 PR 都开 → 主 agent（本会话）review → 用户 merge 先开的 → 后开的 rebase 到新 main
12. **subagent dispatch 策略（主 agent 用 task 工具派子任务时遵守）**:
    - **何时用 subagent**:短任务（≤15 分钟估时）+ 文件边界清晰 + 不需用户监工
    - **何时不用 subagent**:长任务（>20 分钟）→ 改用户新开 opencode session + worktree 模式（用户可实时看 stdout、随时 Ctrl+C、可补充指令）;协调 PR（多文件互相依赖）→ 主 agent 亲自做最快
    - **prompt 内必须含 build 验证策略**:明确写"每 N commit 合跑一次 build，test 只在最后一次完整跑"，避免 subagent 每 commit 各跑一次 build+test 烧 token
    - **prompt 内必须含预算上限**:"如果连续 build 失败 3 次或 test 失败 3 次，立刻停下，返回错误原因给我，不要陷入循环重试"
    - **subagent 是黑盒**:主 agent 看不到中间过程、不能实时停、失败后没 checkpoint 续传;只能等它返回最终消息;高风险任务必须拆小 + 给任务前 dry-run 才用 subagent
    - **并行多 subagent 判据**:任务间文件交集 = 0 才并行;> 0 必须串行(否则 git merge 冲突打架)
    - **多 agent 共改同文件(main.ts 等)的冲突预防(2026-08-10 加,PR #16 教训)**:
      - Snake prep commit 时**明确划分每个 agent 在共享文件里的改动区域**(行号区间/锚点注释),每个 agent 只改自己区域
      - **agent prompt 必须写明"只在你指定的区域改,不要越界到其他 agent 的区域"**
      - **若两 agent 改相邻区域有撞 hunk 风险**:第一个 push 的 PR 先 merge,后续 agent **开工前必须 `git pull origin main` rebase 到最新基线**,不要基于旧 main 开工
      - **不要等 3 个 PR 都开完才发现冲突** — Snake 整合 review 在临时 worktree 模拟 merge 前,先单独 review 每个 PR 改的行号区间是否重叠,重叠就提前预警
      - **如果冲突发生了**:让原 agent 在自己 worktree 里 `git rebase origin/main` 自己 resolve + `git push --force-with-lease`,**不要让 Snake 在临时 worktree 替 agent resolve 再强推**(这会绕过 agent 的 обучения,且 commit author 变成 Snake)
    - **多模态验证**:主 agent 不能读图片时,可 dispatch 多模态 subagent(如 Claude / GPT-4V)做 UI 截图 review。日常 DOM 验证优先用 `chrome-devtools_evaluate_script` 读 class/style/textContent 替代截图,多数 review 不需图片
    - **session 复用优先**:一个功能彻底开发完再删 worktree,避免来回重建 + git config 身份重配;`git worktree remove` 是轻量操作(共享 .git 无需重下载)但 opencode session 会随之失效(上下文丢失)

## AI 协作偏好

- **核心 gameplay 代码（`game/` 目录）：先解释思路，给骨架，留关键逻辑让人类手写**——这是学习目标区
- boilerplate / UI / 加载器 / 构建脚本：可以直接完整生成
- 遇到 bug：先分析根因再改，不要无上下文地重写
- 生成新文件前先检查 `snippets/` 是否已有可复用实现
- 手感相关数值（电池倍率、NPC 性格、移速、pip 数）全部入 `game/config.ts` 单一数据源，调平衡=改数字

## 参考资源（实地优势）

开发全程在图书馆实地进行，可即时观察：

1. **真实插座分布与占用规律** → 桩位生成权重（不要均匀撒点，要像真的）
2. **真人抢桩微行为（东张西望找座、看到别人起身立刻冲过来、占着桩低头玩手机不走、插队失败转身找下一个）** → NPC 状态机分支与延迟参数
3. **暖光/冷光混搭 + 木地板/书架材质** → Three.js 灯光/材质 reference
4. **过道/桌椅尺度** → 碰撞盒与俯视相机角度
5. **实地录闭馆提示音/翻书/脚步/椅子拖动** → 原创音效（jam 评分"原创音频"加分项）