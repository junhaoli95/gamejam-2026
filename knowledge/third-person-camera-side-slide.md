# 知识点:第三人称相机侧滑摆角(Side-Slide Swing)

> 来源:PR #19(`fix/camera-tune`)。2026-08-11 玩家反馈"靠墙角色变大、镜头晕" → 两轮调试后落地。
> 复用面:本作(1% 电)越肩相机、赛后咖啡厅(同架构)、任何第三人称 AABB 世界。

## 症状

1. 靠墙走时角色忽大忽小(2.7m → 1.4m 拉近),远处又弹回 → 晕
2. 相机时快时慢,停转向瞬间"啪"地停
3. 贴墙时画面出现书架贴脸 / 穿模

## 根因(按重要性)

1. **minDist 穿墙推挤(主凶)**:碰撞 clip 后相机目标只有 0.27m(贴墙 0.3m 时),再用
   `dist < minDist → dir.multiplyScalar(minDist/dist)` 硬推回 1.4m —— 方向没变,相机被
   **直接推进墙/书架里**(实测书架背面 0.23m 外)。书架背面贴脸 + 距离骤减 = "拉近 + 晕"。
   旧代码"每帧 clip 拉回 0.27m ↔ minDist 推回 1.4m 打架"还叠加了 60Hz 距离抖动。
2. **8 步离散采样**:`collideSteps=8` 把清距量化成 0.125 阶梯 → 离墙过程阶梯跳。
3. **整 vector lerp**:方向(yaw 转向)与距离(clip 恢复)绑同一个 λ,出墙瞬间距离 2.7m
   突变 → "冲一下";停转向瞬间全收敛 → "啪"地停。

## 方案:侧滑摆角(Side-Slide Swing)

核心思路:**方向被墙挡时,不缩短距离,而是绕玩家头部摆角找"清距够远"的机位**。
保距离 → 不拉近;清距来自连续 clip → 不穿墙。

```
每帧:
1. 期望机位方向 = 越肩 offset(side, up, dist) × yaw euler
2. 连续 segment-vs-AABB(slab 法)求该方向清距 clearDist
3. 若 clearDist ≥ minDist → 正位,距离 = min(clearDist, dist)
4. 否则绕 head 绕 Y 轴 ±10°…±90°(步进 10°)逐个试:
   取第一个 clearDist ≥ minDist 的摆角(最小摆角优先)
   全堵(角落)→ 取清距最大的摆角,距离 = 清距(贴墙但不穿墙)
5. 方向/距离拆分 spring-damp:方向 λ=12 快跟、距离 λ=5 慢跟,再合成机位
```

关键点:

- **minDist 语义改变**:不再是"相机距离下限"(那是穿墙元凶),变成**摆角接受阈值**——
  "清距 ≥ 1.4m 才认为这个方向站得住脚"
- **滞回**(swingHyst 0.15m):临界清距抖动(书架端头)时沿用上帧摆角,防左右甩
- **连续 slab clip**:`t0/t1` 三轴交集法(from→to 线段),零分配,返回连续清距,
  取代步进采样;`from` 恰在盒内时 `t0<0` → `max(0, t0)` 兜底
- 摆角搜索只在被挡时执行(常见帧只做 1-2 次 clip 测试);最坏 19 角度 × 30 盒 ≈ 0.05ms

## 参数(before → after,全部在 `CONFIG.camera`)

| 参数 | 值 | 说明 |
|---|---|---|
| `dampLambda` | 12(不变) | 方向阻尼,只管转向 |
| `dampDistLambda` | 5(新增) | 距离阻尼(4-6 手感区),慢拉近/拉远 |
| `minDist` | 1.4(语义改) | 摆角接受阈值,不再是距离下限 |
| `swingStepDeg` | 10 | 摆角步进(度) |
| `swingMaxDeg` | 90 | 最大摆角(度),嫌侧视大可调小(代价:距离缩到清距) |
| `swingHyst` | 0.15 | 滞回带(米) |
| `collideSteps` | 删除 | 被连续 slab clip 取代 |

## 实测数据(真实书架 3.0×2.4×0.6m,玩家贴墙 0.5m)

| 版本 | 相机距离 | 相机位置 | 结果 |
|---|---|---|---|
| 旧(第一轮后) | 1.40m | 书架背面 0.23m 外 | 穿墙、拉近 |
| 新(侧滑) | 2.70m | 摆角 80° 侧肩位,零穿墙 | 稳 |

## 关键代码 diff(before → after,`src/player/thirdPersonController.ts` update 内)

### ① 碰撞 clip:8 步采样 → 连续 slab(去阶梯跳 + 得连续清距)

