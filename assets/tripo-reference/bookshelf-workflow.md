# 书架 `bookshelf.glb` 完整制作流程（Meshy）

日期：2026-08-15

## 目标

把实地图书馆书架转成项目使用的 PS2 日式动漫游戏风格低模资产。

风格采用 C 路线：角色可以有明显黑色 toon outline；书架等环境资产不使用厚重全局黑边，而是依靠清晰轮廓、硬边、平面色块和少量手绘结构线表达风格。

## 资产规格

- 文件名：`bookshelf.glb`
- 目标尺寸：约 `3.0m × 2.4m × 0.6m`（宽 × 高 × 深）
- 面数：目标少于 5000 三角形，最多可放宽到 8000
- 贴图：只保留 albedo/base color
- 贴图尺寸：256-512px，书架最多 1024px
- 原点：底部中心
- Y 轴：向上
- 文件大小：小于 3MB

## 当前参考文件

主参考图：

```text
assets/tripo-reference/bookshelf-primary.jpg
```

补充观察图：

```text
assets/tripo-reference/bookshelf-secondary.jpg
```

主参考图来自实地图书馆照片的裁剪，负责书架的真实结构、层板和书籍密度。`bookshelf-secondary.jpg` 只用于观察书籍陈列和层板样式，第一次 Meshy 生成时不要把两张图同时作为多视角输入，因为它们不是同一个书架的不同角度。

Naruto 游戏截图只负责风格判断，不要作为书架的几何主输入，否则 Meshy 可能把角色形体带入环境资产。

## 第一阶段：准备 Meshy 输入

### Image to 3D 操作

1. 打开 Meshy 的 **Image to 3D**，不要切到 Text to 3D。
2. 上传 `bookshelf-primary.jpg`。
3. 名称填写：`PS2 anime library bookshelf`。
4. AI Model 选择 `Meshy 6` 或页面显示的最新模型。
5. 如果有 `Image Enhancement`，可以开启；如果它把背景增强得更复杂，则关闭。
6. 如果有 `Multi-view`，第一次可以开启，让 Meshy 推断书架的侧面和背面；不要把 `bookshelf-secondary.jpg` 当成另一个视角上传。
7. 不要添加 Naruto 角色图，不要添加桌子、柱子或整张图书馆照片。
8. 点击 `Generate`。

### 文字约束的实际用法

Meshy 的普通 `Image to 3D` 页面可能只有图片、名称和生成按钮，没有长 Prompt 输入框。遇到这种界面：

- 不要为了粘贴 Prompt 切换到 `Text to 3D`，否则会失去实拍书架的几何参考。
- 直接用图片生成，风格约束放到生成后的 Blender 后处理。
- 如果当前账户有 `Description`、`Prompt` 或 `3D Agent`，再使用下面的文字约束。
- 3D Agent 是独立的对话式功能，可能受账户等级或 Beta 权限限制，不把它作为本次必需流程。

如果页面提供文本输入框，把下面整段粘贴进去：

```text
Use the uploaded real library photo as the shape and proportion reference.
Extract one single bookshelf module from the scene, not the entire library.

Stylized low-poly environment prop inspired by PS2-era Japanese anime games,
hand-painted flat-color albedo texture,
clean hard edges and a strong readable silhouette,
warm light-oak wooden side frame and top cap,
muted charcoal-gray metal shelf rails,
four to five horizontal shelves filled with simplified colorful book blocks,
red, blue, green, yellow and off-white book spines,
slightly exaggerated simplified proportions,
clean modular library asset,
warm earthy palette,
subtle hand-painted dark accents on shelf joints and wood seams,
no thick black outline around the entire environment prop,
target under 5000 triangles,
256-512px texture atlas,
single modular object,
origin at bottom-center,
Y axis up.

The final asset should be approximately 3.0 meters wide,
2.4 meters tall and 0.6 meters deep.
```

### Negative Prompt 或禁止项

Meshy 普通 Image to 3D 通常没有独立 Negative Prompt 栏。如果当前页面或 3D Agent 提供该栏，粘贴：

```text
photorealistic, realistic wood grain, furry material, glossy PBR,
normal map, roughness map, metallic map, thick black contour outline,
entire library scene, multiple bookshelf units, people, chairs, tables,
floor, ceiling, wall, reading area, book cart, signage, readable text,
logos, random decorations, plants, wheels, platform, base, pedestal,
floating parts, broken shelves, excessive tiny details
```

如果只有一个文本框，把下面一句追加到主 Prompt 末尾：

```text
Do not include photorealistic materials, PBR maps, thick black outlines, people,
chairs, tables, floor, ceiling, walls, signage, readable text, logos, carts,
platforms, bases or any surrounding library scene.
```

## 第二阶段：Meshy 生成后初筛

先看 Meshy 预览，不要马上导出最终文件。至少检查正面、三分之四和侧面。Meshy 官方图片转 3D 会默认生成带纹理的模型，后面必须在 Blender 删除不需要的 PBR 通道。

### 通过条件

- 一眼看起来是一个独立书架，而不是整间图书馆。
- 木框、层板和书籍块的结构清楚。
- 书脊只有色块，没有可读标题、Logo 或乱码文字。
- 没有生成地板、天花板、墙、平台、底座或推车。
- 没有生成椅子、桌子、人物或其他家具。
- 材质是手绘平色和硬边，不是写实木纹或亮面 PBR。
- 书架轮廓和真实图书馆照片的比例关系大致一致。
- 书架没有明显断裂、悬空、穿插或缺失层板。
- 面数在目标范围内，或至少有机会通过 Blender 简化到目标范围。

