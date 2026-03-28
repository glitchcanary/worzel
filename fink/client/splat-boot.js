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
    .then(() => {
      scene.start();
      // gaussian-splats-3d Viewer appends a full-screen position:absolute div to
      // document.body for its loading spinner — disable pointer events on it.
      document.querySelectorAll('body > div[style*="position: absolute"]').forEach(el => {
        el.style.pointerEvents = 'none';
      });
    })
    .catch(e => console.warn('[splat-scene] load failed:', e));
}
