import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Add HDR entries here; the picker and saved-value validation use this list.
// rotationY is the asset's default yaw in degrees, before the user's adjustment.
export const ENVIRONMENTS = [
  { id: 'lebombo', label: 'Lebombo（室内）', kind: 'hdr', url: './environment/lebombo_1k.hdr', rotationY: 0 },
  { id: 'river_alcove', label: 'River Alcove', kind: 'hdr', url: './environment/river_alcove_1k.hdr', rotationY: 0 },
  { id: 'je_gray_02', label: 'J&E Gray 02', kind: 'hdr', url: './environment/je_gray_02_1k.hdr', rotationY: 0 },
  { id: 'autumn_hill_view', label: 'Autumn Hill View', kind: 'hdr', url: './environment/autumn_hill_view_1k.hdr', rotationY: 0 },
  { id: 'front-camera', label: 'フロントカメラ（ライブ）', kind: 'camera', rotationY: 0 },
];

export function createEnvironmentController(renderer, uniforms, onState) {
  let source = ENVIRONMENTS[0], generation = 0, target = null;
  let stream = null, video = null, cameraTexture = null, pending = false;
  let cameraWidth = 0, cameraHeight = 0;
  const report = message => onState({ message, kind: source.kind, active: !!stream && !pending, pending });

  function release() {
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    if (video) { video.pause(); video.srcObject = null; video.remove(); video = null; }
    cameraTexture?.dispose(); cameraTexture = null;
    target?.dispose(); target = null;
    pending = false;
    uniforms.environmentMap.value = null;
    uniforms.cameraMap.value = null;
    uniforms.cameraMode.value = false;
    uniforms.environmentReady.value = false;
  }

  async function select(id) {
    const token = ++generation;
    release();
    source = ENVIRONMENTS.find(entry => entry.id === id) || ENVIRONMENTS[0];
    if (source.kind === 'camera') {
      report('「カメラを開始」でフロントカメラを許可してください。');
      return;
    }
    report(`${source.label}を読み込み中です。`);
    let image, pmrem;
    try {
      image = await new HDRLoader().loadAsync(source.url);
      if (token !== generation) return;
      image.mapping = THREE.EquirectangularReflectionMapping;
      pmrem = new THREE.PMREMGenerator(renderer);
      target = pmrem.fromEquirectangular(image);
      uniforms.environmentMap.value = target.texture;
      uniforms.environmentMaxLod.value = target.texture.mipmaps.length - 1;
      uniforms.environmentReady.value = true;
      report(`${source.label}を読み込みました。`);
    } catch {
      if (token === generation) report('環境画像を読み込めませんでした。選び直してください。');
    } finally {
      image?.dispose(); pmrem?.dispose();
    }
  }

  function updateCameraTexture() {
    if (!video?.videoWidth || !video.videoHeight) return false;
    if (!cameraTexture || video.videoWidth !== cameraWidth || video.videoHeight !== cameraHeight) {
      cameraTexture?.dispose();
      cameraTexture = new THREE.VideoTexture(video);
      cameraTexture.generateMipmaps = true;
      cameraTexture.minFilter = THREE.LinearMipmapLinearFilter;
      // Video is decoded from sRGB explicitly in the custom reflection shader.
      cameraTexture.colorSpace = THREE.NoColorSpace;
      cameraWidth = video.videoWidth; cameraHeight = video.videoHeight;
      uniforms.cameraMap.value = cameraTexture;
      uniforms.cameraAspect.value = cameraWidth / cameraHeight;
      uniforms.cameraMaxLod.value = Math.floor(Math.log2(Math.max(cameraWidth, cameraHeight)));
      uniforms.cameraMode.value = true;
      uniforms.environmentReady.value = true;
    }
    return true;
  }

  async function startCamera() {
    if (source.kind !== 'camera') return;
    const token = ++generation;
    release(); pending = true;
    report('カメラの利用許可を確認しています。');
    try {
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('unsupported');
      }
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      });
      if (token !== generation) { nextStream.getTracks().forEach(track => track.stop()); return; }
      stream = nextStream;
      video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.autoplay = true; video.hidden = true;
      document.body.append(video);
      video.srcObject = stream;
      await video.play();
      if (token !== generation) return;
      pending = false;
      updateCameraTexture();
      stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
        if (stream === nextStream) stopCamera();
      }));
      report('フロントカメラのライブ映像を使用しています。');
    } catch (error) {
      if (token !== generation) return;
      release();
      report(error.name === 'NotAllowedError'
        ? 'カメラが許可されていません。ブラウザのカメラ設定を確認し、開始し直してください。'
        : 'カメラを開始できませんでした。HTTPSで開き、カメラが使えるか確認してください。');
    }
  }

  function stopCamera() {
    if (source.kind !== 'camera') return;
    ++generation; release();
    report('カメラは停止しています。「カメラを開始」で再開できます。');
  }

  return {
    select, startCamera, stopCamera,
    get source() { return source; },
    get cameraRunning() { return !!stream && !pending; },
    get cameraPending() { return pending; },
    update() { return source.kind === 'camera' && !pending && video?.readyState >= 2 && updateCameraTexture(); },
    dispose() { ++generation; release(); },
  };
}
