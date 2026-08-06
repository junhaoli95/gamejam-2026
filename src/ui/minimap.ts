import { CONFIG } from '../game/config';
import type { SharedState } from '../platform/sharedState';

// GTA-style north-up minimap renderer.
//
// PR #9 (2026-08-04): public API rewritten — caller now owns the canvas DOM.
//   Old `createMinimap()` self-appended a fixed-position canvas to document.body
//   for Layer 1's standalone bottom-left debug minimap.  Per master spec
//   §3.9 / §10 decision 8, the standalone minimap is being deleted (handled in
//   main.ts) and the renderer is now consumed inside the phone HUD where the
//   chassis owns the canvas element.  Drawing logic upgraded to GTA style
//   (vignette + zone labels + N tag + triangle yaw arrow + blip color hook).
//
// File boundary: this file is in `src/ui/`.  The renderer reads only the
// SharedState interface from `src/platform/sharedState.ts` (defined by Layer 1,
// never mutated here).  No `three` dependency remains (old signature took
// THREE.Box3[] for terrain — that path was dropped per §16-S7 decision 9-9).
//
// Realtime constraint (master §10 decision 5): `update()` re-reads the caller's
// SharedState snapshot every call.  No caching, no startup snapshot, no static
// outlet reference.  FRAME_SKIP=2 throttles canvas redraws to ~30 fps (same as
// Layer 1) for perf; SharedState is still re-read every frame and the throttle
// is purely a redraw-rate tradeoff per spec §7.2.

const FRAME_SKIP = 2;

// Static zone label anchors in world coords (master §6.1):
//   west (x<-4) = bookshelves, east (x>0) = study tables, mid = corridor.
const ZONE_LABELS: Array<{ x: number; z: number; text: string }> = [
  { x: -8, z: -4, text: '书架区' },
  { x: 8, z: -4, text: '自习区' },
  { x: 0, z: 5, text: '走廊' },
];

export interface MinimapBlipInput {
  x: number;
  z: number;
  occupied: boolean;
}

export interface MinimapOptions {
  // Color of each outlet blip.  MAP defaults to all-green (#2dff7a, no
  // occupancy surfaced per master §3.6); QUERY passes a state-aware callback
  // (green/red/gold per master §3.8).
  blipColor?: (b: MinimapBlipInput) => string;
}

export interface MinimapHandle {
  update: (state: SharedState) => void;
  dispose: () => void;
}

export function createMinimap(
  canvas: HTMLCanvasElement,
  opts?: MinimapOptions,
): MinimapHandle {
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const blipColor = opts?.blipColor ?? (() => '#2dff7a');

  // World→screen transform with letterbox (§16-S5):
  //   scale = min(W/CONFIG.world.w, H/CONFIG.world.d)
  //   max world span in pixels = worldSpan*scale; center the leftover along
  //   the cross-axis.  Allows any-canvas aspect ratio reused by MAP & QUERY.
  const scale = Math.min(W / CONFIG.world.w, H / CONFIG.world.d);
  const worldWpx = CONFIG.world.w * scale;
  const worldHpx = CONFIG.world.d * scale;
  const offX = (W - worldWpx) / 2;
  const offY = (H - worldHpx) / 2;

  const toX = (wx: number) => (wx + CONFIG.world.w / 2) * scale + offX;
  const toY = (wz: number) => (wz + CONFIG.world.d / 2) * scale + offY;

  let frame = 0;

  function update(state: SharedState): void {
    if (++frame % FRAME_SKIP !== 0) return;

    // 1) Floor (GTA dark-cyan instead of Layer 1's tan) + clip to world rect.
    ctx.fillStyle = '#1c2329';
    ctx.fillRect(0, 0, W, H);

    // 2) Letterbox-free world rect floor (slightly lighter so the world map
    //    has clear visual bounds inside the vignette).
    ctx.fillStyle = '#222c33';
    ctx.fillRect(offX, offY, worldWpx, worldHpx);

    // 3) Vignette (radial, fades letterbox zones to black).
    const grd = ctx.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(worldWpx, worldHpx) * 0.42,
      W / 2,
      H / 2,
      Math.max(W, H) / 1.2,
    );
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    // 4) Zone labels (static world-space anchors).
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const z of ZONE_LABELS) {
      ctx.fillText(z.text, toX(z.x), toY(z.z));
    }

    // 5) Outlet blips (color from caller — green for MAP, state-colored for
    //    QUERY).  Soft glow + 3×3 square, same shape language as Layer 1.
    ctx.shadowBlur = 5;
    for (const o of state.outlets) {
      ctx.shadowColor = blipColor(o);
      ctx.fillStyle = blipColor(o);
      ctx.fillRect(toX(o.x) - 1.5, toY(o.z) - 1.5, 3, 3);
    }
    ctx.shadowBlur = 0;

    // 6) North indicator (fixed, top-center of canvas, screen-space).
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('N', W / 2, 4);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W / 2, 13);
    ctx.lineTo(W / 2, 22);
    ctx.stroke();

    // 7) Player triangle arrow rotated by yaw (north-up).
    //    Canvas Y axis points DOWN, so visually a `ctx.rotate(+θ)` produces a
    //    canvas-CW rotation (math CCW in standard y-up coords).  Layer 1's
    //    convention is `forward = (-sinY, -cosY)` in world xz; at yaw=π/2 the
    //    player runs toward world -x (screen left).  Matching that on canvas
    //    requires `ctx.rotate(-yaw)`: at yaw=π/2 the local up vector (0,-6)
    //    maps to (-6, 0) = screen left, the same direction as Layer 1's stroke.
    const px = toX(state.player.x);
    const py = toY(state.player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-state.player.yaw);
    ctx.fillStyle = '#ffb142';
    ctx.beginPath();
    ctx.moveTo(0, -6); // tip
    ctx.lineTo(-4, 4);
    ctx.lineTo(0, 2);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  }

  function dispose(): void {
    // Caller owns canvas DOM; nothing to remove here.  Kept for API symmetry
    // with the dropped Layer 1 signature and any future internal teardown
    // (event listeners, RAF hooks) — currently no-op.
  }

  return { update, dispose };
}