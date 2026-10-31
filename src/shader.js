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
uniform bool orthographicView;
uniform bool materialReady;
uniform float materialScale;
uniform sampler2D gradientMap;
uniform vec2 gradientExtent;
uniform float gradientStrength;
uniform sampler2D materialColorMap;
uniform sampler2D materialNormalMap;
uniform sampler2D materialRoughnessMap;
uniform sampler2D materialMetalnessMap;
uniform sampler2D materialOcclusionMap;
uniform samplerCube environmentMap;
uniform bool environmentReady;
uniform float environmentStrength;
uniform float environmentMaxLod;
uniform mat3 environmentRotation;
uniform sampler2D cameraMap;
uniform bool cameraMode;
uniform float cameraAspect;
uniform float cameraMaxLod;
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
// Blend three planar projections to cover curved walls without UV seams.
vec3 materialSample(sampler2D map, vec2 x, vec2 y, vec2 z, vec3 weights) {
  return texture2D(map, x).rgb * weights.x + texture2D(map, y).rgb * weights.y + texture2D(map, z).rgb * weights.z;
}
// Cotangent frame, matching Three.js tangent-space normal mapping. A neutral
// normal map preserves the original curved-surface normal on every projection.
vec3 mappedNormal(vec3 surface, vec3 normal, vec2 uv) {
  vec3 q0 = dFdx(surface), q1 = dFdy(surface);
  vec2 st0 = dFdx(uv), st1 = dFdy(uv);
  vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
  vec3 tangent = q1perp * st0.x + q0perp * st1.x;
  vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
  float scale = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-16));
  vec3 sampleNormal = texture2D(materialNormalMap, uv).xyz * 2.0 - 1.0;
  return normalize(mat3(tangent * scale, bitangent * scale, normal) * sampleNormal);
}
// GGX with dielectric or metal F0, using the selected material's roughness.
vec3 reflection(vec3 normal, vec3 light, vec3 view, float surfaceRoughness, vec3 f0) {
  float nl = max(dot(normal, light), 0.0);
  float nv = max(dot(normal, view), 0.0);
  if (nl <= 0.0 || nv <= 0.0) return vec3(0.0);
  vec3 halfVector = normalize(light + view);
  float nh = max(dot(normal, halfVector), 0.0);
  float vh = max(dot(view, halfVector), 0.0);
  float alpha = max(surfaceRoughness * surfaceRoughness, 0.0025);
  float a2 = alpha * alpha;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float distribution = a2 / max(3.14159265359 * d * d, 0.0000001);
  float k = (surfaceRoughness + 1.0) * (surfaceRoughness + 1.0) / 8.0;
  float geometry = (nl / (nl * (1.0-k) + k)) * (nv / (nv * (1.0-k) + k));
  vec3 fresnel = f0 + (1.0 - f0) * pow(1.0-vh, 5.0);
  return distribution * geometry * fresnel / max(4.0 * nv, 0.00001);
}
// A front camera covers one forward view, not the full sphere. Fade its edges
// into the frame average rather than repeating or stretching the image behind us.
vec3 cameraRadiance(vec3 direction, float surfaceRoughness) {
  vec2 uv = 0.5 + vec2(-direction.x / cameraAspect, direction.y) / (1.15470054 * max(direction.z, 0.05));
  vec2 outside = max(abs(uv - 0.5) - 0.5, 0.0);
  float visible = smoothstep(0.0, 0.2, direction.z) * (1.0 - smoothstep(0.0, 0.15, max(outside.x, outside.y)));
  float lod = cameraMaxLod * surfaceRoughness * (2.0 - surfaceRoughness);
  vec3 frame = sRGBTransferEOTF(textureLod(cameraMap, clamp(uv, 0.0, 1.0), lod)).rgb;
  vec3 average = sRGBTransferEOTF(textureLod(cameraMap, vec2(0.5), cameraMaxLod)).rgb;
  return mix(average, frame, visible);
}
// GGX-prefiltered radiance with an analytic integrated BRDF approximation.
vec3 environmentReflection(vec3 normal, vec3 view, float surfaceRoughness, vec3 f0) {
  if (!environmentReady || environmentStrength <= 0.0) return vec3(0.0);
  vec3 direction = normalize(mix(reflect(-view, normal), normal, pow(surfaceRoughness, 4.0)));
  direction = environmentRotation * direction;
  float lod = environmentMaxLod * surfaceRoughness * (2.0 - surfaceRoughness);
  vec3 radiance;
  if (cameraMode) radiance = cameraRadiance(direction, surfaceRoughness);
  else radiance = textureLod(environmentMap, direction, lod).rgb;
  float nv = max(dot(normal, view), 0.0);
  vec4 r = surfaceRoughness * vec4(-1.0, -0.0275, -0.572, 0.022) + vec4(1.0, 0.0425, 1.04, -0.04);
  float a004 = min(r.x * r.x, exp2(-9.28 * nv)) * r.x + r.y;
  vec2 fab = vec2(-1.04, 1.04) * a004 + r.zw;
  return radiance * (f0 * fab.x + fab.y) * environmentStrength;
}
void main() {
  vec3 surface = vSurface;
  vec3 normal = normalize(vSurfaceNormal);
  vec3 view = orthographicView ? vec3(0,0,1) : normalize(cameraPosition - surface);
  vec3 albedo = baseColor;
  float surfaceRoughness = roughness, metalness = 0.0, occlusion = 1.0;
  if (materialReady) {
    vec3 p = surface * materialScale;
    vec3 axisSign = mix(vec3(-1.0), vec3(1.0), step(vec3(0.0), normal));
    vec2 uvX = vec2(-p.z * axisSign.x, p.y);
    vec2 uvY = vec2(p.x, -p.z * axisSign.y);
    vec2 uvZ = vec2(p.x * axisSign.z, p.y);
    vec3 weights = pow(abs(normal), vec3(4.0));
    weights /= weights.x + weights.y + weights.z;
    albedo = materialSample(materialColorMap, uvX, uvY, uvZ, weights);
    surfaceRoughness = clamp(materialSample(materialRoughnessMap, uvX, uvY, uvZ, weights).r * roughness / 0.65, 0.05, 1.0);
    metalness = materialSample(materialMetalnessMap, uvX, uvY, uvZ, weights).r;
    occlusion = materialSample(materialOcclusionMap, uvX, uvY, uvZ, weights).r;
    normal = normalize(mappedNormal(surface, normal, uvX) * weights.x
                     + mappedNormal(surface, normal, uvY) * weights.y
                     + mappedNormal(surface, normal, uvZ) * weights.z);
  }
  if (gradientStrength > 0.0) {
    vec3 tone = texture2D(gradientMap, surface.xy / gradientExtent + .5).rgb;
    albedo *= mix(vec3(1.0), tone, gradientStrength);
  }
  vec3 f0 = mix(vec3(0.04), albedo, metalness);
  float z = -surface.z;
  float aa = 1.0 / min(resolution.x, resolution.y);
  vec3 forward = normalize(lightPosition);
  // Shadow-off comparison uses only the normal and a uniform light direction.
  float illumination = max(dot(normal, forward), 0.0);
  vec3 specular = reflection(normal, forward, view, surfaceRoughness, f0);
  if (shadows) {
  vec3 tangent = lightTangent(forward);
  vec3 bitangent = cross(forward, tangent);
  illumination = 0.0;
  specular = vec3(0.0);
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
      specular += visible * reflection(normal, normalize(ray), view, surfaceRoughness, f0) / dist2;
    }
    vec3 refRay = source - vec3(0,0,-depth);
    reference += max(normalize(refRay).z, 0.0) / dot(refRay,refRay);
  }
  illumination /= max(reference, 0.0001);
  specular /= max(reference, 0.0001);
  }
  float visibility = mainVisibility(surface, forward, aa);
  vec3 color = albedo * (1.0 - metalness) * (ambient * occlusion + illumination * brightness * visibility)
             + specular * specularStrength * brightness * visibility
             + environmentReflection(normal, view, surfaceRoughness, f0);
  gl_FragColor = vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
