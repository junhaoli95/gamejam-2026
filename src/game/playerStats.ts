import type { SharedState } from '../platform/sharedState';

export interface PlayerStatsOptions {
  getSharedState: () => SharedState;
}

export function mountPlayerStats(_opts: PlayerStatsOptions): void {
  console.log('[stub] mountPlayerStats called — PR #8 will implement');
}
