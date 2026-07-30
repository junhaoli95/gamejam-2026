import * as THREE from 'three';

/**
 * A GameScene is the unit of "screen" in the game:
 * e.g. MenuScene, PlayScene, GameOverScene.
 * Each owns a THREE.Scene plus its own update loop.
 */
export interface GameScene {
  readonly scene: THREE.Scene;
  update(dt: number): void;
  /** Called when this scene becomes active. */
  enter?(): void;
  /** Called when switching away. Dispose per-scene resources here. */
  exit?(): void;
}

/**
 * Minimal scene switcher. The main loop only ever updates/renders
 * the active scene — keeps state transitions explicit instead of
 * scattering `if (gameState === ...)` across the codebase.
 *
 * Usage:
 *   const switcher = new SceneSwitcher(new MenuScene());
 *   // in animate loop:
 *   switcher.update(dt);
 *   renderer.render(switcher.activeScene.scene, camera);
 *   // later:
 *   switcher.switchTo(new PlayScene());
 */
export class SceneSwitcher {
  private current: GameScene;

  constructor(initial: GameScene) {
    this.current = initial;
    this.current.enter?.();
  }

  get activeScene(): GameScene {
    return this.current;
  }

  switchTo(next: GameScene): void {
    this.current.exit?.();
    this.current = next;
    this.current.enter?.();
  }

  update(dt: number): void {
    this.current.update(dt);
  }
}
