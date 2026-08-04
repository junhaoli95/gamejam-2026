import { CONFIG } from '../game/config';
import type { SharedState } from '../platform/sharedState';
import type * as THREE from 'three';

const MINI_W = 180;
const MINI_H = 136;
const SCALE = MINI_W / CONFIG.world.w;
const FRAME_SKIP = 2;

export interface MinimapHandle {
  canvas: HTMLCanvasElement;
  update: (colliders: THREE.Box3[], state: SharedState) => void;
  dispose: () => void;
}

export function createMinimap(): MinimapHandle {
  const canvas = document.createElement('canvas');
  canvas.width = MINI_W;
  canvas.height = MINI_H;
  Object.assign(canvas.style, {
    position: 'fixed',
    left: '12px',
    bottom: '12px',
    border: '1px solid rgba(0,0,0,0.3)',
    borderRadius: '4px',
    pointerEvents: 'none',
    zIndex: '5',
  });
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  let lastColliders: THREE.Box3[] = [];

  function update(colliders: THREE.Box3[], state: SharedState): void {
    frame++;
    if (frame % FRAME_SKIP !== 0) return;

    const toX = (wx: number) => (wx + CONFIG.world.w / 2) * SCALE;
    const toY = (wz: number) => (wz + CONFIG.world.d / 2) * SCALE;

    ctx.fillStyle = '#e8e4d8';
    ctx.fillRect(0, 0, MINI_W, MINI_H);

    if (colliders !== lastColliders) {
      lastColliders = colliders;
    }
    ctx.fillStyle = '#5a5a52';
    for (const b of lastColliders) {
      const x = toX(b.min.x);
      const y = toY(b.min.z);
      const w = (b.max.x - b.min.x) * SCALE;
      const h = (b.max.z - b.min.z) * SCALE;
      ctx.fillRect(x, y, Math.max(1, w), Math.max(1, h));
    }

    ctx.fillStyle = '#2dff7a';
    for (const o of state.outlets) {
      ctx.fillRect(toX(o.x) - 1.5, toY(o.z) - 1.5, 3, 3);
    }

    ctx.fillStyle = '#8a8a8a';
    for (const n of state.npcs) {
      ctx.beginPath();
      ctx.arc(toX(n.x), toY(n.z), 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.path && state.path.length > 1) {
      ctx.strokeStyle = '#ffe066';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(toX(state.path[0].x), toY(state.path[0].z));
      for (let i = 1; i < state.path.length; i++) {
        ctx.lineTo(toX(state.path[i].x), toY(state.path[i].z));
      }
      ctx.stroke();
    }

    const px = toX(state.player.x);
    const py = toY(state.player.z);
    ctx.fillStyle = '#e8913a';
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fill();
    const dx = -Math.sin(state.player.yaw) * 8;
    const dy = -Math.cos(state.player.yaw) * 8;
    ctx.strokeStyle = '#e8913a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + dx, py + dy);
    ctx.stroke();
  }

  function dispose(): void {
    canvas.remove();
  }

  return { canvas, update, dispose };
}