```ts
// BEFORE:离散步进,清距量化成 0.125 阶梯;还拿不到"连续清距"给摆角用
let t = 1;
for (let i = 1; i <= CONFIG.camera.collideSteps; i++) {          // 8 步
  const s = i / CONFIG.camera.collideSteps;
  tmp.lerpVectors(headPos, desiredCam, s);
  if (cameraClipTest(tmp)) {                                     // 点在 AABB(外扩 pad)内?
    t = Math.max(0.1, (i - 1) / CONFIG.camera.collideSteps);
    break;
  }
}

// AFTER:slab 法三轴 t0/t1 交集,返回线段上最近碰撞前的 t ∈ [0,1],连续无量化
function segmentClearFraction(from, to): number {                 // 零分配,手工展开 x/y/z
  const d = segDir.subVectors(to, from);
  let tClear = 1;
  for (const b of colliders) {
    let t0 = 0, t1 = 1, hit = true;
    // 每轴: t = (c0 - start)/d;两交点排序后收窄 [t0, t1]
    //   |d| ≈ 0 → 起点不在盒区间内则整盒 miss
    //   t0 > t1 → 射线与盒在该轴无交集 → miss
    if (hit) tClear = Math.min(tClear, Math.max(0, t0));         // from 在盒内 → t0<0 → 0
  }
  return tClear;
}
```

### ② minDist 硬推 → 侧滑摆角(治"靠墙拉近/穿墙"的核心)

```ts
// BEFORE:clip 后目标只有 0.27m(贴墙 0.3m 时)→ minDist 硬推 1.4m
//  方向仍是"指向墙里"→ 相机穿进书架;且与 clip 每帧打架 → 距离抖动
targetCamPos.lerpVectors(headPos, desiredCam, t);
const dampFactor = 1 - Math.exp(-CONFIG.camera.dampLambda * dt);
camera.position.lerp(targetCamPos, dampFactor);
const dir = tmp.subVectors(camera.position, headPos);
const dist = dir.length();
if (dist > 1e-6 && dist < CONFIG.camera.minDist) {               // ← 穿墙元凶
  dir.multiplyScalar(CONFIG.camera.minDist / dist);              //   沿原方向推到 1.4m
  camera.position.copy(headPos).add(dir);
}

// AFTER:正位被挡 → 绕 head 绕 Y 轴摆角找清距 ≥ minDist 的机位;全堵取清距最大
const camLen = camOffset.length();
const swingClear = (deg) => {
  tmp.copy(camOffset).applyAxisAngle(Y_AXIS, (deg * Math.PI) / 180);
  tmp2.copy(headPos).add(tmp);
  return segmentClearFraction(headPos, tmp2) * camLen;           // 连续清距(米)
};
let swing = 0;
if (swingClear(0) < CONFIG.camera.minDist) {
  if (prevSwing !== 0 && swingClear(prevSwing) >= CONFIG.camera.minDist - CONFIG.camera.swingHyst) {
    swing = prevSwing;                                           // 滞回:沿用上帧,防临界甩
  } else {
    let bestClear = 0;
    for (let deg = 10; deg <= 90; deg += 10) {                   // ±10°…±90°
      for (const s of [deg, -deg]) {
        const clear = swingClear(s);
        if (clear > bestClear) { bestClear = clear; swing = s; } // 兜底:角落取清距最大
        if (clear >= CONFIG.camera.minDist) break;               // 第一个够远的最小摆角
      }
      if (bestClear >= CONFIG.camera.minDist) break;
    }
  }
}
prevSwing = swing;
const clearDist = swingClear(swing);
const targetDist = clearDist >= CONFIG.camera.minDist            // minDist 语义:摆角阈值
  ? Math.min(clearDist, CONFIG.camera.dist)                      // 正常:≤ dist
  : clearDist;                                                   // 全堵角落:贴墙不穿墙
```

### ③ 整 vector lerp → 方向/距离拆分阻尼(治"冲停/突变")

```ts
// BEFORE:方向(转向)与距离(clip 恢复)绑同一 λ12 → 停转"啪"、出墙瞬间距离 2.7m 突变
camera.position.lerp(targetCamPos, dampFactor);

// AFTER:方向 λ12 快跟、距离 λ5 慢跟,再合成(相机叠 head 时直接到位防 NaN)
const curOff = camCurOff.subVectors(camera.position, headPos);   // 当前偏移
const curDist = curOff.length();
camTargetOff.subVectors(targetCamPos, headPos).normalize();      // 目标方向
const dampDir = 1 - Math.exp(-CONFIG.camera.dampLambda * dt);    // 12
const dampDist = 1 - Math.exp(-CONFIG.camera.dampDistLambda * dt); // 5
curOff.multiplyScalar(1 / curDist);
curOff.lerp(camTargetOff, dampDir).normalize();
const newDist = curDist + (dampTargetDist - curDist) * dampDist;
camera.position.copy(headPos).addScaledVector(curOff, newDist);
```

## 通用教训

1. "近墙不贴脸"这类保护,先想**能不能换方向**,再想"缩距离"——缩距离常常是穿墙的近义词
2. 离散采样(步进/栅格)在连续运动中必有阶梯感,能用解析法(slab)就解析
3. 两个物理量(方向/距离)共享一个 lerp 参数时,先拆开再调,别调共同值凑合
4. 调试时把相机位置数值打出来(本项目:`window.__camDebug.getDist()/getPos()`,DEV-only),
   先确认"相机到底在哪",再谈"看起来晕不晕"
