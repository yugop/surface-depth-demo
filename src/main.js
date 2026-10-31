import * as THREE from 'three';
import { ENVIRONMENTS, createEnvironmentController } from './environments.js';
import { MATERIALS, createMaterialController } from './materials.js';
import { vertexShader, fragmentShader } from './shader.js';
import { AIR, CORNER_PROFILE, MAX_FLOOR_RADIUS, screenClip } from './iphone-air.js';
import { loadSettings, saveSettings } from './settings.js';
import { cavitySection, createCavityGeometry, createMainLayerGeometry } from './geometry.js';
import './style.css';

const $ = (id) => document.getElementById(id);
for (const entry of ENVIRONMENTS) {
  const option = document.createElement('option');
  option.value = entry.id; option.textContent = entry.label;
  $('environmentSource').append(option);
}
for (const entry of MATERIALS) {
  const option = document.createElement('option');
  option.value = entry.id; option.textContent = entry.label;
  $('surfaceMaterial').append(option);
}
const defaults = { shape: 'bowl', opening: 50, depth: 20, radius: 20, plateHorizontalScale: 1, projection: 'perspective', fov: 82, azimuth: 0, elevation: 60, size: 18, brightness: 88, ambient: 11, specular: 20, environment: 100, environmentSource: ENVIRONMENTS[0].id, environmentYaw: 0, roughness: 65, surfaceMaterial: 'solid', materialScale: 1, shadows: false, mainShadows: true, baseColor: '#5c5c5c' };
const sliderKeys = ['opening', 'depth', 'radius', 'plateHorizontalScale', 'fov', 'azimuth', 'elevation', 'size', 'brightness', 'ambient', 'specular', 'environment', 'environmentYaw', 'roughness', 'materialScale'];
const ranges = Object.fromEntries(sliderKeys.map((key) => [key, {
  min: Number($(key).min), max: key === 'radius' ? MAX_FLOOR_RADIUS : Number($(key).max), step: Number($(key).step),
}]));
const values = loadSettings(defaults, ranges);
const stage = $('stage');
document.documentElement.style.setProperty('--screen-aspect', AIR.width / AIR.height);
const standaloneMode = matchMedia('(display-mode: standalone)');
const isStandalone = () => standaloneMode.matches || navigator.standalone === true;
const status = (text) => { $('status').textContent = text; $('hint').textContent = text; };
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true, powerPreference: 'high-performance' });
} catch {
  $('error').hidden = false;
  $('error').textContent = '描画を開始できませんでした。WebGL 2が利用できるSafariまたはChromeで開いてください。';
  throw new Error('WebGL 2 unavailable');
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
const uniforms = {
  resolution: { value: new THREE.Vector2() }, depth: { value: defaults.depth / 100 },
  lightPosition: { value: new THREE.Vector3() }, lightRadius: { value: .18 },
  shadows: { value: defaults.shadows }, baseColor: { value: new THREE.Color(defaults.baseColor) },
  opening: { value: defaults.opening / 100 }, mainShadows: { value: defaults.mainShadows },
  brightness: { value: defaults.brightness / 100 }, ambient: { value: defaults.ambient / 100 },
  specularStrength: { value: defaults.specular / 100 }, roughness: { value: defaults.roughness / 100 },
  environmentMap: { value: null }, environmentReady: { value: false },
  environmentStrength: { value: defaults.environment / 100 }, environmentMaxLod: { value: 0 },
  environmentRotation: { value: new THREE.Matrix3() },
  cameraMap: { value: null }, cameraMode: { value: false },
  cameraAspect: { value: 1 }, cameraMaxLod: { value: 0 },
  materialReady: { value: false }, materialScale: { value: 1 },
  orthographicView: { value: false },
  materialColorMap: { value: null }, materialNormalMap: { value: null },
  materialRoughnessMap: { value: null }, materialMetalnessMap: { value: null }, materialOcclusionMap: { value: null },
  cornerProfile: { value: CORNER_PROFILE.map(([value, slope]) => new THREE.Vector2(value, slope)) },
};
const scene = new THREE.Scene();
const perspectiveCamera = new THREE.PerspectiveCamera(values.fov, 1, 0.01, 10);
const orthographicCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.01, 2);
orthographicCamera.position.z = 1;
let camera = perspectiveCamera;
const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
const cavity = new THREE.Mesh(new THREE.BufferGeometry(), material);
cavity.name = 'AILayer';
const mainLayer = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
mainLayer.name = 'MainLayer';
scene.add(cavity, mainLayer);
let geometryState;

