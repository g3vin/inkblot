/**
 * backdrop.js — the sky behind a 3D map: background stars, and the band of a
 * galaxy seen from inside it.
 *
 * Drawn from a seed, so a system's sky is its own and the same every time. It is a
 * single Points buffer that rides with the camera (`follow`), so it is always at
 * infinity: orbiting turns the sky, moving does not.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three'
import { temperatureToColor } from '../../lib/map/stars'
import { gaussian, random } from '../../lib/map/seeded'

const VERTEX = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = color;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale;
  gl_Position = projectionMatrix * view;
}
`
const FRAGMENT = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float alpha = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(vColor * alpha, alpha);
}
`

/** A star's colour, by a rough mix of the temperatures of the stars we see. */
function skyColor(rand) {
  const t = rand()
  const kelvin = t < 0.12 ? 3200 + rand() * 900 : t < 0.55 ? 4800 + rand() * 1200 : t < 0.9 ? 6000 + rand() * 3000 : 10000 + rand() * 15000
  return new Color(temperatureToColor(kelvin))
}

/**
 * The sky for `seed`: `count` stars, about a third of them crowded into a band
 * (the galaxy's disc, seen edge-on from within). `radius` is how far out they sit.
 */
export function createBackdrop(seed = 1, { count = 4200, radius = 900, pixelRatio = 1 } = {}) {
  const rand = random(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  // The band's tilt: its pole, from the seed.
  const poleTheta = rand() * Math.PI * 2
  const poleTilt = 0.4 + rand() * 0.8
  const pole = [Math.sin(poleTilt) * Math.cos(poleTheta), Math.cos(poleTilt), Math.sin(poleTilt) * Math.sin(poleTheta)]
  for (let index = 0; index < count; index += 1) {
    let x = gaussian(rand)
    let y = gaussian(rand)
    let z = gaussian(rand)
    if (index % 3 === 0) {
      // Pull towards the band: remove most of the component along the pole.
      const along = x * pole[0] + y * pole[1] + z * pole[2]
      const keep = 0.08 + Math.abs(gaussian(rand)) * 0.06
      x -= pole[0] * along * (1 - keep)
      y -= pole[1] * along * (1 - keep)
      z -= pole[2] * along * (1 - keep)
    }
    const length = Math.hypot(x, y, z) || 1
    positions[index * 3] = (x / length) * radius
    positions[index * 3 + 1] = (y / length) * radius
    positions[index * 3 + 2] = (z / length) * radius
    const color = skyColor(rand)
    // Most stars faint, a few bright: a steep power law.
    const brightness = 0.25 + 0.75 * rand() ** 6
    colors[index * 3] = color.r * brightness
    colors[index * 3 + 1] = color.g * brightness
    colors[index * 3 + 2] = color.b * brightness
    sizes[index] = 1.2 + 2.6 * rand() ** 8
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('size', new BufferAttribute(sizes, 1))
  const material = new ShaderMaterial({
    uniforms: { uScale: { value: pixelRatio } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  })
  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = -10
  return {
    object: points,
    /** Keep the sky centred on the camera, so it never comes closer. */
    follow(camera) {
      points.position.copy(camera.position)
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
