# Non-Urgent Backlog — 用户体感与质量改进

**维护者**:John(技术总程序员,review only)
**用途**:记录 review 过程或用户反馈中发现的问题,**非紧急、不影响 merge**、留待后续 PR 顺手处理。每个条目含现象、根因、建议改法选项、时机建议。从 jam 期到赛后演进分级。

---

## 待修条目

### #001 相机贴墙仍感拉近(damp 之后第二档改进)

**发现时间**:2026-08-04,PR #8 review 迭代 2(用户实测 damp 生效后)
**优先级**:中(jam 期能做就做,不做不影响 playtest)
**严重度**:用户体验,无功能 bug
**PR 出处**:相机 spring-damp 已在 `ff49df6` 落地(档位 1)+ 本条记第二档
**归 PR**:PR #10(game agent,改 `thirdPersonController.ts` + `config.ts`)

**现象**:
PR #8 `ff49df6` commit 加了相机位置 spring-damp(选项 A),用户体感"靠墙镜头明显舒服很多",但贴墙时角色仍被拉近,FOV 70° 下角色视觉膨胀。

**根因**:
`thirdPersonController.ts:144` `t = Math.max(0.1, ...)` 的下限 0.1 意味着相机距 head 最近 `2.7m × 0.1 = 0.27m` —— 贴脸颈部。damp 平滑了瞬变但没消除近距本身。

**选项**(三档,逐档加 ROI):

| 档 | 做法 | 成本 | 业界定位 |
|---|---|---|---|
| 1 | 现状(spring-damp + t 下限 0.1) | 已做 | jam 轻量基准 |
| 2 | **加 `CONFIG.camera.minDist = 1.4` 距离下限 clamp** | 5 行 | 业界 90% 第三人称游戏标准 |
| 3 | Raycast 角色半透明(material.opacity 降到 0.3) | ~40 行 + 材质打标 | AAA 标(GTA5/RDR2/原神) |
| 4 | FOV 动态调整或相机沿墙外切线滑动 | 商业引擎级 | 不推荐 jam 做 |

**推荐:档 2**

**实施草案**(供 game agent 参考,不用现在写):
```ts
// src/game/config.ts camera 段加:
minDist: 1.4,  // 相机离 head 最近距离,撞墙宁可侧滑不贴脸

// src/player/thirdPersonController.ts 在算完 camera.position 后:
const dir = tmp.subVectors(camera.position, headPos);
const dist = dir.length();
if (dist < CONFIG.camera.minDist) {
  dir.multiplyScalar(CONFIG.camera.minDist / dist);
  camera.position.copy(headPos).add(dir);
}
```

副作用:墙角特紧时可能看见墙内(目前没墙 mesh,无影响)。角色半截可能短暂出现,可接受。

**何时做**:PR #10 spec §5 加 5.5 条(`minCamDist clamp`)即可,与 5.1 damp 同文件改 5 行。1 个 commit 增量,不另开 PR。

**何时不做**:如果 PR #10 的 game agent 时间紧,5.1 damp 已生效,5.5 可推到赛后第一迭代,不阻塞 jam 完赛。

---

### #002 `THREE.Clock` deprecated 换 `THREE.Timer`

**发现时间**:PR #4 期就存在,PR #8 review 确认未在新代码里顺手清
**优先级**:低(warning 无功能影响)
**严重度**:零(纯控制台噪音)
**归 PR**:PR #10 或任何顺手 agent

**现象**:`src/main.ts:95` 控制台报 `THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.`

**改法**:
```ts
// src/main.ts:95
- const clock = new THREE.Clock();
+ const timer = new THREE.Timer();
// src/main.ts:98 animate 内
- const dt = Math.min(clock.getDelta(), 0.1);
+ timer.update();
+ const dt = Math.min(timer.getDelta(), 0.1);
```

**注意**:Three.js v0.185 的 `Timer` API 与 `Clock` 略有不同(需调 `update()` 再 `getDelta()`),实施 agent 必须查官方文档确认用法,不要想当然。

**何时做**:PR #10 顺手改 1 个 commit,或 docs-only 风格 dev 小 PR 直接 main。

---

## 归档规则

- 每条条目编号 #001, #002 ... 递增
- 含字段:发现时间、优先级、严重度、归 PR、现象、根因、选项 + 推荐、实施草案(可选)、何时做、何时不做
- 条目实施完成后**不删**——加 `**状态**:已实施(commit XXXXX, PR #N)` 链接,转为历史记录
- 每 2 周 review 时扫一次,看优先级要不要升

## 例外:不进本 backlog 的事项
- 紧急 bug → 直接开 fix PR,不走本记录
- Feature 请求 → 进 spec,不进 backlog
- 架构级演进(如场景 10x 扩张)→ 进 AGENTS.md rule 10 那种顶层 backlog,不进此文件