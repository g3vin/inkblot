/**
 * planetMeshes.js — planets, moons, dwarfs and stations in a 3D system.
 *
 * A world is a lit sphere with a small texture drawn from a seed (its id), so every
 * world looks like itself and the same each time: rocky worlds get continents of
 * noise in their colour, giants get bands. A world with a linked planet map
 * (`body.surface`) will show that map's surface instead (planet maps, later). Rings,
 * when a world has them, and a thin atmosphere rim on rocky worlds.
 *
 * Built at radius 1 and scaled as a whole, like stars.
 */
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
} from 'three'
import { MAP_DEFAULT_COLORS } from '../../lib/map/mapColors'
import { fbm3, random, seedOf } from '../../lib/map/seeded'
import { WORLD_PARTS } from '../../lib/map/spacePalette'
import { SPHERE_VERTEX } from './glsl'

const TEXTURE_WIDTH = 256
const TEXTURE_HEIGHT = 128
/** Roughly ten Earths: heavier than this is a giant, drawn banded. */
const GIANT_MASS_SUN = 3e-5

let sphere = null
let station = null
const sphereGeometry = () => (sphere ||= new SphereGeometry(1, 48, 24))
const stationGeometry = () => (station ||= new OctahedronGeometry(1, 0))

const isGiant = (body) => body.kind === 'planet' && ((body.massSun || 0) > GIANT_MASS_SUN || (body.radiusKm || 0) > 20000)

/* ---------------- textures from a seed ---------------- */

const mixColor = (a, b, t) => a.clone().lerp(b, Math.min(1, Math.max(0, t)))

