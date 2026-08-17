# 程序化棕色虎斑猫与走路动画设计

日期：2026-08-17

## 目标

用 Three.js 程序化生成一只参考用户家猫轮廓的低模棕色虎斑猫，并为主角和移动中的 NPC 增加简单、可读、类似 Minecraft 的走路动作。不使用 Meshy/Tripo、GLB、骨骼动画或真实毛发。

## 范围

### 本次包含

- 主角：站立棕色虎斑猫。
- 移动 NPC：复用站立猫结构，可通过 palette 换颜色。
- 桌边静态猫：保留坐姿，增加轻微待机动作但不走路。
- Walk、idle、dash 三种视觉状态。
- 四肢对角线交替摆动、身体 bob、头部轻摆、尾巴摆动和耳朵小动作。
- 现有移动、碰撞、NPC 状态机和 `game/` 逻辑不变。

### 本次不包含

- 骨骼、蒙皮、GLB 动画。
- 真实毛发、毛发贴图或复杂 IK。
- 改变玩家碰撞半径、移动速度或 NPC 寻路。
- 新增可交互的猫部件。

## 视觉设计

### 形体

猫由独立低模部件组成，便于动画：

- 椭圆身体和略宽的胸腔。
- 低模头部、口鼻和大尖耳。
- 四条短腿和四只脚掌。
- 两段或三段尾巴，形成可摆动的弧线。
- 少量胸口、口鼻和脚尖的奶油色块，表达用户照片里的长毛猫特征。

站立猫目标高度约 `1.2m`，身体宽度约 `0.55m`，根节点底部位于 `y=0`。几何使用 `flatShading` 和硬边；不做全局黑色描边。

### 主角 palette

- 主毛色：暖棕 `#6B4A2F`。
- 次级毛色：浅棕 `#8B6445`。
- 胸口、口鼻、脚尖：奶油白 `#F0E6D2`。
- 虎斑条纹：深棕黑 `#2A211D`。
- 眼睛：暖琥珀色，使用小低模球体。

NPC 复用结构，通过 palette 覆盖主毛色和胸口色；不改变动画接口。

## 模块与接口

新增 `src/scene/proceduralCat.ts`，负责纯 Three.js 视觉部件和动画，不读 DOM、不读游戏状态。

建议导出：

```ts
interface CatPalette {
  fur: number;
  furLight: number;
  chest: number;
  stripe: number;
  eye: number;
}

interface CatMotion {
  speed: number;
  directionX: number;
  directionZ: number;
  isDashing: boolean;
  dt: number;
}

function createStandingCat(palette: CatPalette): THREE.Group;
function createSeatedCat(palette: CatPalette, rotationY: number): THREE.Group;
function updateCatAnimation(cat: THREE.Group, motion: CatMotion): void;
```

动画所需的腿、尾巴、头部引用保存在模块内部的 `WeakMap<THREE.Group, CatRig>` 中，外部只持有普通 `THREE.Group`，不改变现有 `LibraryScene.player` 和 `npcMeshes` 类型。

## 动画设计

### Walk

- 由 `speed` 判断是否移动，低于阈值时进入 idle。
- `phase += speed * dt * walkFrequency`。
- 前左腿与后右腿为一组，前右腿与后左腿为另一组。
- 两组腿相差半个周期，摆动角度保持低模可读范围。
- 身体沿 Y 轴轻微 bob，头部使用更小的反向 bob。
- 尾巴以较慢频率左右摆动。

### Idle

- 身体做低幅度呼吸。
- 尾巴缓慢摆动。
- 耳朵以低概率做短促 twitch。
- 不改变根节点位置和游戏碰撞。

### Dash

- 沿当前朝向让身体轻微前倾。
- 提高 walk phase 速度和腿摆幅。
- 尾巴向后偏，形成速度感。
- 不增加粒子或额外模型，避免视觉和性能范围膨胀。

## 数据流接入

### 玩家

`loadLibraryScene.ts` 创建站立猫并在场景 update 中记录上一帧玩家位置，用位置差计算 `speed` 和方向，再调用 `updateCatAnimation`。玩家 controller 继续只负责移动和旋转。

### NPC

`npcMesh.ts` 的 update 接收 `dt`，记录每个实体上一帧的 `x/z`，用实际位置差驱动对应站立猫；`moving` 或 `wander` 状态且速度超过阈值时使用 walk，其他情况使用 idle。NPC group 根节点根据移动方向旋转，头顶箭头位置规则同步调整到站立猫高度。

### 静态坐姿猫

桌边座位继续使用 `createSeatedCat`，不纳入移动 NPC 的 walk 数据；可复用同一个 idle 动画但保持坐姿几何。

## 性能预算

- 单只站立猫约 10-15 个低模 Mesh，主角加 2-3 个移动 NPC 可接受。
- 材质按 palette 缓存，避免每帧创建材质。
- 动画每帧只修改少量部件的 rotation/position，不创建临时 geometry。
- `game/` 零改动，动画不进入逻辑测试和状态机开销。

## 测试与验收

- `computeCatWalkPose` 或等价纯函数在相同 phase 下输出确定结果。
- 对角线腿组相差半周期，左右腿不会同向摆动。
- idle 速度为零时不推进根节点位置。
- dash 只改变动画幅度/频率，不改变游戏速度。
- 站立猫部件、palette 和根节点落地正确。
- 主角和 NPC 使用站立猫，桌边猫仍保持坐姿。
- `npm test` 全部通过。
- `npm run build` 通过。
- 浏览器内确认猫能走、停、冲刺，且没有穿地、漂浮或箭头错位。

## 分支与交付

- 实现在独立 worktree：`opencode/ben-procedural-cat`。
- 基于书架 PR #31 当前 HEAD，作为后续独立 PR。
- 不修改或追加提交到已 OPEN 的 PR #31。
- 实现、测试和验证完成后再创建新的 PR。
