# Sam — 第三人称相机调优

**Dispatched**: 2026-08-11
**Agent**: Sam
**Branch**: `fix/camera-tune`
**Estimated**: 30-45 min/轮 (hard stop 90 min)

## 背景

玩家反馈两个相机晕眩问题:
1. 相机时快时慢(转向停瞬间"啪"地停,感觉冲一下)
2. 靠近墙角色变大、远离墙缩小 → 晕(距离抖动)

## 文件

唯一改动范围:`src/player/thirdPersonController.ts` + `src/game/config.ts` 的 `CONFIG.camera` 块。
不要动 player 控制、碰撞、NPC、UI、main.ts 的其他部分。

## 现状参考(别再读一遍,直接用)

`config.ts` CONFIG.camera 当前值:
```
fov: 70, near: 0.05, far: 80,
dist: 2.7, side: 0.35, up: 1.35,
collidePad: 0.25, collideSteps: 8,
dampLambda: 12, minDist: 1.4
```

player 当前值:`walkSpeed 3.0, turnRate 3.0 rad/s` (~172°/s A/D 全速转向)

`thirdPersonController.update()` 流程(每帧):
1. A/D 改 yaw(无 lerp,直接减)
2. W/S 玩家平移 + 分轴碰撞推出
3. 算 `desiredCam = headPos + camOffset(side/up/dist × yaw euler)`
4. `collideSteps=8` 从 headPos → desiredCam 步进采样,撞 AABB 时设 `t = (i-1)/8`
5. `targetCamPos = lerp(headPos, desiredCam, t)`
6. `camera.position.lerp(targetCamPos, 1 - exp(-dampLambda * dt))`
7. 若 `dist(camera, headPos) < minDist 1.4` → 硬 snap 到 1.4m(无 lerp)
8. `camera.lookAt(lookTarget)`

## 两个 bug 根因分析

### Bug A:相机时快时慢
- 转向时 `dampLambda=12` 收敛快,~83ms 基本到位 → 停转向瞬间"啪"地停,感觉冲一下
- 远离墙时 desiredCam 没被 clip,`t=1` 直接拉满 → 相机从贴墙位突然有 2.7m 远的目标,spring-damp 又拉过去 → 拉远感
- `turnRate 3.0 rad/s` 配 `dampLambda 12` → 转身时相机在弧线上扫得太快

### Bug B:近墙角色变大、远墙缩小 → 晕
- 主因:`collideSteps=8` 离散采样,t 量化为 0.125 步进 → 离墙距离变化呈阶梯跳
- 主因:L155-158 minDist 硬 snap 是无 lerp 的瞬时 push,跟 L148 的 lerp 叠加造成距离抖动
- 主因:方向也用 lerp 过渡(L148 整个 position 一起 lerp),近墙时相机方向跟着变化 → 视角"飘"

## 建议改动(可组合,Playtest 决定)

把下面排优先试:

### 1. 拆分 damp:方向快跟、距离慢跟(改 L148 拆 2 个 lerp) — 最高优先
- 方向:保持 `dampLambda 12`(快跟转向)
- 距离:单独 lerp,`dampLambda` 调到 4-6(慢慢拉近/拉远,不突进)
- 实现:`dirToTarget = targetCamPos - headPos`,lerp dir 和 dist 分开,再合成 position

### 2. 碰撞距离 minDist 改为软 clamp(改 L153-158) — 高优先
- 不要瞬时硬 snap。把 minDist 也走 lerp:`newDist = lerp(currentDist, max(minDist, clampedDist), dampFactor)`
- 或:把 minDist clamp 应用在 targetCamPos 上(L144 后),而不要在 camera.position 上 → lerp 自然把它平滑掉
- **保留 minDist 1.4 但改软 lerp**(不删,不调小,只改软 lerp)

### 3. collideSteps 用 ray-vs-AABB 连续 t(改 L135-142)— 中优先
- 复用 `src/game/los.ts` 的 segment-vs-AABB slab 方法,或直接在 controller 里写 `segmentClip(from, to, boxes) → t 命中点`
- 去掉 8 步量化跳,得到连续 `t = hitDist / totalDist`
- 进度:先做 1+2,基本够;若仍抖再上 3

### 4. 降低 turnRate 或加 lerp(改 L102)— 低优先
- 现在 A/D 直接 `yaw -= strafe * turnRate * dt`,可加 yaw 目标值 + lerp 让转向有惯性
- 或直接降 `turnRate 3.0 → 2.0 rad/s`(115°/s 更可控)

### 5. fov 降到 60-65(改 config)— 低优先
- 70° 近墙扩视角放大感强,降 fov 减少 motion sickness
- 试 65 一次,看可不可接受再调

### 6. 降低 dampLambda 到 8(改 config)— 兜底
- 直接平滑"啪"停感,但要测会不会感觉延迟
- 只在还晕时动(动 6 会改变整套相机的"感")

## 推荐顺序(快迭代)

第一轮(15-30min):改 1+2,Playtest 看晕不晕
第二轮:若仍抖,加 3(连续 t)
第三轮:配 4 或 5,微调
第四轮:只在还晕时动 6

**Sam 自主决定参数值**:从建议范围自己开干,直出 PR,不要每轮问审批。

## Playtest 验收(用 MCP chrome-devtools,禁自动化 long CDP 循环)

每改一组参数:

### 推荐:手玩验收
你 commit + push 后,PR 描述写"改了什么 + 建议用户试玩近墙抖不抖",等用户回 PR comment。

### 替代:MCP 短断言(若需要自己先看一眼)
1. `navigate_page` reload
2. `evaluate_script` 短脚本(<5s)读 camera-to-head distance:
   ```js
   // 若没有 getter,告诉 Snake 加;临时用 console.log 在 controller 内打 distance
   ```
3. 跑 20s,每 100ms 记 distance 看 variance,<0.3m 视为稳定
4. 截图近墙/远墙各一张

## 工时上限

预计 30-45 分钟一轮。超 90 分钟停下报告卡哪。

## Git

- 分支 `fix/camera-tune`
- commit author Sam(`git -c user.name=Sam -c user.email=sam@local`,不碰主 config)
- PR 标题:`fix(camera): 近墙/远墙距离抖动 + spring damp 调优`
- PR 说明必含:
  - 每组改动的参数对比(before→after)
  - 为什么这么改(对应根因)
  - playtest 步骤
  - 建议用户试玩哪种场景(近墙走 5m 看是否抖、转身 360° 看晕不晕)

## 边界(不要碰)

- 不要为了"修近墙"加鼠标指针锁或改键盘输入
- 不要改 player 半径/速度
- 不要改 NPC 或 ui 文件
- 不要写自动化 CDP 长循环脚本(参见 AGENTS.md 效率规则)
- 只允许新建 1 个临时测试文件(若希望单测 damp 拆分逻辑),完成后可留可删