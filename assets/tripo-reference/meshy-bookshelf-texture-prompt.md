# Meshy 书架贴图阶段 Prompt

日期：2026-08-15

## 当前状态

Smart Topology 已经生成书架白模：

- 三角面：`3,520`
- 顶点：`2,267`
- 几何阶段暂时通过，不要重新生成模型
- 当前任务只做 `AI Texturing / 贴图`

## Meshy 操作

1. 打开当前书架 asset，进入 `贴图` 或 `AI Texturing`。
2. 保持当前白模和 UV，不要重新上传其他书架模型。
3. `Art Style` 首选 **Japanese Anime**。
4. 如果效果太写实，再试 **2.5D Hand-drawn**。
5. 不建议选择 **Cartoon Line Art**，它可能给环境资产加过粗的黑色线条。
6. 如果有 `Keep Original Texture and UV`，保持开启。
7. 如果有 `Generate PBR Maps`，先关闭；如果不能关闭，生成后只保留 albedo，删除 normal、roughness 和 metallic。
8. 贴图分辨率优先选择最低可用档；如果最低是 2K，后续在 Blender 缩到 512px。
9. 如果有参考图输入，优先使用 Naruto 游戏角色截图中裁掉背景的角色部分，只把它当作色块、阴影和动漫风格参考。
10. 不要上传带 Logo、菜单文字或多个人物的 Naruto 菜单截图，否则文字和角色可能被画到书脊上。

## 主 Prompt（低于 800 字）

```text
PS2-era Japanese anime game environment prop texture, inspired by early Naruto Ultimate Ninja on PlayStation 2. Hand-painted flat albedo, clean hard-edged color blocks, simple two-tone cel shadows. Warm library palette: light oak #B08C5E, charcoal-gray shelf rails #4A4A45, off-white #F0EDE6, muted red, blue, green and yellow book spines. Keep the bookshelf geometry and UVs unchanged. Matte wood with broad painted highlights and simplified grain, not photorealistic. Books are abstract color blocks: no readable text, letters, logos, faces or character art. Environment only: no thick black outline, glossy PBR, metallic sparkle, extra objects, floor or background. Cohesive PS2 low-poly game texture, crisp at gameplay distance.
```

## 如果有 Negative Prompt 栏

```text
photorealistic, glossy PBR, realistic wood grain, readable text, letters, logos, faces, anime characters, Naruto symbols, thick black outline, comic ink contour, floor, background, extra furniture, random objects, metallic shine
```

如果只有一个输入框，不要再重复粘贴 Negative Prompt；主 Prompt 已经包含关键禁止项。

## 风格参考图规则

- Naruto 角色游戏截图：可以作为色彩、硬边和阴影参考。
- Naruto 菜单截图：只用于理解整体风格，不建议作为贴图参考图，因为包含 Logo、菜单文字和多个角色。
- 实地图书馆照片：只用于真实木色、书架层板和书籍密度，不要用它替代动漫风格参考。
- 参考图只影响贴图风格，不应改变白模的书架结构。

## 贴图生成后验收

- [ ] 木框是暖浅木色，接近 `#B08C5E`。
- [ ] 金属层板是低饱和深灰，不是镜面金属。
- [ ] 书籍是红、蓝、绿、黄、米白色块。
- [ ] 书脊没有可读文字、Logo、人物脸或 Naruto 图案。
- [ ] 阴影是清楚的两段或少量色阶，不是照片级渐变。
- [ ] 环境资产没有厚重全局黑边。
- [ ] 没有增加地面、背景、家具或其他物体。
- [ ] 预览切换到正常材质模式后，颜色仍然统一且不刺眼。

## 导出前处理

Meshy 可能同时生成 albedo、normal、roughness 和 metallic。项目只使用 albedo：

1. 下载或打开模型后进入 Blender。
2. 材质节点只保留 albedo/base color。
3. 删除 normal、roughness、metallic、AO 和 emission 通道。
4. 将贴图缩放到 512px 以内。
5. 检查模型仍为约 3,520 三角形，或没有超过 5,000 三角形。
6. 确认原点在底部中心，Y 轴向上。
7. 最终导出为 `bookshelf.glb`。