function updateCamera() {
  const { x, y } = uniforms.resolution.value;
  if (!x || !y) return;
  const halfWidth = x / Math.min(x, y) * 0.5, halfHeight = y / Math.min(x, y) * 0.5;
  camera = values.projection === 'orthographic' ? orthographicCamera : perspectiveCamera;
  uniforms.orthographicView.value = camera.isOrthographicCamera === true;
  if (camera.isOrthographicCamera) {
    camera.left = -halfWidth; camera.right = halfWidth;
    camera.top = halfHeight; camera.bottom = -halfHeight;
  } else {
    camera.aspect = x / y;
    camera.fov = values.fov;
    // Keep the aperture at z=0 fitted while changing perspective strength.
    camera.position.z = halfHeight / Math.tan(THREE.MathUtils.degToRad(values.fov) / 2);
    camera.far = camera.position.z + 1;
  }
  camera.updateProjectionMatrix();
}

function updateGeometry() {
  const { x, y } = uniforms.resolution.value;
  if (!x || !y) return;
  const width = x / Math.min(x, y), height = y / Math.min(x, y);
  const sizeChanged = !geometryState || width !== geometryState.width || height !== geometryState.height;
  if (sizeChanged || values.shape !== geometryState.shape || values.depth !== geometryState.depth || values.radius !== geometryState.radius || values.plateHorizontalScale !== geometryState.plateHorizontalScale) {
    cavity.geometry.dispose();
    cavity.geometry = createCavityGeometry(width, height, values.depth / 100, values.radius / 100, values.shape, values.plateHorizontalScale);
  }
  if (sizeChanged) {
    mainLayer.geometry.dispose();
    mainLayer.geometry = createMainLayerGeometry(width, height);
  }
  mainLayer.position.y = values.opening / 100 * height;
  mainLayer.visible = values.opening < 100;
  geometryState = { width, height, depth: values.depth, radius: values.radius, shape: values.shape, plateHorizontalScale: values.plateHorizontalScale };
}

let motionCalibrated = false;
let permissionGranted = typeof window.DeviceOrientationEvent?.requestPermission !== 'function';
let permissionPending = false;
let hasReading = false;
let pendingCalibration = true;
const orientation = new THREE.Quaternion();
const baseline = new THREE.Quaternion();
const relative = new THREE.Quaternion();
const smoothed = new THREE.Quaternion();
const euler = new THREE.Euler();
const screenRotation = new THREE.Quaternion();
const zAxis = new THREE.Vector3(0, 0, 1);
const baseLight = new THREE.Vector3();
const targetLight = new THREE.Vector3();
const environmentTransform = new THREE.Matrix4();
const environmentYawTransform = new THREE.Matrix4();
const inverseEnvironmentRotation = new THREE.Matrix3();
let dirty = true;
let frames = 0;
let lastTime = performance.now();
let fpsStart = lastTime;
let measuredFps = '—';

const materialController = createMaterialController(renderer, uniforms, message => {
  $('materialState').textContent = message;
  dirty = true;
});
const environmentController = createEnvironmentController(renderer, uniforms, state => {
  $('environmentState').textContent = state.message;
  $('frontCamera').hidden = state.kind !== 'camera';
  $('frontCamera').textContent = state.pending ? '開始をキャンセル' : state.active ? 'カメラを停止' : 'カメラを開始';
  dirty = true;
});
document.addEventListener('visibilitychange', () => { if (document.hidden) environmentController.stopCamera(); });
window.addEventListener('pagehide', () => environmentController.stopCamera());

