/**
 * galaxyScene.js — a galaxy, or a group of galaxies, in 3D.
 *
 * A galaxy map draws its galaxy as one static cloud of points from galaxyGen.js
 * (additive light, a darker cloud of dust over it, a soft glow where the core is
 * too dense to resolve), on rings of distance every ten thousand light-years.
 * Scene units are thousands of light-years; the galaxy's disc is the scene's floor.
 *
 * A group of galaxies (a universe map) draws each pinned galaxy as a small picture
 * of itself — an impostor, rendered once from the same generator by type and seed
 * and turned to its own angle — so hundreds of galaxies stay cheap. Scene units are
 * megaparsecs.
 *
 * The star systems and galaxies the writer placed are pins, drawn by the surface's
 * overlay like any other place.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import { generateGalaxy } from '../../lib/map/galaxyGen'
import { paintGalaxy } from '../../lib/map/galaxyPicture'
import { random, seedOf } from '../../lib/map/seeded'
import { GALAXY_PARTS } from '../../lib/map/spacePalette'

const KLY = 1000
/** Light-years in a megaparsec. */
const LY_PER_MPC = 3261563.8

const POINT_VERTEX = /* glsl */ `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uScale;
uniform float uPixelRatio;
void main() {
  vColor = color;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  // Points shrink with distance, but never below a speck nor past a blob.
  gl_PointSize = clamp(size * uScale / max(-view.z, 1e-4), 0.8, 9.0) * uPixelRatio;
  gl_Position = projectionMatrix * view;
}
`
const LIGHT_FRAGMENT = /* glsl */ `
varying vec3 vColor;
uniform float uGain;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  float alpha = smoothstep(1.0, 0.0, r);
  gl_FragColor = vec4(vColor * alpha * uGain, alpha);
}
`
const DUST_FRAGMENT = /* glsl */ `
varying vec3 vColor;
uniform float uOpacity;
void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  gl_FragColor = vec4(vColor, smoothstep(1.0, 0.0, r) * uOpacity);
}
`

/** Galaxy light-years (disc in x–y) → scene points, in place. */
function toSceneUnits(source, unit) {
  const out = new Float32Array(source.length)
  for (let index = 0; index < source.length; index += 3) {
    out[index] = source[index] / unit
    out[index + 1] = source[index + 2] / unit
    out[index + 2] = -source[index + 1] / unit
  }
  return out
}

function lightPoints(result, unit, pixelRatio, owned, reach) {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(toSceneUnits(result.positions, unit), 3))
  geometry.setAttribute('color', new BufferAttribute(result.colors, 3))
  geometry.setAttribute('size', new BufferAttribute(result.sizes, 1))
  const material = new ShaderMaterial({
    // Point size scales with the galaxy, so a whole galaxy in view is a cloud, not dust.
    uniforms: { uScale: { value: reach * 7 }, uPixelRatio: { value: pixelRatio }, uGain: { value: 0.6 } },
    vertexShader: POINT_VERTEX,
    fragmentShader: LIGHT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  owned.push(geometry, material)
  const points = new Points(geometry, material)
  points.frustumCulled = false
  return points
}

function dustPoints(result, unit, pixelRatio, owned, reach) {
  const { dust } = result
  if (!dust.count) return null
  const colors = new Float32Array(dust.count * 3)
  const shade = new Color(GALAXY_PARTS.dust)
  for (let index = 0; index < dust.count; index += 1) colors.set([shade.r, shade.g, shade.b], index * 3)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(toSceneUnits(dust.positions, unit), 3))
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.setAttribute('size', new BufferAttribute(dust.sizes.map((size) => size * 2.2), 1))
  const material = new ShaderMaterial({
    uniforms: { uScale: { value: reach * 7 }, uPixelRatio: { value: pixelRatio }, uOpacity: { value: 0.45 } },
    vertexShader: POINT_VERTEX,
    fragmentShader: DUST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  })
  owned.push(geometry, material)
  const points = new Points(geometry, material)
  points.frustumCulled = false
  points.renderOrder = 1
  return points
}

let glow = null
/** A soft round glow (shared). */
function glowTexture() {
  if (glow) return glow
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [offset, color] of GALAXY_PARTS.coreStops) gradient.addColorStop(offset, color)
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  glow = new CanvasTexture(canvas)
  glow.colorSpace = SRGBColorSpace
  return glow
}

/* ---------------- a galaxy's picture of itself (for groups of galaxies) ---------------- */

const impostors = new Map()
const IMPOSTOR_SIZE = 128
const IMPOSTOR_CACHE = 64

/** A face-on picture of a galaxy of `type` and `seed`, drawn once and kept. */
function impostorTexture(type, seed) {
  const key = `${type}:${seed}`
  if (impostors.has(key)) return impostors.get(key)
  const canvas = document.createElement('canvas')
  canvas.width = IMPOSTOR_SIZE
  canvas.height = IMPOSTOR_SIZE
  paintGalaxy(canvas, type, seed)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  impostors.set(key, texture)
  if (impostors.size > IMPOSTOR_CACHE) {
    const oldest = impostors.keys().next().value
    impostors.get(oldest).dispose()
    impostors.delete(oldest)
  }
  return texture
}

