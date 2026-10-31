import * as THREE from 'three';

export const MATERIALS = [
  { id: 'solid', label: '単色' },
  { id: 'Metal061B', label: '金属（Metal061B）', metalness: true },
  { id: 'Fabric062', label: '布（Fabric062）', occlusion: true },
  { id: 'Plaster002', label: 'プラスター（Plaster002）' },
];

// Keep only the active set on the GPU. Browser caching handles repeat selections.
export function createMaterialController(renderer, uniforms, onState) {
  const pixel = (r, g, b) => {
    const texture = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  };
  const white = pixel(255, 255, 255), black = pixel(0, 0, 0), flat = pixel(128, 128, 255);
  const fallback = { materialColorMap: white, materialNormalMap: flat, materialRoughnessMap: white, materialMetalnessMap: black, materialOcclusionMap: white };
  const loader = new THREE.TextureLoader();
  let generation = 0, active = [];
  function release() {
    uniforms.materialReady.value = false;
    for (const [key, texture] of Object.entries(fallback)) uniforms[key].value = texture;
    active.forEach(texture => texture.dispose());
    active = [];
  }
  release();

  async function select(id) {
    const token = ++generation;
    release();
    const entry = MATERIALS.find(item => item.id === id) || MATERIALS[0];
    if (entry.id === 'solid') { onState('単色のベース色を使用します。'); return; }
    onState(`${entry.label}を読み込み中です。`);
    const maps = { materialColorMap: 'Color', materialNormalMap: 'NormalGL', materialRoughnessMap: 'Roughness' };
    if (entry.metalness) maps.materialMetalnessMap = 'Metalness';
    if (entry.occlusion) maps.materialOcclusionMap = 'AmbientOcclusion';
    const results = await Promise.allSettled(Object.entries(maps).map(async ([key, channel]) => {
      const texture = await loader.loadAsync(`./materials/${entry.id}/${entry.id}_1K-JPG_${channel}.jpg`);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      if (channel === 'Color') texture.colorSpace = THREE.SRGBColorSpace;
      return { key, texture };
    }));
    const loaded = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    if (token !== generation || results.some(result => result.status === 'rejected')) {
      loaded.forEach(({ texture }) => texture.dispose());
      if (token === generation) onState('素材を読み込めませんでした。単色で表示します。素材を選び直してください。');
      return;
    }
    for (const { key, texture } of loaded) uniforms[key].value = texture;
    active = loaded.map(({ texture }) => texture);
    uniforms.materialReady.value = true;
    onState(`${entry.label}を使用しています。`);
  }
  return { select, dispose() { ++generation; release(); white.dispose(); black.dispose(); flat.dispose(); } };
}
