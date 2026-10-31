import { BufferGeometry, Float32BufferAttribute } from 'three';
import { cornerCurve, screenOutline } from './iphone-air.js';

const PROFILE_SEGMENTS = 32;

// Quintic Bezier blend: tangent and curvature match both straight endpoints.
function blend(t) { return t * t * t * (4 + t * (-4.5 + 1.5 * t)); }
function blendSlope(t) { return t * t * (12 + t * (-18 + 7.5 * t)); }

function sectionRings(depth, radius, shape) {
  if (shape === 'bowl') {
    return Array.from({ length: PROFILE_SEGMENTS }, (_, i) => {
      const angle = i / PROFILE_SEGMENTS * Math.PI / 2;
      const scale = Math.cos(angle), up = Math.sin(angle);
      return { scale, inset: 0, depth: depth * up, side: depth * scale, up };
    });
  }
  const rings = [{ scale: 1, inset: 0, depth: 0, side: 1, up: 0 }];
  if (depth > radius) rings.push({ scale: 1, inset: 0, depth: depth - radius, side: 1, up: 0 });
  if (radius > 0) {
    for (let i = 1; i <= PROFILE_SEGMENTS; i++) {
      const t = i / PROFILE_SEGMENTS;
      rings.push({ scale: 1, inset: radius * blend(t), depth: depth - radius * blend(1 - t), side: blendSlope(1 - t), up: blendSlope(t) });
    }
  }
  return rings;
}

export function cavitySection(depth, radius, shape) {
  const left = sectionRings(depth, radius, shape).map(({ scale, inset, depth: z }) => [-0.5 * scale + inset, z]);
  return [...left, [0, depth], ...[...left].reverse().map(([x, z]) => [-x, z])];
}

function outline(width, height) {
  return screenOutline(width, height).map(([px, py]) => {
    const x = px - width / 2;
    const y = height / 2 - py;
    const [, slope] = cornerCurve((width - height) / 2 - Math.abs(x) + Math.abs(y));
    return { x, y, nx: (-0.5 + slope) * Math.sign(x), ny: (-0.5 - slope) * Math.sign(y) };
  });
}

function geometry(positions, normals, indices) {
  const result = new BufferGeometry();
  result.setAttribute('position', new Float32BufferAttribute(positions, 3));
  result.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  result.setIndex(indices);
  result.computeBoundingSphere();
  return result;
}

function addFloor(points, inset, depth, positions, normals, indices) {
  // Separate floor normals keep the R=0 wall/floor corner sharp.
  const start = positions.length / 3;
  for (const { x, y } of points) {
    positions.push(x - Math.sign(x) * inset, y - Math.sign(y) * inset, -depth);
    normals.push(0, 0, 1);
  }
  addCenter(start, points.length, depth, positions, normals, indices);
}

function addCenter(start, count, depth, positions, normals, indices) {
  const center = positions.length / 3;
  positions.push(0, 0, -depth);
  normals.push(0, 0, 1);
  for (let i = 0; i < count; i++) {
    indices.push(center, start + (i + 1) % count, start + i);
  }
}

export function createCavityGeometry(width, height, depth, radius, shape = 'plate') {
  const points = outline(width, height);
  const positions = [], normals = [], indices = [];
  const rings = sectionRings(depth, radius, shape);
  for (let ring = 0; ring < rings.length; ring++) {
    const { scale, inset, depth: z, side, up } = rings[ring];
    for (let i = 0; i < points.length; i++) {
      const { x, y, nx, ny } = points[i];
      positions.push(x * scale - Math.sign(x) * inset, y * scale - Math.sign(y) * inset, -z);
      // The bowl uses homothetic aperture rings; include their local support
      // distance so the normals follow the actual surface, including corners.
      const nz = up * (shape === 'bowl' ? -(nx * x + ny * y) : 1);
      const length = Math.hypot(nx * side, ny * side, nz);
      normals.push(nx * side / length, ny * side / length, nz / length);
      if (ring === 0) continue;
      const a = (ring - 1) * points.length + i;
      const next = (i + 1) % points.length;
      const aNext = (ring - 1) * points.length + next;
      const b = ring * points.length + i;
      const bNext = ring * points.length + next;
      indices.push(a, b, aNext, aNext, b, bNext);
    }
  }
  if (shape === 'bowl') addCenter((rings.length - 1) * points.length, points.length, depth, positions, normals, indices);
  else addFloor(points, radius, depth, positions, normals, indices);
  return geometry(positions, normals, indices);
}

export function createMainLayerGeometry(width, height) {
  const positions = [], normals = [], indices = [];
  addFloor(outline(width, height), 0, 0, positions, normals, indices);
  return geometry(positions, normals, indices);
}
