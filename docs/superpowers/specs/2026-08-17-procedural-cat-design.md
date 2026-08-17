# 程序化猫方块造型与低开销渲染设计

日期：2026-08-17

## 目标

用 Three.js 程序化生成一只参考用户家猫轮廓的低模棕色虎斑猫，并为主角和移动中的 NPC 增加简单、可读、类似 Minecraft 的走路动作。不使用 Meshy/Tripo、GLB、骨骼动画或真实毛发。

## 范围

### 本次包含

- 主角：站立棕色虎斑猫。
- 移动 NPC：复用站立猫结构，可通过 palette 换颜色。
- 桌边静态猫：保留坐姿和同一套方块视觉语言，但走低开销合并渲染路径，不做逐猫动画。
- Walk、idle、dash 三种视觉状态。
- 四肢对角线交替摆动、身体 bob、头部轻摆、尾巴摆动和耳朵小动作。
- 现有移动、碰撞、NPC 状态机和 `game/` 逻辑不变。

### 本次不包含

- 骨骼、蒙皮、GLB 动画。
- 真实毛发、毛发贴图或复杂 IK。
- 改变玩家碰撞半径、移动速度或 NPC 寻路。
- 新增可交互的猫部件。

## 视觉设计

### 形体（Q版 Minecraft 风双足猫）

玩家和移动 NPC 使用独立低模部件，便于动画；身体、头部和四肢统一为方块比例：

- 略矮方块头、短方块身体，避免圆球头和方盒身混搭。
- 两条短方块腿站立走路，腿顶端只与身体轻微连接，不穿入身体；两只扁方块脚掌落地。
- 两只短方块手臂放在身体外侧，肩部轻微搭接，手臂和肘部完整露出。
- 方块胸口贴片和口鼻，耳朵保留低模三角轮廓。
- 分段尾巴形成可摆动的弧线。
- 少量胸口、口鼻和脚尖的奶油色块，以及位于猫脸正面的虎斑条纹。
- 眼睛使用朝向猫脸 `-Z` 的小平面贴图，使用方形琥珀虹膜和深色竖瞳，不添加白色高光；贴图为模块级共享资源。
- 不追求像真人，只采用“像人一样两脚走路”的 Q版姿态。

站立猫目标高度约 `1.2m`，根节点底部位于 `y=0`。几何使用 `flatShading` 和硬边；不做全局黑色描边。

### 主角 palette

- 主毛色：暖棕 `#6B4A2F`。
- 次级毛色：浅棕 `#8B6445`。
- 胸口、口鼻、脚尖：奶油白 `#F0E6D2`。
- 虎斑条纹：深棕黑 `#2A211D`。
- 眼睛：暖琥珀色竖瞳，使用一张共享的 `64x64` 程序化 `DataTexture`。

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

### Walk（Minecraft 式双足步态）

- 由 `speed` 判断是否移动，低于阈值时进入 idle。
- 移动时 `phase += speed * dt * 2.5`，保持较慢、可读的步频。
- 左右腿交替前后摆动（反相半周期）。
- 手臂与同侧腿反相摆动，形成自然摆臂。
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

桌边座位继续使用 `createSeatedCat`，但不复用站立猫的完整动态 rig：

- 坐姿猫的身体、头、四肢、耳朵、尾巴和面部细节先烘焙到一个共享几何模板。
- 每只坐姿猫只保留一个静态 `Mesh`，最多使用两个材质组；不同毛色按 palette 共享模板和材质。
- 静态猫不进入每帧动画更新；坐姿只由创建时的 group 位置和朝向决定。
- `createSeatedCat` 返回的 group 保持现有接口和 `proceduralCat` 标记，方便 `loadLibraryScene` 重建和销毁。

## 性能预算与资源纪律

- 动态站立猫最多 `12` 个 renderable mesh；主角加 `2-3` 个移动 NPC 的数量固定且可接受。
- 静态坐姿猫每只 `1` 个 mesh，最多 `2` 个材质组；默认布局约 `62` 只坐姿猫时，猫相关 renderable mesh 目标不超过 `110`，不再出现当前约 `870` 个 mesh 的情况。
- 相同尺寸的 Box/Cone/Plane 几何按 key 缓存；共享几何不由单只猫的 dispose 路径释放。
- 材质按 palette 缓存；眼睛贴图和眼睛材质为模块级单例，不为每只猫创建纹理。
- 静态坐姿猫不每帧更新 phase、position 或 rotation；动态猫每帧只修改少量部件的 rotation/position。
- 小型装饰部件不参与阴影标记；当前 renderer 的全局 DPR 和帧率不在本次角色改动中盲调，另行实测。
- `game/` 零改动，动画不进入逻辑测试和状态机开销。

## 测试与验收

- `computeCatWalkPose` 或等价纯函数在相同 phase 下输出确定结果。
- 对角线腿组相差半周期，左右腿不会同向摆动。
- idle 速度为零时不推进根节点位置。
- dash 只改变动画幅度/频率，不改变游戏速度。
- 站立猫部件、palette 和根节点落地正确。
- 主角和 NPC 使用站立猫，桌边猫仍保持坐姿。
- 站立猫的眼睛平面朝向 `-Z`，从正面斜视角可见且不被头部裁掉。
- 站立猫的手臂、腿和脚掌不嵌入身体；脚掌底部落在 `y=0` 附近。
- 坐姿猫只有一个静态 renderable mesh，不进入场景每帧动画更新。
- 默认布局下，角色 mesh 数量符合性能预算，重复几何和眼睛纹理均为共享资源。
- `npm test` 全部通过。
- `npm run build` 通过。
- 浏览器内确认猫能走、停、冲刺，且没有穿地、漂浮或箭头错位。

## 分支与交付

- 实现在独立 worktree：`opencode/ben-procedural-cat`。
- 继续更新已 OPEN 的 PR #32，不回滚已有双足动画和 NPC 接入。
- 设计文档单独提交后再进入实现；实现、测试和验证完成后继续更新 PR #32。