### 失败处理

- 生成整间图书馆：加强 `one single bookshelf module only`，并重复 `not the entire library scene`。
- 生成椅子或桌子：追加 `bookshelf only, no furniture`。
- 出现文字：追加 `blank book spines, abstract color blocks, no readable text`。
- 出现写实材质：追加 `flat hand-painted albedo, matte, no PBR, no realistic wood grain`。
- 过于卡通或没有结构：减少 `exaggerated`，补充 `functional library shelf construction`。
- 书架太矮或太宽：重新强调 `3.0m wide, 2.4m tall, 0.6m deep`。
- 有大量底座或地板：追加 `cut away all floor, platform and base geometry`。

如果核心结构失败，改 prompt 后重新生成；不要用 Blender 去补救一个已经错误的书架形体。

## 第三阶段：Meshy 下载和文件初检

Meshy 预览通过后下载 GLB，并确认：

- 文件扩展名是 `.glb`。
- 文件不是压缩包里的整场景导出。
- 文件中没有隐藏的地面、灯光、摄像机或人物。
- 贴图没有丢失。
- 文件可以在 Blender 中正常打开。

临时下载文件可命名为：

```text
bookshelf-meshy-v1.glb
```

最终文件才命名为：

```text
bookshelf.glb
```

## 第四阶段：Blender 后处理

Meshy 直出的 GLB 不直接放进游戏。按下面顺序处理：

### 1. 清理几何

- Import GLB。
- 删除地面、平台、底座、家具、人物和其他无关对象。
- 删除灯光、摄像机和空对象。
- `Merge by Distance`，阈值约 `0.001m`。
- 视需要使用 `Limited Dissolve`，角度约 `30°`，但不要破坏书架轮廓。
- 保留清晰的 hard edges，不要对整个模型强制 smooth shading。

### 2. 校准尺寸和原点

- 设置模型高度约为 `2.4m`。
- 设置宽度约为 `3.0m`，深度约为 `0.6m`。
- 应用 Scale 和 Rotation。
- 原点设置在模型底部中心。
- 确认模型底面位于 `Y=0`，没有悬空或埋入地面。

### 3. 简化面数

- 三角面优先控制在 5000 以下。
- 书籍不需要单独建出每个标题和细小装饰。
- 远距离不可见的小倒角和背面细节可以删除。
- 不要为了降面把书架变成没有层板的盒子。

### 4. 材质和贴图

- 材质只保留 albedo/base color。
- 删除 normal map。
- 删除 roughness map。
- 删除 metallic map。
- 删除不必要的 AO、emission 和透明通道。
- 贴图使用 256-512px；书架确有必要时最多 1024px。
- 书脊改成红、蓝、绿、黄、米白的简化色块。
- 木框保持暖浅木色，接近 `#B08C5E`。
- 金属层板使用低饱和深灰，不要高光镜面效果。
- 阴影保持清楚的平面分区，不使用照片级渐变。

如果需要重新烘焙：

1. 只烘焙 Diffuse/albedo。
2. 使用 512px 贴图。
3. 不输出 normal、roughness、metallic。
4. 检查贴图没有文字 Logo 或现实书名。

### 5. 导出 GLB

- Apply Modifiers。
- 保留 UVs。
- 保留 Normals。
- 只导出需要的书架对象和 albedo 贴图。
- 不勾选额外 Compression。
- 文件名严格使用小写：`bookshelf.glb`。

## 第五阶段：放入项目

把最终文件放入：

```text
public/library/bookshelf.glb
```

不要放到 `src/`，也不要改成 `Bookshelf.glb` 或其他大小写形式。

项目运行时会通过现有 GLB 加载管线替换书架占位模型；碰撞盒仍由代码控制，因此 GLB 不负责碰撞。

## 最终验收

### 资产验收

- [ ] 文件名严格为 `bookshelf.glb`。
- [ ] 文件位于 `public/library/`。
- [ ] GLB 小于 3MB。
- [ ] 三角面少于 5000，或已确认可接受。
- [ ] 贴图只有 albedo/base color。
- [ ] 贴图不超过 512px，除非确有必要使用 1024px。
- [ ] 原点在底部中心，Y 轴向上。
- [ ] 没有平台、地板、底座、桌子、椅子或人物。
- [ ] 没有可读文字、Logo 或乱码书名。
- [ ] 风格是 PS2 动漫低模手绘感，不是写实 PBR。

### 游戏内验收

- [ ] 书架底部贴地。
- [ ] 书架没有明显漂浮、穿地或比例错误。
- [ ] 玩家和 NPC 可以正常绕过书架。
- [ ] 书架不会阻挡充电桩、桌子或主要路线。
- [ ] 暖光下木框和书籍色块仍然清楚。
- [ ] 与程序生成的墙、桌椅和其他书架风格不冲突。

## 交付结果

完成后保留：

```text
bookshelf.glb
```

并把以下信息一起记录下来：

- 最终三角面数
- 最终贴图尺寸
- GLB 文件大小
- Blender 是否删除过 PBR 通道
- 是否经过游戏内运行检查
