import { BufferGeometry, Float32BufferAttribute } from 'three';
import { cornerCurve, screenOutline } from './iphone-air.js';

const ARC_SEGMENTS = 32;

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
  const center = positions.length / 3;
  positions.push(0, 0, -depth);
  normals.push(0, 0, 1);
  for (let i = 0; i < points.length; i++) {
    indices.push(center, start + (i + 1) % points.length, start + i);
  }
}

export function createCavityGeometry(width, height, depth, radius) {
  const points = outline(width, height);
  const positions = [], normals = [], indices = [];
  const rings = [{ inset: 0, depth: 0, side: 1, up: 0 }];
  if (depth > radius) rings.push({ inset: 0, depth: depth - radius, side: 1, up: 0 });
  if (radius > 0) {
    for (let i = 1; i <= ARC_SEGMENTS; i++) {
      const angle = i / ARC_SEGMENTS * Math.PI / 2;
      const side = i === ARC_SEGMENTS ? 0 : Math.cos(angle);
      const up = Math.sin(angle);
      rings.push({ inset: radius * (1 - side), depth: depth - radius + radius * up, side, up });
    }
  }
  for (let ring = 0; ring < rings.length; ring++) {
    const { inset, depth: z, side, up } = rings[ring];
    for (let i = 0; i < points.length; i++) {
      const { x, y, nx, ny } = points[i];
      positions.push(x - Math.sign(x) * inset, y - Math.sign(y) * inset, -z);
      const length = Math.hypot(nx * side, ny * side, up);
      normals.push(nx * side / length, ny * side / length, up / length);
      if (ring === 0) continue;
      const a = (ring - 1) * points.length + i;
      const next = (i + 1) % points.length;
      const aNext = (ring - 1) * points.length + next;
      const b = ring * points.length + i;
      const bNext = ring * points.length + next;
      indices.push(a, b, aNext, aNext, b, bNext);
    }
  }
  addFloor(points, radius, depth, positions, normals, indices);
  return geometry(positions, normals, indices);
}

export function createMainLayerGeometry(width, height) {
  const positions = [], normals = [], indices = [];
  addFloor(outline(width, height), 0, 0, positions, normals, indices);
  return geometry(positions, normals, indices);
}
