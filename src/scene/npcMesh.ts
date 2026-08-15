// PR #16 B:NPC 头顶箭头 Sprite + mesh 位置同步。
// 每只 npcMeshes[i] 对应一个箭头(实心向下三角,CanvasTexture 程序生成,零素材)。
// update():把 mesh 挪到 entity 位置(猫就是实体的可见化身)+ 箭头跟着头顶 1.2m,
// 颜色按 state:绿=idle(可用) / 橙=wander(闲逛) / 黄=moving(移动) / 红=occupying(已占桩)。
import * as THREE from 'three';
import type { NpcEntity } from '../game/npc';

const MESH_Y = 0.45;          // 坐姿猫基座高度(与 randomizeOccupiedOutlets 摆位一致)
const ARROW_ABOVE_MESH = 1.2; // 头顶 1.2m
const ARROW_Y = MESH_Y + ARROW_ABOVE_MESH;

const STATE_COLOR: Record<NpcEntity['state'], number> = {
  idle: 0x4eff7a,       // rgba(78,255,122) 绿(可用)
  wander: 0xff9b3a,     // rgba(255,155,58) 橙(闲逛)
  moving: 0xffd24a,     // rgba(255,210,74) 黄(移动)
  occupying: 0xff5a5a,  // rgba(255,90,90) 红(已占桩)
};
const STATE_OPACITY: Record<NpcEntity['state'], number> = {
  idle: 0.7,
  wander: 0.9,
  moving: 0.9,
  occupying: 0.9,
};

/** 64×64 canvas 画实心向下三角(尖端朝下指向猫),白色 —— 用 SpriteMaterial.color 调色。 */
function createArrowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas context unavailable');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(32, 54);   // 尖端
  ctx.lineTo(12, 22);
  ctx.lineTo(52, 22);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

export function createNpcMeshManager(scene: THREE.Scene, npcMeshes: THREE.Group[]): {
  arrows: THREE.Sprite[];
  update: (entities: NpcEntity[]) => void;
} {
  const arrows: THREE.Sprite[] = [];
  const texture = createArrowTexture();

  for (const mesh of npcMeshes) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: STATE_OPACITY.idle,
    }));
    sprite.scale.set(0.55, 0.55, 1);
    sprite.position.set(mesh.position.x, ARROW_Y, mesh.position.z);
    scene.add(sprite);
    arrows.push(sprite);
  }

  function update(entities: NpcEntity[]): void {
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const arrow = arrows[i];
      if (!arrow) continue;
      const mesh = npcMeshes[e.meshIndex];
      if (mesh) mesh.position.set(e.x, MESH_Y, e.z);
      arrow.position.set(e.x, ARROW_Y, e.z);
      const mat = arrow.material as THREE.SpriteMaterial;
      mat.color.setHex(STATE_COLOR[e.state]);
      mat.opacity = STATE_OPACITY[e.state];
    }
  }

  return { arrows, update };
}
