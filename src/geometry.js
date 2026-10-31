import { BufferGeometry, Float32BufferAttribute } from 'three';
import { cornerCurve, screenOutline } from './iphone-air.js';

const PROFILE_SEGMENTS = 32;

// Quintic Bezier blend: tangent and curvature match both straight endpoints.
function blend(t) { return t * t * t * (4 + t * (-4.5 + 1.5 * t)); }
function blendSlope(t) { return t * t * (12 + t * (-18 + 7.5 * t)); }

function sectionRings(depth, radius, shape, horizontalScale = 1) {
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
      rings.push({ scale: 1, inset: radius * horizontalScale * blend(t), depth: depth - radius * blend(1 - t), side: blendSlope(1 - t), up: horizontalScale * blendSlope(t) });
    }
  }
  return rings;
}

export function cavitySection(depth, radius, shape, horizontalScale = 1) {
  const left = sectionRings(depth, radius, shape, horizontalScale).map(({ scale, inset, depth: z }) => [-0.5 * scale + inset, z]);
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

function connectRings(ring, count, indices) {
  if (ring === 0) return;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const a = (ring - 1) * count + i, aNext = (ring - 1) * count + next;
    const b = ring * count + i, bNext = ring * count + next;
    indices.push(a, b, aNext, aNext, b, bNext);
  }
}

function createBowlGeometry(width, height, depth) {
  const boundary = outline(width, height), points = [];
  const halfWidth = width / 2, halfHeight = height / 2;
  for (let i = 0; i < boundary.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    // Also sample the straight edges: large triangles amplify reflection bands.
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.025);
    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
      const r = Math.hypot(x / halfWidth, y / halfHeight);
      const ex = x / r, ey = y / r;
      const tx = -halfWidth * y / (halfHeight * r), ty = halfHeight * x / (halfWidth * r);
      const dr = -r * (nx * tx + ny * ty) / (nx * ex + ny * ey);
      points.push({ x, y, ex, ey, tx, ty, dx: dr * ex + (r - 1) * tx, dy: dr * ey + (r - 1) * ty });
    }
  }
  const positions = [], normals = [], indices = [];
  const rings = sectionRings(depth, 0, 'bowl');
  for (let ring = 0; ring < rings.length; ring++) {
    const { scale: q, depth: z, side, up } = rings[ring];
    const w = q ** 4;
    for (const { x, y, ex, ey, tx, ty, dx, dy } of points) {
      // Fade the rectangular boundary into an elliptical interior. High-order
      // boundary detail vanishes at the center instead of forming radial ridges.
      positions.push(q * (ex + w * (x - ex)), q * (ey + w * (y - ey)), -z);
      const px = tx + w * dx, py = ty + w * dy;
      const qx = ex + 5 * w * (x - ex), qy = ey + 5 * w * (y - ey);
      const nx = -side * py, ny = side * px, nz = up * (qx * py - qy * px);
      const length = Math.hypot(nx, ny, nz);
      normals.push(nx / length, ny / length, nz / length);
    }
    connectRings(ring, points.length, indices);
  }
  addCenter((rings.length - 1) * points.length, points.length, depth, positions, normals, indices);
  return geometry(positions, normals, indices);
}

export function createCavityGeometry(width, height, depth, radius, shape = 'plate', horizontalScale = 1) {
  if (shape === 'bowl') return createBowlGeometry(width, height, depth);
  const points = outline(width, height);
  const positions = [], normals = [], indices = [];
  const rings = sectionRings(depth, radius, shape, horizontalScale);
  for (let ring = 0; ring < rings.length; ring++) {
    const { scale, inset, depth: z, side, up } = rings[ring];
    for (let i = 0; i < points.length; i++) {
      const { x, y, nx, ny } = points[i];
      positions.push(x * scale - Math.sign(x) * inset, y * scale - Math.sign(y) * inset, -z);
      const length = Math.hypot(nx * side, ny * side, up);
      normals.push(nx * side / length, ny * side / length, up / length);
    }
    connectRings(ring, points.length, indices);
  }
  addFloor(points, radius * horizontalScale, depth, positions, normals, indices);
  return geometry(positions, normals, indices);
}

export function createMainLayerGeometry(width, height) {
  const positions = [], normals = [], indices = [];
  addFloor(outline(width, height), 0, 0, positions, normals, indices);
  return geometry(positions, normals, indices);
}
