// PR #16 B:NPC 头顶箭头 Sprite + mesh 位置同步。
// 每只 npcMeshes[i] 对应一个箭头(实心向下三角,CanvasTexture 程序生成,零素材)。
// update():把 mesh 挪到 entity 位置(猫就是实体的可见化身)+ 箭头跟着头顶 1.2m,
// 颜色按 state:绿=idle(可用) / 橙=wander(闲逛) / 黄=moving(移动) / 红=occupying(已占桩)。
import * as THREE from 'three';
import type { NpcEntity } from '../game/npc';
import { catYawForDirection, updateCatAnimation } from './proceduralCat';

const MESH_Y = 0;             // 移动 NPC 使用站立猫,根节点落地
const ARROW_ABOVE_MESH = 1.85; // 站立猫耳朵上方
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
  update: (entities: NpcEntity[], dt: number) => void;
  reset: () => void;
} {
  const arrows: THREE.Sprite[] = [];
  const previousPositions = new Map<number, { x: number; z: number }>();
  const previousMeshes = new Map<number, THREE.Group>();
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

  function update(entities: NpcEntity[], dt: number): void {
    for (const arrow of arrows) arrow.visible = false;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      const arrow = arrows[i];
      if (!arrow) continue;
      arrow.visible = true;
      const previous = previousPositions.get(e.meshIndex);
      const dx = previous ? e.x - previous.x : 0;
      const dz = previous ? e.z - previous.z : 0;
      const distance = Math.hypot(dx, dz);
      const speed = dt > 0 && distance < 1 ? distance / dt : 0;
      const mesh = npcMeshes[e.meshIndex];
      const isNewMesh = mesh !== previousMeshes.get(e.meshIndex);
      const effectiveSpeed = isNewMesh ? 0 : speed;
      if (mesh) {
        mesh.position.set(e.x, MESH_Y, e.z);
        if (effectiveSpeed > 0.05) mesh.rotation.y = catYawForDirection(dx, dz);
        updateCatAnimation(mesh, {
          speed: e.state === 'moving' || e.state === 'wander' ? effectiveSpeed : 0,
          directionX: dx,
          directionZ: dz,
          isDashing: false,
          dt,
        });
      }
      previousPositions.set(e.meshIndex, { x: e.x, z: e.z });
      if (mesh) previousMeshes.set(e.meshIndex, mesh);
      arrow.position.set(e.x, ARROW_Y, e.z);
      const mat = arrow.material as THREE.SpriteMaterial;
      mat.color.setHex(STATE_COLOR[e.state]);
      mat.opacity = STATE_OPACITY[e.state];
    }
  }

  function reset(): void {
    previousPositions.clear();
    previousMeshes.clear();
  }

  return { arrows, update, reset };
}