/* ---------------- the scene ---------------- */

/** Rings of distance in the floor, every `step` scene units out to `reach`. */
function rings(plane, step, reach, color, owned) {
  const material = new LineBasicMaterial({ color: new Color(color), transparent: true, opacity: 0.14, depthWrite: false })
  owned.push(material)
  for (let radius = step; radius <= reach + 1e-9; radius += step) {
    const points = new Float32Array(129 * 3)
    for (let index = 0; index <= 128; index += 1) {
      const angle = (index / 128) * Math.PI * 2
      points.set([Math.cos(angle) * radius, 0, Math.sin(angle) * radius], index * 3)
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(points, 3))
    owned.push(geometry)
    plane.add(new LineLoop(geometry, material))
  }
}

/**
 * Build the scene for a galaxy or universe map. Returns the same shape as a
 * system's (systemScene.js): `{ root, plane, toScene, fromScene, setDay,
 * beforeRender, bodyAt, hitList, extent, dispose }`.
 */
export function createGalaxyScene(map, { colors, pixelRatio = Math.min(window.devicePixelRatio || 1, 2) }) {
  const universe = map.mapKind === 'universe'
  const unit = universe ? 1 : KLY
  const root = new Group()
  const plane = new Group()
  root.add(plane)
  const owned = []
  const impostorMeshes = []
  // Point sizes follow the drawing's pixel ratio, which an export raises (stage.js picture).
  const ratioUniforms = []
  let reach

  if (!universe) {
    const galaxy = map.galaxy
    const result = generateGalaxy(galaxy)
    const extentKly = galaxy.radiusLy / KLY
    const light = lightPoints(result, KLY, pixelRatio, owned, extentKly)
    plane.add(light)
    ratioUniforms.push(light.material.uniforms.uPixelRatio)
    const dust = dustPoints(result, KLY, pixelRatio, owned, extentKly)
    if (dust) {
      plane.add(dust)
      ratioUniforms.push(dust.material.uniforms.uPixelRatio)
    }
    const core = new Sprite(new SpriteMaterial({ map: glowTexture(), color: new Color(GALAXY_PARTS.core), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: /^E|S0|dwarf/.test(galaxy.type) ? 0.9 : 0.7 }))
    const coreSize = (galaxy.radiusLy / KLY) * (/^E/.test(galaxy.type) ? 1.1 : 0.5)
    core.scale.set(coreSize, coreSize, 1)
    owned.push(core.material)
    plane.add(core)
    reach = galaxy.radiusLy / KLY
    rings(plane, 10, Math.ceil(reach / 10) * 10, colors.grid, owned)
  } else {
    // Each pinned galaxy, as its picture, turned to an angle of its own.
    reach = map.universe.extentMpc / 2
    const square = new PlaneGeometry(1, 1)
    owned.push(square)
    for (const pin of map.pins) {
      const look = pin.galaxy
      if (!look || !pin.at) continue
      const seed = Number.isFinite(look.seed) ? look.seed : seedOf(pin.id)
      const texture = impostorTexture(look.type || 'Sb', seed)
      const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })
      owned.push(material)
      const mesh = new Mesh(square, material)
      const at = [pin.at[0], pin.at[2] || 0, -pin.at[1]]
      mesh.position.set(at[0], at[1], at[2])
      const rand = random(seed)
      mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI)
      const size = ((look.radiusLy || 50000) * 2) / LY_PER_MPC
      // Drawn a good deal bigger than life, or a group of galaxies is dust.
      mesh.userData.size = size * 3
      plane.add(mesh)
      impostorMeshes.push(mesh)
    }
    rings(plane, Math.max(1, Math.round(reach / 4)), reach, colors.grid, owned)
  }

  const centre = new Vector3()
  return {
    root,
    plane,
    toScene: (point) => [point[0] / unit, (point[2] || 0) / unit, -point[1] / unit],
    fromScene: (local) => [local[0] * unit, -local[2] * unit],
    setDay: () => {},
    beforeRender: (camera, heightPx, ratio = pixelRatio) => {
      for (const uniform of ratioUniforms) uniform.value = ratio
      if (!universe) return
      // A galaxy is drawn at its size, but never smaller than a thumbnail's worth.
      const perPixel = (distance) => (2 * distance * Math.tan((camera.fov * Math.PI) / 360)) / heightPx
      const at = new Vector3()
      for (const mesh of impostorMeshes) {
        mesh.getWorldPosition(at)
        mesh.scale.setScalar(Math.max(mesh.userData.size, 30 * perPixel(camera.position.distanceTo(at))))
      }
    },
    bodyAt: () => null,
    hitList: () => [],
    /** What framing everything means: the middle, and how far out things go. */
    extent: () => ({ centre: centre.clone(), radius: reach }),
    dispose() {
      for (const item of owned) item.dispose()
    },
  }
}
