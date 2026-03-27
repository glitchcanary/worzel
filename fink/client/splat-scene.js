/**
 * splat-scene.js — Gaussian Splat background scene renderer.
 *
 * Usage:
 *   const scene = new SplatScene(canvasElement);
 *   await scene.load('./splats/soar.ply');
 *   scene.start();
 */

import * as THREE from './vendor/three.module.js';
import { Viewer } from './vendor/gaussian-splats-3d.module.js';

export class SplatScene {
  #canvas;
  #viewer = null;

  constructor(canvas) {
    this.#canvas = canvas;
  }

  async load(url) {
    this.#viewer = new Viewer({
      canvas: this.#canvas,
      cameraUp: [0, 1, 0],
      initialCameraPosition: [0, 1, 6],
      initialCameraLookAt: [0, 1, 0],
      selfDrivenMode: false,
    });
    await this.#viewer.addSplatScene(url, {
      splatAlphaRemovalThreshold: 5,
    });
    console.log('[splat-scene] loaded', url);
  }

  start() {
    if (!this.#viewer) return;
    const tick = () => {
      requestAnimationFrame(tick);
      this.#viewer.update();
      this.#viewer.render();
    };
    tick();
  }

  stop() {
    this.#viewer?.dispose();
    this.#viewer = null;
  }
}
