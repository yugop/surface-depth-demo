// iPhone Air display active-area outline, Apple dimensional drawing (2025-09-09), sheet 1.
// https://developer.apple.com/download/files/accessories/dimensional-drawings/iphone-air.pdf
// Bottom-left outline, normalized to active width 69.55 mm; mirrored about its diagonal.
// Each sample is [half-sum of edge insets, derivative] at uniform inset-difference steps.
// Convex-envelope samples smoothed by a cubic B-spline; Hermite interpolation preserves normals. This is drawing precision,
// not a claim of subpixel measurement of an individual physical panel.
export const AIR = { width: 1260, height: 2736, scale: 3 };
export const CORNER_EXTENT = 0.2414042497;
export const CORNER_PROFILE = [
  [0.043552312891, 0.000000000000],
  [0.043577332753, 0.011199091221],
  [0.043633756121, 0.019979213967],
  [0.043731221885, 0.031279219320],
  [0.043865939707, 0.039570287323],
  [0.044035554170, 0.052489217868],
  [0.044257797706, 0.062135688687],
  [0.044502906497, 0.070675016523],
  [0.044795791064, 0.083055323289],
  [0.045123403815, 0.090613995715],
  [0.045485773159, 0.103263466998],
  [0.045897737001, 0.112195244785],
  [0.046335819892, 0.124037159228],
  [0.046834776527, 0.136927128924],
  [0.047360181887, 0.142976946081],
  [0.047921140754, 0.155200959795],
  [0.048531756833, 0.168027125905],
  [0.049186473663, 0.179068505809],
  [0.049883431750, 0.190748624887],
  [0.050637655272, 0.212129056961],
  [0.051477213326, 0.228343580684],
  [0.052341219545, 0.229420325807],
  [0.053206579570, 0.229420325807],
  [0.054087941975, 0.242147760606],
  [0.055050148401, 0.268264457889],
  [0.056095695226, 0.281653720374],
  [0.057158076554, 0.281653720374],
  [0.058226356395, 0.286345080504],
  [0.059336529698, 0.305590814970],
  [0.060528719039, 0.322467491291],
  [0.061763281231, 0.334647305826],
  [0.063052554888, 0.346267032421],
  [0.064374613188, 0.357198025641],
  [0.065750307310, 0.370588531962],
  [0.067167428554, 0.381703483421],
  [0.068630417281, 0.393282620929],
  [0.070135840544, 0.406081811362],
  [0.071691545749, 0.417047628848],
  [0.073274448324, 0.422008060606],
  [0.074880277856, 0.431066717954],
  [0.076530660018, 0.443541303100],
  [0.078220601614, 0.451482532662],
  [0.079930868879, 0.454872430312],
  [0.081657413911, 0.462484021403],
  [0.083420260796, 0.470466770595],
  [0.085203331279, 0.475881496107],
  [0.087010154061, 0.481215915643],
  [0.088831412987, 0.484836552426],
  [0.090667830506, 0.488557653536],
  [0.092515229204, 0.490842785952],
  [0.094370762593, 0.493184893615],
  [0.096235060515, 0.494972067324],
  [0.098104128436, 0.496245906305],
  [0.099978594015, 0.497450185904],
  [0.101856305866, 0.498234146477],
  [0.103737152435, 0.498969122583],
  [0.105620024288, 0.499349247067],
  [0.107504022710, 0.499600587601],
  [0.109388799463, 0.499730155949],
  [0.111273778735, 0.499740657483],
  [0.113158846052, 0.499800181853],
  [0.115044300928, 0.499929853111],
  [0.116930183432, 0.500000000000],
  [0.118816154133, 0.500000000000],
  [0.120702124833, 0.500000000000]
];
export const MAX_FLOOR_RADIUS = Math.floor((0.5 - CORNER_EXTENT) * 400) / 4;

export function cornerCurve(delta) {
  if (Math.abs(delta) >= CORNER_EXTENT) return [Math.abs(delta) / 2, Math.sign(delta) / 2];
  const segments = CORNER_PROFILE.length - 1;
  const step = CORNER_EXTENT / segments;
  const position = Math.abs(delta) / step;
  const i = Math.min(Math.floor(position), segments - 1);
  const t = position - i;
  const [a, da] = CORNER_PROFILE[i];
  const [b, db] = CORNER_PROFILE[i + 1];
  const c = step * da;
  const e = 3 * (b - a) - step * (2 * da + db);
  const f = 2 * (a - b) + step * (da + db);
  return [a + t * (c + t * (e + t * f)),
    Math.sign(delta) * (c + t * (2 * e + 3 * t * f)) / step];
}

// Clockwise outline in screen coordinates, shared by meshes and the CSS mask.
export function screenOutline(width, height) {
  const short = Math.min(width, height);
  const corner = [];
  const segments = (CORNER_PROFILE.length - 1) * 2;
  for (let i = 0; i <= segments; i++) {
    const delta = CORNER_EXTENT * (2 * i / segments - 1);
    const [mean] = cornerCurve(delta);
    corner.push([(mean + delta / 2) * short, (mean - delta / 2) * short]);
  }
  const reversed = [...corner].reverse();
  return [
    ...corner,
    ...reversed.map(([x, y]) => [width - x, y]),
    ...corner.map(([x, y]) => [width - x, height - y]),
    ...reversed.map(([x, y]) => [x, height - y]),
  ];
}

export function screenClip(width, height) {
  return `polygon(${screenOutline(width, height).map(([x, y]) => `${x.toFixed(4)}px ${y.toFixed(4)}px`).join(',')})`;
}
