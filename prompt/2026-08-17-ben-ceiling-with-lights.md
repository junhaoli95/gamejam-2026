# Ben — 带灯天花板(参考图实现)

**Dispatched**: 2026-08-17
**Agent**: Ben
**Base**: `main`(=`0c10b0f`,PR #31 程序化书架 + PR #32 程序化猫已 merge)
**Estimated**: 小-中改动,1-2h
**参考图**: 用户会提供一张天花板参考图,按图风格做(灯具排布/横梁/纹理)

## 任务

把现有的简单天花板平面替换成**带灯的精致天花板**。用户会给你一张参考图,你按图风格实现(灯具造型、排布、横梁/方格、材质)。程序化 Three.js geometry,不依赖外部 GLB/贴图。

## 现状(必读)

文件:`src/scene/loadLibraryScene.ts`

现有天花板在 `:450-455`:
```ts
const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xe6d5a8, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_H), ceilingMat);
ceiling.rotation.x = Math.PI / 2;  // 朝下
ceiling.position.y = WALL_H;       // 顶到墙高
scene.add(ceiling);
```

**关键常量**(同文件 `:133-136`、`:425`):
- `ROOM_W = LAYOUT.room.w` — 默认 Islands = **32**
- `ROOM_H = LAYOUT.room.h` — 默认 Islands = **24**
- `HALF_W = ROOM_W / 2` = 16
- `HALF_H = ROOM_H / 2` = 12
- `WALL_H = 3.2`(米,墙高 = 天花板高度)
- `WALL_T = 0.2`(墙厚)

天花板顶满整个房间 `[-16, 16] × [-12, 12]`,高度 `y = 3.2`。

## 现有光照(不要破坏平衡,可补不可减)

`:395-406`:
```ts
scene.add(new AmbientLight(0xffffff, 0.5));
scene.add(new HemisphereLight(0xf6f8fa, 0x8f8672, 0.5));
const daylight = new DirectionalLight(0xdfe9ff, 0.45);  // 东窗日光
// 3 个 PointLight(0xfff4e2, 0.55, 14, 2.0) at [0,-8,4]/[0,8,4]/[10,-3,4]
```

天花板灯具如果发光,用 `MeshStandardMaterial.emissive` 或 `MeshBasicMaterial`(纯发光面)。**最多再加 4 个 PointLight**(性能预算,总 active point light ≤ 现有 3 + 4 = 7)。灯具若多,只用 emissive mesh 不用真光源。

## 不可破坏的不变项

- **房间尺寸跟随 `LAYOUT.room`**:不要硬编码 32/24,用 `ROOM_W`/`ROOM_H` 常量。5 个布局快照(`layout.json` + `layouts/layout{1,2,3,5}.json`)的 `room.w/h` 各不同,天花板要适配
- **`WALL_H = 3.2` 不动**:墙/窗/门楣都依赖这个高度。横梁/凹槽可以下沉(≤ 0.4m),不能上凸(上面没空间)
- **玩家可见文字全部英语**(本任务无 UI 文字,不影响)
- **不改 `loadLibraryScene.ts` 以外的文件**:天花板是纯视觉,无碰撞/无逻辑/无配置。若需要新配置(如灯具数量),加到 `LAYOUT` 里要在 prompt 里说——但本任务建议**硬编码合理默认值**,不扩 schema
- **debug overlay top-down 相机**:天花板在俯视时挡视野。现有注释说"留 PR #14 toggle visible"。你**不需要**做 toggle,但天花板 mesh 要能被 `scene.remove` 干净移除(不要散落几十个 mesh 难管理——用 `THREE.Group` 包起来,name='ceilingGroup')

## 你的方法论

- **TDD 非强制**:纯视觉改动,现有测试不覆盖天花板。但 `npm run build` 必须过
- **`npm test` + `npm run build` 全绿**才算 READY FOR REVIEW
- **不要 merge**:你只 commit + push + 开 PR + 说 "READY FOR REVIEW" 停手(用户 merge)
- **commit 身份**:`git config user.name "Ben" && git config user.email "ben@agent.local"`(worktree 级不要改全局 — 用户已配置 local Snake,你覆盖 worktree 级即可)
- **分支命名**:`feat/ceiling-with-lights`
- **worktree**:用户会给你建好 worktree,你只需在 worktree 里 commit + push

## 实施建议(按参考图调整)

1. **替换 `:450-455` 的 ceiling 平面**:用一个 `THREE.Group` name='ceilingGroup' 替换,内含:
   - 基底平面(保留现有米黄/按参考图改色)
   - 横梁/方格/凹槽(按参考图,BoxGeometry 下沉 0.2-0.4m)
   - 灯具(按参考图:吸顶灯/灯带/筒灯)—— emissive mesh 为主,关键位置加 PointLight

2. **灯具排布**:沿房间长轴对称排列。Islands 32×24 → 建议 2×3 或 3×4 网格(6-12 盏),跟随参考图

3. **性能**:整组 ≤ 30 mesh。横梁用长 BoxGeometry,灯具用低多边形 cylinder/cone + emissive sphere/circle

4. **共享资源**:材质/几何体用缓存,`userData.sharedResource = true`(参考 `proceduralCat.ts` 的 `materialCache`/`sharedGeometryCache` pattern)。dispose 时不要 dispose 共享资源

## 验收

- [ ] `npm run build` 通过
- [ ] `npm test` 全绿(104/104,不应受影响)
- [ ] 天花板在 Islands 默认布局 32×24 视觉正确
- [ ] 切换其他布局(layout1 Open Lobby / layout3 Maze)天花板不穿帮(尺寸跟随 `ROOM_W/H`)
- [ ] 灯具发光不爆光(emissive intensity ≤ 1.5,PointLight intensity ≤ 0.6)
- [ ] 俯视时天花板可被 `scene.remove(ceilingGroup)` 干净移除(可在 console 验证:`scene.getObjectByName('ceilingGroup')`)

## 署名

- commit / PR body 署名 "实现:Ben"
