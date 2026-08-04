import type { SharedState, AppAction } from '../platform/sharedState';

export interface PhoneHudOptions {
  getSharedState: () => SharedState;
  onAppAction: (action: AppAction) => void;
}

export function mountPhoneHud(_opts: PhoneHudOptions): void {
  console.log('[stub] mountPhoneHud called — PR #7 will implement');
}