function diagnostics() {
  const box = stage.getBoundingClientRect();
  const standalone = isStandalone();
  $('diagnostics').textContent = `${Math.round(box.width)} × ${Math.round(box.height)} CSS px / DPR ${devicePixelRatio} / 描画 ${uniforms.resolution.value.x} × ${uniforms.resolution.value.y} / iPhone Air基準 ${AIR.width} × ${AIR.height} / ${standalone ? 'ホーム画面' : 'ブラウザ（画面全体の確認はホーム画面から起動）'} / 端末 ${screen.width} × ${screen.height} / viewport ${innerWidth} × ${innerHeight} / 更新 ${measuredFps} fps`;
}
function resize() {
  // iOS standalone can report dvh shorter than the physical screen. For this
  // portrait Air demo, derive the full height from width and the panel aspect.
  document.documentElement.classList.toggle('air-standalone',
    isStandalone() && matchMedia('(max-width: 699px) and (orientation: portrait)').matches);
  const box = stage.getBoundingClientRect();
  // Native iPhone Air rendering: 420 × 912 CSS px at DPR 3 -> 1260 × 2736 pixels.
  renderer.setPixelRatio(Math.min(devicePixelRatio, AIR.scale));
  renderer.setSize(box.width, box.height, false);
  stage.style.clipPath = screenClip(box.width, box.height);
  renderer.getDrawingBufferSize(uniforms.resolution.value);
  updateCamera();
  updateGeometry();
  diagnostics();
  dirty = true;
}
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);
window.addEventListener('pageshow', resize);
standaloneMode.addEventListener('change', resize);

function setPanel(open) {
  $('panel').hidden = !open;
  $('settings').hidden = open;
  $('settings').setAttribute('aria-expanded', String(open));
  (open ? $('close') : $('settings')).focus();
  updateMotionUI();
  if (open) diagnostics();
}
$('settings').onclick = () => setPanel(true);
$('close').onclick = () => setPanel(false);
document.addEventListener('click', (event) => {
  if ($('panel').hidden || $('panel').contains(event.target)) return;
  setPanel(false);
  // Dismiss the panel without also recalibrating the scene behind it.
  event.stopPropagation();
}, true);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') setPanel(false); });

