import { CORNER_EXTENT, CORNER_PROFILE } from './iphone-air.js';

export const vertexShader = `
varying vec3 vSurface;
varying vec3 vSurfaceNormal;
void main() {
  vec4 surface = modelMatrix * vec4(position, 1.0);
  vSurface = surface.xyz;
  vSurfaceNormal = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * surface;
}
`;

export const fragmentShader = `
precision highp float;
varying vec3 vSurface;
varying vec3 vSurfaceNormal;
uniform vec2 resolution;
uniform float depth;
uniform vec3 lightPosition;
uniform float lightRadius;
uniform bool shadows;
uniform bool mainShadows;
uniform float opening;
uniform vec3 baseColor;
uniform float brightness;
uniform float ambient;
uniform float specularStrength;
uniform float roughness;
uniform vec2 cornerProfile[${CORNER_PROFILE.length}];
const float CORNER_EXTENT = ${CORNER_EXTENT};
const float PROFILE_SEGMENTS = ${CORNER_PROFILE.length - 1}.0;

// Apple active-area contour: half-sum of edge insets as a function of their difference.
// Interpolate value and derivative together so adjacent segments share a normal.
vec2 cornerCurve(float delta) {
  float d = abs(delta);
  if (d >= CORNER_EXTENT) return vec2(d * 0.5, sign(delta) * 0.5);
  float stepSize = CORNER_EXTENT / PROFILE_SEGMENTS;
  float position = d / stepSize;
  int i = min(int(position), ${CORNER_PROFILE.length - 2});
  float t = position - float(i);
  vec2 a = cornerProfile[i];
  vec2 b = cornerProfile[i + 1];
  float c = stepSize * a.y;
  float e = 3.0 * (b.x - a.x) - stepSize * (2.0 * a.y + b.y);
  float f = 2.0 * (a.x - b.x) + stepSize * (a.y + b.y);
  return vec2(a.x + t * (c + t * (e + t * f)),
              sign(delta) * (c + t * (2.0 * e + 3.0 * t * f)) / stepSize);
}
// Shrink the extents while retaining the measured corner profile at every depth.
vec3 profileInset(vec2 p, vec2 halfSize) {
  vec2 edge = halfSize - abs(p);
  vec2 curve = cornerCurve(edge.x - edge.y);
  return vec3((edge.x + edge.y) * 0.5 - curve.x,
              vec2(-0.5 + curve.y, -0.5 - curve.y) * sign(p));
}
vec3 roundedInset(vec2 p) {
  return profileInset(p, resolution / min(resolution.x, resolution.y) * 0.5);
}
// The white sheet slides upward at z=0; its lower corners retain the screen contour.
vec3 mainInset(vec2 p) {
  vec2 halfSize = resolution / min(resolution.x, resolution.y) * 0.5;
  return profileInset(p - vec2(0.0, opening * halfSize.y * 2.0), halfSize);
}
// Avoid an undefined tangent when tilt aligns the light with the Y axis.
vec3 lightTangent(vec3 forward) {
  return normalize(cross(forward, abs(forward.y) > 0.99 ? vec3(1,0,0) : vec3(0,1,0)));
}
// Locally project a disk light onto the sheet. Integrating its circular segment
// gives a continuous penumbra without a visible finite-sample staircase.
float mainVisibility(vec3 surface, vec3 forward, float aa) {
  if (!mainShadows || opening <= 0.0 || opening >= 1.0) return 1.0;
  vec3 ray = lightPosition - surface;
  if (lightPosition.z <= 0.0) return 1.0;
  float t = -surface.z / max(ray.z, 0.00001);
  vec3 edge = mainInset(surface.xy + ray.xy * t);
  vec3 tangent = lightTangent(forward);
  vec3 bitangent = cross(forward, tangent);
  vec3 projection = vec3(edge.yz, -dot(edge.yz, ray.xy) / max(ray.z, 0.00001));
  float width = max(aa, t * lightRadius * length(vec2(dot(projection, tangent), dot(projection, bitangent))));
  float x = clamp(edge.x / width, -1.0, 1.0);
  return (acos(x) - x * sqrt(max(1.0 - x*x, 0.0))) / 3.14159265359;
}
// Positive inside the aperture; the same profile also defines the floor contours.
float aperture(vec2 p) { return roundedInset(p).x; }
// Dielectric GGX reflection uses the actual direction back to the fixed eye.
float reflection(vec3 normal, vec3 light, vec3 view) {
  float nl = max(dot(normal, light), 0.0);
  float nv = max(dot(normal, view), 0.0);
  if (nl <= 0.0 || nv <= 0.0) return 0.0;
  vec3 halfVector = normalize(light + view);
  float nh = max(dot(normal, halfVector), 0.0);
  float vh = max(dot(view, halfVector), 0.0);
  float alpha = max(roughness * roughness, 0.0025);
  float a2 = alpha * alpha;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float distribution = a2 / max(3.14159265359 * d * d, 0.0000001);
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float geometry = (nl / (nl * (1.0-k) + k)) * (nv / (nv * (1.0-k) + k));
  float fresnel = 0.04 + 0.96 * pow(1.0-vh, 5.0);
  return distribution * geometry * fresnel / max(4.0 * nv, 0.00001);
}
void main() {
  vec3 surface = vSurface;
  vec3 normal = normalize(vSurfaceNormal);
  vec3 view = normalize(cameraPosition - surface);
  float z = -surface.z;
  float aa = 1.0 / min(resolution.x, resolution.y);
  vec3 forward = normalize(lightPosition);
  // Shadow-off comparison uses only the normal and a uniform light direction.
  float illumination = max(dot(normal, forward), 0.0);
  float specular = reflection(normal, forward, view);
  if (shadows) {
  vec3 tangent = lightTangent(forward);
  vec3 bitangent = cross(forward, tangent);
  illumination = 0.0;
  specular = 0.0;
  float reference = 0.0;
  // Convex cavity: a ray is unoccluded exactly when its exit at z=0 is in the aperture.
  // Fixed disk samples avoid temporal noise and motion trails.
  for (int i=0; i<64; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.39996322973;
    vec2 disk = sqrt(fi / 64.0) * vec2(cos(a), sin(a));
    vec3 source = lightPosition + lightRadius * (tangent*disk.x + bitangent*disk.y);
    vec3 ray = source - surface;
    if (source.z > 0.001) {
      vec2 exitPoint = surface.xy + ray.xy * z / ray.z;
      float aa = 1.0 / min(resolution.x, resolution.y);
      float visible = smoothstep(-aa, aa, aperture(exitPoint));
      float dist2 = dot(ray,ray);
      illumination += visible * max(dot(normal, normalize(ray)), 0.0) / dist2;
      specular += visible * reflection(normal, normalize(ray), view) / dist2;
    }
    vec3 refRay = source - vec3(0,0,-depth);
    reference += max(normalize(refRay).z, 0.0) / dot(refRay,refRay);
  }
  illumination /= max(reference, 0.0001);
  specular /= max(reference, 0.0001);
  }
  float visibility = mainVisibility(surface, forward, aa);
  vec3 color = baseColor * (ambient + illumination * brightness * visibility)
             + vec3(specular * specularStrength * brightness * visibility);
  gl_FragColor = vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
