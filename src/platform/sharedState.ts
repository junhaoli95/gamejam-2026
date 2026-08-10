import type * as THREE from 'three';
import type { ThirdPersonController } from '../player/thirdPersonController';

export interface SharedState {
  player: { x: number; z: number; yaw: number };
  battery: number;
  pips: number;
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
  npcs: Array<{ x: number; z: number; state: 'idle' | 'moving' | 'occupying'; targetIndex?: number }>;
  path?: Array<{ x: number; z: number }>;
  won?: boolean;
  // PR #13 stub 字段(Snake prep,spec §2 / §8.1)——Sam/David 各 pull 后填充真实值
  /** 静态地形 AABB(书架+桌子+柱子),每局不变。Sam minimap 复用;David scene 注入。 */
  terrain?: Array<{ x: number; z: number; w: number; d: number; kind: 'shelf' | 'table' | 'column' }>;
  /** 近空桩标志(≤1.5m)。Sam gtaPrompt 据此显隐左上 prompt;David main.ts 每帧算距离注入。 */
  nearOutlet?: boolean;
  /** PR #16 A:上一局最终分数(0=未完成),供 highScore 比较 */
  lastScore?: number;
}

export type AppAction =
  | { kind: 'toggle-app'; app: 'map' | 'radar' | 'query' }
  | { kind: 'restart' }
  | { kind: 'close' };

export interface SharedStateFacade {
  getSharedState: () => SharedState;
}

export function createSharedStateFacade(
  player: THREE.Group,
  controller: ThirdPersonController,
  outlets: Array<{ x: number; z: number; occupied?: boolean }>,
): SharedStateFacade {
  return {
    getSharedState: () => ({
      player: {
        x: player.position.x,
        z: player.position.z,
        yaw: controller.getYaw(),
      },
      battery: 1.0,
      pips: 3,
      outlets: outlets.map(o => ({ x: o.x, z: o.z, occupied: o.occupied ?? false })),
      npcs: [],
      path: undefined,
      // PR #13 stub(Snake prep,spec §8.1)—— David main.ts wrap 会覆盖为真实值
      terrain: [],
      nearOutlet: false,
      // PR #16 stub(Snake prep,spec §1.2)—— 3 agent 各自填充
      lastScore: 0,
    }),
  };
}