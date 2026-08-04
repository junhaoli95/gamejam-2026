import type * as THREE from 'three';
import type { ThirdPersonController } from '../player/thirdPersonController';

export interface SharedState {
  player: { x: number; z: number; yaw: number };
  battery: number;
  pips: number;
  outlets: Array<{ x: number; z: number; occupied: boolean }>;
  npcs: Array<{ x: number; z: number; state: string }>;
  path?: Array<{ x: number; z: number }>;
}

export type AppAction =
  | { kind: 'query-outlets' }
  | { kind: 'toggle-map' }
  | { kind: 'close' };

export interface SharedStateFacade {
  getSharedState: () => SharedState;
}

export function createSharedStateFacade(
  player: THREE.Group,
  controller: ThirdPersonController,
  outlets: Array<{ x: number; z: number }>,
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
      outlets: outlets.map(o => ({ ...o, occupied: false })),
      npcs: [],
      path: undefined,
    }),
  };
}
