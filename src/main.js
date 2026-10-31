import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shader.js';
import { AIR, CORNER_PROFILE, MAX_FLOOR_RADIUS, screenClip } from './iphone-air.js';
import { loadSettings, saveSettings } from './settings.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const defaults = { opening: 50, depth: 20, radius: 20, azimuth: 0, elevation: 60, size: 18, brightness: 88, ambient: 11, specular: 20, roughness: 65, shadows: false, mainShadows: true, baseColor: '#5c5c5c' };
const sliderKeys = ['opening', 'depth', 'radius', 'azimuth', 'elevation', 'size', 'brightness', 'ambient', 'specular', 'roughness'];
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
  renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: false, powerPreference: 'high-performance' });
} catch {
  $('error').hidden = false;
  $('error').textContent = '描画を開始できませんでした。WebGL 2が利用できるSafariまたはChromeで開いてください。';
  throw new Error('WebGL 2 unavailable');
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
const uniforms = {
  resolution: { value: new THREE.Vector2() }, depth: { value: defaults.depth / 100 }, radius: { value: defaults.radius / 100 },
  lightPosition: { value: new THREE.Vector3() }, lightRadius: { value: .18 },
  shadows: { value: defaults.shadows }, baseColor: { value: new THREE.Color(defaults.baseColor) },
  opening: { value: defaults.opening / 100 }, mainShadows: { value: defaults.mainShadows },
  brightness: { value: defaults.brightness / 100 }, ambient: { value: defaults.ambient / 100 },
  specularStrength: { value: defaults.specular / 100 }, roughness: { value: defaults.roughness / 100 },
  cornerProfile: { value: CORNER_PROFILE.map(([value, slope]) => new THREE.Vector2(value, slope)) },
};
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

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
let dirty = true;
let frames = 0;
let lastTime = performance.now();
let fpsStart = lastTime;
let measuredFps = '—';

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
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') setPanel(false); });

function updateControls() {
  values.radius = Math.min(values.radius, values.depth, MAX_FLOOR_RADIUS);
  $('radius').max = Math.min(values.depth, MAX_FLOOR_RADIUS);
  for (const key of sliderKeys) {
    $(key).value = values[key];
    $(`${key}Value`).textContent = `${values[key]}${key === 'azimuth' || key === 'elevation' ? '°' : '%'}`;
  }
  for (const key of ['brightness', 'ambient', 'roughness']) uniforms[key].value = values[key] / 100;
  uniforms.specularStrength.value = values.specular / 100;
  uniforms.depth.value = values.depth / 100;
  uniforms.radius.value = values.radius / 100;
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
  const d = values.depth * 1.7;
  const r = values.radius * 1.7;
  $('profile').setAttribute('d', `M16 18 V${18+d-r} A${r} ${r} 0 0 0 ${16+r} ${18+d} H${284-r} A${r} ${r} 0 0 0 284 ${18+d-r} V18`);
  $('dimensions').textContent = `D ${values.depth}%  /  R ${values.radius}%`;
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
  if (!dirty) return;
  const az = THREE.MathUtils.degToRad(values.azimuth);
  const el = THREE.MathUtils.degToRad(values.elevation);
  baseLight.set(Math.sin(az)*Math.cos(el), Math.cos(az)*Math.cos(el), Math.sin(el)).multiplyScalar(2);
  targetLight.copy(baseLight);
  if (hasReading && motionCalibrated) targetLight.applyQuaternion(smoothed);
  uniforms.lightPosition.value.copy(targetLight);
  renderer.render(scene, camera);
  dirty = false;
});
initializeCalibration();
updateControls();
resize();
startTilt();
