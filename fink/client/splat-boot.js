import { SplatScene } from './splat-scene.js';

const canvas = document.getElementById('splat-canvas');
if (canvas) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  const scene = new SplatScene(canvas);
  window.finkSplatScene = scene;
  scene.load('./splats/soar.ksplat')
    .then(() => scene.start())
    .catch(e => console.warn('[splat-scene] load failed:', e));
}