function paint(width, height, colorAt) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  const image = context.createImageData(width, height)
  const color = new Color()
  for (let y = 0; y < height; y += 1) {
    const lat = Math.PI * (0.5 - (y + 0.5) / height)
    for (let x = 0; x < width; x += 1) {
      const lon = 2 * Math.PI * ((x + 0.5) / width) - Math.PI
      const dir = [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]
      colorAt(dir, lat, color)
      const at = (y * width + x) * 4
      image.data[at] = color.r * 255
      image.data[at + 1] = color.g * 255
      image.data[at + 2] = color.b * 255
      image.data[at + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/** A rocky world: land and sea (or plains and highlands) in shades of its colour. */
function rockyTexture(body, base) {
  const seed = seedOf(body.id)
  const rand = random(seed)
  const watery = rand() < 0.45 && body.kind === 'planet'
  const sea = mixColor(new Color(WORLD_PARTS.sea), base, 0.25)
  const low = base.clone().offsetHSL(0, -0.05, -0.1)
  const high = base.clone().offsetHSL(0.02, -0.1, 0.12)
  const ice = new Color(WORLD_PARTS.ice)
  const seaLevel = watery ? 0.52 : 0.35
  return paint(TEXTURE_WIDTH, TEXTURE_HEIGHT, (dir, lat, out) => {
    const height = fbm3(dir[0] * 2.2, dir[1] * 2.2, dir[2] * 2.2, seed, 5) * 0.5 + 0.5
    const polar = Math.abs(lat) > 1.25 - height * 0.25
    if (polar && watery) return out.copy(ice)
    if (height < seaLevel) return out.copy(watery ? mixColor(sea, low, height / seaLevel * 0.4) : low.clone().offsetHSL(0, 0, -0.08))
    return out.copy(mixColor(low, high, (height - seaLevel) / (1 - seaLevel)))
  })
}

/** A giant: bands of latitude, stirred, with the odd storm. */
function bandedTexture(body, base) {
  const seed = seedOf(body.id)
  const light = base.clone().offsetHSL(0, -0.05, 0.14)
  const dark = base.clone().offsetHSL(0.02, 0.05, -0.14)
  return paint(TEXTURE_WIDTH, TEXTURE_HEIGHT, (dir, lat, out) => {
    const stir = fbm3(dir[0] * 3, dir[1] * 3, dir[2] * 3, seed, 4) * 0.6
    const band = Math.sin(lat * 14 + stir * 3) * 0.5 + 0.5
    return out.copy(mixColor(dark, light, band))
  })
}

/* ---------------- atmosphere and rings ---------------- */

const RIM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying vec3 vDir;
varying vec3 vViewNormal;
varying vec3 vViewPos;
void main() {
  float rim = 1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPos)));
  gl_FragColor = vec4(uColor, pow(rim, 3.0) * 0.8);
}
`

const RING_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uSeed;
uniform float uInner;
uniform float uOuter;
varying vec2 vPos;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float t = (length(vPos) - uInner) / (uOuter - uInner);
  // Ringlets and gaps: a few sines and a hashed fine grain across the radius.
  float bands = 0.55 + 0.25 * sin(t * 40.0 + uSeed) + 0.2 * sin(t * 113.0 + uSeed * 2.0);
  float grain = hash(floor(t * 300.0) + uSeed);
  float alpha = clamp(bands * (0.6 + 0.4 * grain), 0.0, 1.0) * smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.92, 1.0, t)) * 0.75;
  gl_FragColor = vec4(uColor * (0.8 + 0.3 * grain), alpha);
}
`
const RING_VERTEX = /* glsl */ `
varying vec2 vPos;
void main() {
  vPos = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/* ---------------- one world ---------------- */

/** A world's 3D object: `{ object, core, setRadius, update, dispose }`. */
export function createWorld(body) {
  const object = new Group()
  object.name = body.id
  const owned = []
  const base = new Color(body.color || MAP_DEFAULT_COLORS.body)

  if (body.kind === 'station') {
    const material = new MeshStandardMaterial({ color: base, metalness: 0.6, roughness: 0.35, emissive: base.clone().multiplyScalar(0.15) })
    owned.push(material)
    const core = new Mesh(stationGeometry(), material)
    object.add(core)
    return finish(object, core, owned)
  }

  const texture = isGiant(body) ? bandedTexture(body, base) : rockyTexture(body, base)
  owned.push(texture)
  const material = new MeshStandardMaterial({ map: texture, roughness: 0.92, metalness: 0 })
  owned.push(material)
  const core = new Mesh(sphereGeometry(), material)
  // Its axis leans by its axial tilt, and it turns about that axis (spin first).
  core.rotation.order = 'ZYX'
  core.rotation.z = ((body.axialTiltDeg || 0) * Math.PI) / 180
  object.add(core)

  if (body.kind === 'planet' && !isGiant(body)) {
    const rim = new Mesh(
      sphereGeometry(),
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(WORLD_PARTS.atmosphere) } },
        vertexShader: SPHERE_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: BackSide,
      })
    )
    rim.scale.setScalar(1.06)
    owned.push(rim.material)
    object.add(rim)
  }

  if (body.rings) {
    const radius = body.radiusKm || 60000
    const inner = body.rings.innerKm / radius
    const outer = body.rings.outerKm / radius
    const geometry = new RingGeometry(inner, outer, 160, 1)
    const ring = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(body.rings.color || WORLD_PARTS.rings) },
          uSeed: { value: (seedOf(body.id) % 100) / 7 },
          uInner: { value: inner },
          uOuter: { value: outer },
        },
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      })
    )
    ring.rotation.x = -Math.PI / 2
    ring.rotation.y = ((body.axialTiltDeg || 0) * Math.PI) / 180
    owned.push(geometry, ring.material)
    object.add(ring)
  }

  return finish(object, core, owned, body)
}

function finish(object, core, owned, body) {
  const spinPerDay = body?.rotationHours ? (24 / body.rotationHours) * Math.PI * 2 : 0.6
  return {
    object,
    core,
    setRadius(radius) {
      object.scale.setScalar(radius)
    },
    update(day) {
      core.rotation.y = (day * spinPerDay) % (Math.PI * 2)
    },
    dispose() {
      for (const item of owned) item.dispose()
    },
  }
}
