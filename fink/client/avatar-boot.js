import { AvatarScene } from './avatar.js';

const canvas = document.getElementById('avatar-canvas');
if (canvas) {
  const scene = new AvatarScene(canvas);
  window.finkAvatarScene = scene;
  scene.loadVRM('./avatars/animal.vrm')
    .then(() => scene.start())
    .catch(e => console.warn('[avatar] VRM load failed:', e));
}
