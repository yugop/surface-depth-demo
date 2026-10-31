import * as THREE from 'three';

// Evaluate the broad color field at low resolution; the detailed PBR shader
// samples it separately from the surface textures, in fixed object coordinates.
export function createGradientController(renderer, uniforms) {
  const target = new THREE.WebGLRenderTarget(128, 128, {
    type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  uniforms.gradientMap.value = target.texture;
  const material = new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform vec2 gradientExtent;
      uniform float gradientTime, gradientSize;
      uniform vec3 gradientColor0, gradientColor1, gradientColor2, gradientColor3;

      float hash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float noise(vec3 p) {
        p = vec3(dot(p, vec3(.6,.64,.48)), dot(p, vec3(0,.6,-.8)), dot(p, vec3(-.8,.48,.36)));
        vec3 cell = floor(p), f = fract(p);
        f = f*f*f * (f * (f*6.0-15.0) + 10.0);
        float lower = mix(mix(hash(cell), hash(cell+vec3(1,0,0)), f.x),
                          mix(hash(cell+vec3(0,1,0)), hash(cell+vec3(1,1,0)), f.x), f.y);
        float upper = mix(mix(hash(cell+vec3(0,0,1)), hash(cell+vec3(1,0,1)), f.x),
                          mix(hash(cell+vec3(0,1,1)), hash(cell+vec3(1,1,1)), f.x), f.y);
        return mix(lower, upper, f.z) * 2.0 - 1.0;
      }
      // Same smooth spatial/time noise and broad warp as the Unity AI layer.
      float wave(vec2 p) {
        vec2 q = p / gradientSize * 2.0;
        float t = gradientTime * .18, seed = 31.0 * .731;
        vec2 warpPosition = q / 1.5;
        vec2 warp = vec2(noise(vec3(warpPosition+seed, t*.57+13.7)),
                         noise(vec3(warpPosition+seed+31.4, t*.43+47.2)));
        q += warp * .65;
        float broad = noise(vec3(q+seed, t));
        vec2 detailPosition = vec2(q.x*.8-q.y*.6, q.x*.6+q.y*.8);
        float detail = noise(vec3(detailPosition*1.9+seed+19.3, -t*.79+9.1));
        return clamp(.5 + .5 * (broad*.65 + detail*.35) * 1.2, 0.0, 1.0);
      }
      vec3 palette(float t) {
        if (t < .2647) return mix(gradientColor0, gradientColor1, t/.2647);
        if (t < .6490) return mix(gradientColor1, gradientColor2, (t-.2647)/.3843);
        return mix(gradientColor2, gradientColor3, (t-.6490)/.3510);
      }
      void main() {
        gl_FragColor = vec4(palette(wave((vUv-.5) * gradientExtent)), 1.0);
      }
    `,
  });
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  return {
    resize(width, height) {
      const short = Math.min(width, height);
      uniforms.gradientExtent.value.set(width / short, height / short);
      target.setSize(Math.round(128 * width / short), Math.round(128 * height / short));
    },
    render() {
      const previous = renderer.getRenderTarget();
      try { renderer.setRenderTarget(target); renderer.render(scene, camera); }
      finally { renderer.setRenderTarget(previous); }
    },
    dispose() { target.dispose(); quad.geometry.dispose(); material.dispose(); },
  };
}
