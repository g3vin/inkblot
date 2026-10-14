/**
 * glsl.js — shader pieces the space view's materials share.
 *
 * `NOISE` is seeded 3D value noise and a five-octave fbm, sampled on a body's own
 * surface direction so a sphere has no seam. Cheap on purpose: a star's granulation
 * and a disc's clumps need texture, not physics.
 */

export const NOISE = /* glsl */ `
float ibHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float ibNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(ibHash(i + vec3(0.0, 0.0, 0.0)), ibHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(ibHash(i + vec3(0.0, 1.0, 0.0)), ibHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(ibHash(i + vec3(0.0, 0.0, 1.0)), ibHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(ibHash(i + vec3(0.0, 1.0, 1.0)), ibHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}
float ibFbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += ibNoise(p) * amp;
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    amp *= 0.5;
  }
  return sum;
}
`

/** A sphere's vertex shader: its surface direction, and which way it faces the camera. */
export const SPHERE_VERTEX = /* glsl */ `
varying vec3 vDir;
varying vec3 vViewNormal;
varying vec3 vViewPos;
void main() {
  vDir = normalize(position);
  vViewNormal = normalize(normalMatrix * normal);
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vViewPos = view.xyz;
  gl_Position = projectionMatrix * view;
}
`

/** A flat disc's vertex shader: its radius (0 inner edge → 1 outer) and angle. */
export const DISC_VERTEX = /* glsl */ `
uniform float uInner;
uniform float uOuter;
varying float vRadius;
varying float vAngle;
varying vec3 vWorld;
void main() {
  float r = length(position.xy);
  vRadius = (r - uInner) / max(uOuter - uInner, 1e-6);
  vAngle = atan(position.y, position.x);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`