function updateControls() {
  values.radius = Math.min(values.radius, values.depth, MAX_FLOOR_RADIUS);
  $('radius').max = Math.min(values.depth, MAX_FLOOR_RADIUS);
  $('radius').disabled = values.shape === 'bowl';
  const scaleStep = Number($('plateHorizontalScale').step);
  const maxScale = values.radius > 0 ? Math.min(5, Math.floor(MAX_FLOOR_RADIUS / values.radius / scaleStep) * scaleStep) : 5;
  $('plateHorizontalScale').max = Number(maxScale.toFixed(2));
  values.plateHorizontalScale = Number(Math.min(values.plateHorizontalScale, maxScale).toFixed(2));
  $('plateHorizontalScale').disabled = values.shape !== 'plate' || values.radius === 0;
  $('shape').value = values.shape;
  $('projection').value = values.projection;
  $('fov').disabled = values.projection === 'orthographic';
  $('surfaceMaterial').value = values.surfaceMaterial;
  $('materialScale').disabled = values.surfaceMaterial === 'solid';
  $('baseColor').disabled = values.surfaceMaterial !== 'solid';
  $('environmentSource').value = values.environmentSource;
  for (const key of sliderKeys) {
    $(key).value = values[key];
    $(`${key}Value`).textContent = ['plateHorizontalScale', 'materialScale'].includes(key) ? `${values[key].toFixed(2)}×` : `${values[key]}${['fov', 'azimuth', 'elevation', 'environmentYaw'].includes(key) ? '°' : '%'}`;
  }
  for (const key of ['brightness', 'ambient', 'roughness']) uniforms[key].value = values[key] / 100;
  uniforms.specularStrength.value = values.specular / 100;
  uniforms.materialScale.value = values.materialScale;
  uniforms.environmentStrength.value = values.environment / 100;
  uniforms.depth.value = values.depth / 100;
  uniforms.lightRadius.value = values.size / 100;
  $('shadows').checked = values.shadows;
  $('mainShadows').checked = values.mainShadows;
  uniforms.opening.value = values.opening / 100;
  uniforms.mainShadows.value = values.mainShadows;
  $('baseColor').value = values.baseColor;
  $('baseColorValue').textContent = values.baseColor.toUpperCase();
  $('size').disabled = !(values.shadows || (values.mainShadows && values.opening > 0 && values.opening < 100));
  uniforms.shadows.value = values.shadows;
  uniforms.baseColor.value.set(values.baseColor);
  const section = cavitySection(values.depth / 100, values.radius / 100, values.shape, values.plateHorizontalScale);
  $('profile').setAttribute('d', section.map(([x, z], i) => `${i ? 'L' : 'M'}${150 + x * 268} ${18 + z * 170}`).join(' '));
  $('dimensions').textContent = values.shape === 'plate' ? `皿 / D ${values.depth}% / R ${values.radius}% / 横 ${values.plateHorizontalScale.toFixed(2)}×` : `お椀 / D ${values.depth}%`;
  updateCamera();
  updateGeometry();
  dirty = true;
}
function saveControls(replace = false) {
  updateControls();
  $('saveState').textContent = saveSettings(values, replace)
    ? '設定はこの端末に自動保存されます。'
    : 'この環境では設定を保存できません。';
}
function updateMotionUI() {
  $('calibrate').disabled = permissionPending;
  $('hint').hidden = motionCalibrated || !$('panel').hidden;
}
function initializeCalibration() {
  motionCalibrated = false;
  pendingCalibration = true;
  if (permissionGranted && hasReading) calibrate();
  else status('傾きセンサーに接続しています。');
  updateMotionUI();
  dirty = true;
}
for (const key of sliderKeys) {
  $(key).addEventListener('input', () => {
    values[key] = Number($(key).value);
    saveControls();
  });
}
$('shape').addEventListener('change', () => {
  values.shape = $('shape').value;
  saveControls();
});
$('environmentSource').addEventListener('change', () => {
  values.environmentSource = $('environmentSource').value;
  saveControls();
  environmentController.select(values.environmentSource);
});
$('projection').addEventListener('change', () => {
  values.projection = $('projection').value;
  saveControls();
});
$('surfaceMaterial').addEventListener('change', () => {
  values.surfaceMaterial = $('surfaceMaterial').value;
  saveControls();
  materialController.select(values.surfaceMaterial);
});
$('frontCamera').onclick = () => {
  if (environmentController.cameraRunning || environmentController.cameraPending) environmentController.stopCamera();
  else environmentController.startCamera();
};
$('shadows').addEventListener('change', () => {
  values.shadows = $('shadows').checked;
  saveControls();
});
$('mainShadows').addEventListener('change', () => {
  values.mainShadows = $('mainShadows').checked;
  saveControls();
});
$('baseColor').addEventListener('input', () => {
  values.baseColor = $('baseColor').value;
  saveControls();
});
window.addEventListener('deviceorientation', (event) => {
  if (event.beta == null || event.gamma == null) return;
  const rad = THREE.MathUtils.degToRad;
  euler.set(rad(event.beta), rad(event.alpha ?? 0), -rad(event.gamma), 'YXZ');
  orientation.setFromEuler(euler);
  screenRotation.setFromAxisAngle(zAxis, -rad(screen.orientation?.angle ?? window.orientation ?? 0));
  orientation.multiply(screenRotation);
  hasReading = true;
  permissionGranted = true;
  if (pendingCalibration && permissionGranted) calibrate();
  dirty = true;
});
function calibrate() {
  baseline.copy(orientation);
  relative.identity();
  smoothed.identity();
  motionCalibrated = true;
  pendingCalibration = false;
  status('この姿勢を基準にしました。タップ・ドラッグで基準を取り直せます。');
  updateMotionUI();
  dirty = true;
}
// Call directly from a click so Safari retains the user activation for permission.
async function useTiltAtTap() {
  if (permissionPending) return;
  if (!window.isSecureContext) { status('傾き操作はHTTPSで開いてください。'); return; }
  if (!window.DeviceOrientationEvent) { status('この環境では傾きを取得できません。設定で光源を調整できます。'); return; }
  if (permissionGranted) {
    if (hasReading) calibrate();
    else { pendingCalibration = true; status('傾きデータを待っています。最初に届いた姿勢を基準にします。'); }
    return;
  }
  permissionPending = true;
  updateMotionUI();
  try {
    const result = await DeviceOrientationEvent.requestPermission();
    permissionGranted = result === 'granted';
    if (!permissionGranted) {
      pendingCalibration = false;
      status('傾きが許可されていません。画面タップで再試行するか、設定で光源を調整してください。');
    } else if (hasReading) calibrate();
    else { pendingCalibration = true; status('許可しました。最初に届く姿勢を基準にします。'); }
  } catch {
    status('傾きを有効にできませんでした。画面をタップして再試行してください。');
  } finally {
    permissionPending = false;
    updateMotionUI();
  }
}
// A previously granted permission can be resolved without a new user gesture.
// If Safari requires user activation, the existing tap handler completes the request.
async function startTilt() {
  if (!window.isSecureContext) { status('傾き操作はHTTPSで開いてください。'); return; }
  if (!window.DeviceOrientationEvent) { status('この環境では傾きを取得できません。設定で光源を調整できます。'); return; }
  if (permissionGranted) return;
  try {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result === 'granted') {
      permissionGranted = true;
      if (hasReading && !motionCalibrated) calibrate();
      else if (!motionCalibrated) status('許可しました。最初に届く姿勢を基準にします。');
    } else if (!permissionGranted && !motionCalibrated) {
      status('傾きを使うには利用許可が必要です。画面をタップしてください。');
    }
  } catch {
    if (!permissionGranted && !motionCalibrated && !permissionPending) {
      status('傾きの利用許可を確認します。画面をタップしてください。');
    }
  }
}
$('calibrate').onclick = useTiltAtTap;
$('reset').onclick = () => {
  Object.assign(values, defaults);
  initializeCalibration();
  saveControls(true);
  materialController.select(values.surfaceMaterial);
  environmentController.select(values.environmentSource);
};
let drag;
let dragged = false;
stage.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary) return;
  dragged = false;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) >= 8) dragged = true;
});
// A completed drag establishes a new neutral pose; it never changes light angles.
stage.addEventListener('pointerup', (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  if (dragged) useTiltAtTap();
  drag = null;
});
stage.addEventListener('click', () => { if (!dragged) useTiltAtTap(); });
stage.addEventListener('pointercancel', () => { dragged = true; drag = null; });
stage.addEventListener('lostpointercapture', () => { drag = null; });

renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - lastTime) / 1000, .1);
  lastTime = time;
  frames++;
  if (time - fpsStart > 1500) {
    measuredFps = Math.round(frames * 1000 / (time - fpsStart));
    frames = 0;
    fpsStart = time;
    if (!$('panel').hidden) diagnostics();
  }
  if (hasReading && motionCalibrated) {
    // Q_current^-1 Q_baseline maps the fixed world light into the current phone frame.
    relative.copy(orientation).invert().multiply(baseline);
    smoothed.slerp(relative, 1 - Math.exp(-dt * 12));
    dirty = true;
  }
  if (environmentController.update()) dirty = true;
  if (!dirty) return;
  const az = THREE.MathUtils.degToRad(values.azimuth);
  const el = THREE.MathUtils.degToRad(values.elevation);
  baseLight.set(Math.sin(az)*Math.cos(el), Math.cos(az)*Math.cos(el), Math.sin(el)).multiplyScalar(2);
  targetLight.copy(baseLight);
  if (hasReading && motionCalibrated) targetLight.applyQuaternion(smoothed);
  uniforms.lightPosition.value.copy(targetLight);
  const yaw = values.environmentYaw + environmentController.source.rotationY;
  environmentYawTransform.makeRotationY(THREE.MathUtils.degToRad(yaw));
  uniforms.environmentRotation.value.setFromMatrix4(environmentYawTransform);
  // A camera feed already follows the phone; only static HDRs need inverse tilt.
  if (environmentController.source.kind === 'hdr') {
    environmentTransform.makeRotationFromQuaternion(smoothed);
    inverseEnvironmentRotation.setFromMatrix4(environmentTransform).transpose();
    uniforms.environmentRotation.value.multiply(inverseEnvironmentRotation);
  }
  renderer.render(scene, camera);
  dirty = false;
});
initializeCalibration();
updateControls();
resize();
startTilt();
environmentController.select(values.environmentSource);
materialController.select(values.surfaceMaterial);
