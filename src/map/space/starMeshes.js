/**
 * starMeshes.js — a star in 3D, drawn as its kind looks (stars.js `look`).
 *
 * Everything is built at radius 1 and scaled as a whole (`setRadius`), so the space
 * view can draw a star at its true size up close and never smaller than a few
 * pixels far away. The surface is one shader with switches — granulation, limb
 * darkening, a brown dwarf's bands — and what a kind adds goes round it: a corona
 * glow, a black hole's accretion disc, a pulsar's beams, a magnetar's field lines,
 * a newborn star's dusty disc and jets, a Wolf–Rayet star's wind.
 *
 * Animated parts move with the story day (`update`), not a clock, so the view still
 * draws only when something changes.
 */
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
} from 'three'
import { starLook, temperatureToColor, variableAt } from '../../lib/map/stars'
import { seedOf } from '../../lib/map/seeded'
import { STAR_PARTS } from '../../lib/map/spacePalette'
import { DISC_VERTEX, NOISE, SPHERE_VERTEX } from './glsl'

/* ---------------- shared geometry and textures ---------------- */

let shared = null
/** Geometry and textures every star uses, made once. */
function sharedParts() {
  if (shared) return shared
  shared = {
    sphere: new SphereGeometry(1, 64, 32),
    glow: glowTexture(),
    ring: new RingGeometry(1.5, 7, 160, 1),
    dusty: new RingGeometry(1.8, 12, 160, 1),
    beam: (() => {
      const cone = new ConeGeometry(0.9, 14, 32, 1, true)
      // Apex at the star, opening outward.
      cone.translate(0, -7, 0)
      cone.rotateX(Math.PI)
      return cone
    })(),
    loop: new TorusGeometry(2.4, 0.035, 6, 96),
  }
  return shared
}

/** A soft round glow: white at the centre, gone at the edge. */
function glowTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [offset, color] of STAR_PARTS.glowStops) gradient.addColorStop(offset, color)
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

/* ---------------- the surface ---------------- */

const SURFACE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uSeed;
uniform float uTime;
uniform float uGranule;
uniform float uContrast;
uniform float uLimb;
uniform float uBands;
uniform float uBrightness;
varying vec3 vDir;
varying vec3 vViewNormal;
varying vec3 vViewPos;
${NOISE}
void main() {
  float mu = clamp(dot(normalize(vViewNormal), normalize(-vViewPos)), 0.0, 1.0);
  // Limb darkening: the edge of a star is cooler and dimmer than its middle.
  float limb = 1.0 - uLimb * (1.0 - pow(mu, 0.6));
  vec3 p = vDir * uGranule + vec3(uSeed);
  float grain = ibFbm(p + vec3(0.0, uTime * 0.02, 0.0));
  float cells = 1.0 + uContrast * (grain - 0.5) * 2.0;
  if (uBands > 0.0) {
    // A brown dwarf's weather: bands of latitude, stirred.
    float band = sin(vDir.y * uBands + ibFbm(vDir * 3.0 + vec3(uSeed)) * 4.0);
    cells *= 0.82 + 0.18 * band;
  }
  vec3 color = uColor * cells * limb * uBrightness;
  // A hot core reads as white: lift the brightest parts towards it.
  color = mix(color, vec3(1.0), clamp((cells * limb - 1.0) * 0.6, 0.0, 0.5));
  gl_FragColor = vec4(color, 1.0);
}
`

function surfaceMaterial(color, seed, { granule = 7, contrast = 0.22, limb = 0.55, bands = 0, brightness = 1.15 } = {}) {
  return new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(color) },
      uSeed: { value: (seed % 1000) / 10 },
      uTime: { value: 0 },
      uGranule: { value: granule },
      uContrast: { value: contrast },
      uLimb: { value: limb },
      uBands: { value: bands },
      uBrightness: { value: brightness },
    },
    vertexShader: SPHERE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
  })
}

/* ---------------- what goes round it ---------------- */

function glowSprite(color, size, opacity = 1) {
  const sprite = new Sprite(new SpriteMaterial({ map: sharedParts().glow, color: new Color(color), blending: AdditiveBlending, depthWrite: false, transparent: true, opacity }))
  sprite.scale.set(size, size, 1)
  sprite.renderOrder = 2
  return sprite
}

const ACCRETION_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uDoppler;
varying float vRadius;
varying float vAngle;
${NOISE}
void main() {
  float t = clamp(vRadius, 0.0, 1.0);
  // Swirl: noise sampled along a spiral that winds with the story.
  float swirl = ibFbm(vec3(cos(vAngle) * (2.0 + 6.0 * t), sin(vAngle) * (2.0 + 6.0 * t), t * 4.0 - uTime * 0.05 + uSeed));
  vec3 color = mix(uHot, uCool, pow(t, 0.7));
  // The side turning towards us is brighter (relativistic beaming).
  float beaming = 1.0 + uDoppler * cos(vAngle);
  float alpha = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.55, 1.0, t)) * (0.55 + 0.9 * swirl);
  gl_FragColor = vec4(color * beaming * (1.4 - t), alpha);
}
`

function accretionDisc(hot, cool, seed, { doppler = 0.6, geometry = sharedParts().ring, inner = 1.5, outer = 7 } = {}) {
  const disc = new Mesh(
    geometry,
    new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSeed: { value: (seed % 1000) / 10 },
        uHot: { value: new Color(hot) },
        uCool: { value: new Color(cool) },
        uDoppler: { value: doppler },
        uInner: { value: inner },
        uOuter: { value: outer },
      },
      vertexShader: DISC_VERTEX,
      fragmentShader: ACCRETION_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
  )
  // Lying in the star's equator (the ring is made in x–y).
  disc.rotation.x = -Math.PI / 2
  return disc
}

const BEAM_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  // Bright at the star, fading along the beam and towards its edge.
  float along = 1.0 - vUv.y;
  float alpha = pow(1.0 - along, 2.0) * uStrength;
  gl_FragColor = vec4(uColor * 1.5, alpha);
}
`
const BEAM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

function beams(color, strength = 0.7) {
  const material = new ShaderMaterial({
    uniforms: { uColor: { value: new Color(color) }, uStrength: { value: strength } },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const group = new Group()
  const north = new Mesh(sharedParts().beam, material)
  const south = new Mesh(sharedParts().beam, material)
  south.rotation.x = Math.PI
  group.add(north, south)
  return group
}

const SHELL_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uSeed;
uniform float uStrength;
varying vec3 vDir;
varying vec3 vViewNormal;
varying vec3 vViewPos;
${NOISE}
void main() {
  float rim = 1.0 - abs(dot(normalize(vViewNormal), normalize(-vViewPos)));
  float clumps = ibFbm(vDir * 4.0 + vec3(uSeed));
  float alpha = pow(rim, 2.5) * (0.4 + clumps) * uStrength;
  gl_FragColor = vec4(uColor, alpha);
}
`

function windShell(color, seed, size = 2.6, strength = 0.8) {
  const shell = new Mesh(
    sharedParts().sphere,
    new ShaderMaterial({
      uniforms: { uColor: { value: new Color(color) }, uSeed: { value: (seed % 1000) / 10 }, uStrength: { value: strength } },
      vertexShader: SPHERE_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: BackSide,
    })
  )
  shell.scale.setScalar(size)
  return shell
}

/* ---------------- one star ---------------- */

/** How each look is drawn: the surface's switches, the glow's size and what it adds. */
const LOOKS = {
  main: { granule: 7, contrast: 0.22, glow: 7 },
  brownDwarf: { granule: 3, contrast: 0.15, bands: 22, limb: 0.7, glow: 2.5, glowOpacity: 0.35, brightness: 0.9 },
  protostar: { granule: 4, contrast: 0.3, glow: 6, disc: 'dusty', jets: true },
  giant: { granule: 2.2, contrast: 0.38, limb: 0.7, glow: 3.2 },
  blueSupergiant: { granule: 3, contrast: 0.2, glow: 5, wind: 0.5 },
  hypergiant: { granule: 2, contrast: 0.35, glow: 4, wind: 0.7 },
  wolfRayet: { granule: 6, contrast: 0.15, glow: 9, wind: 1.2 },
  carbon: { granule: 1.8, contrast: 0.45, limb: 0.8, glow: 3, wind: 0.4 },
  whiteDwarf: { granule: 0, contrast: 0, limb: 0.3, glow: 14, brightness: 1.4 },
  neutron: { granule: 0, contrast: 0, limb: 0.2, glow: 18, brightness: 1.6 },
  pulsar: { granule: 0, contrast: 0, limb: 0.2, glow: 16, brightness: 1.6, beams: true },
  magnetar: { granule: 0, contrast: 0, limb: 0.2, glow: 16, brightness: 1.6, loops: true },
  blackHole: { hole: true },
}

/** A star body's 3D object: `{ object, core, setRadius, update, dispose, glowColor }`. */
export function createStar(body) {
  const look = LOOKS[starLook(body)] ? starLook(body) : 'main'
  const recipe = LOOKS[look]
  const seed = seedOf(body.id)
  const parts = sharedParts()
  const object = new Group()
  object.name = body.id
  const owned = []
  const animated = []
  const color = body.color || temperatureToColor(body.star?.temperatureK ?? 5772)

  let core
  let glow = null
  if (recipe.hole) {
    // Nothing comes out: a black sphere, a hot disc round it, and a thin bright ring
    // where light orbits the hole.
    core = new Mesh(parts.sphere, new MeshBasicMaterial({ color: 0x000000 }))
    const disc = accretionDisc(STAR_PARTS.holeHot, STAR_PARTS.holeCool, seed)
    disc.rotation.x = -Math.PI / 2 + 0.22
    animated.push(disc.material)
    owned.push(core.material, disc.material)
    const photon = glowSprite(STAR_PARTS.photonRing, 4.2, 0.55)
    owned.push(photon.material)
    object.add(core, disc, photon)
    // Fed from a companion, the disc is brighter still.
    glow = photon
  } else {
    const material = surfaceMaterial(color, seed, recipe)
    owned.push(material)
    animated.push(material)
    core = new Mesh(parts.sphere, material)
    object.add(core)
    glow = glowSprite(color, recipe.glow, recipe.glowOpacity ?? 0.9)
    owned.push(glow.material)
    object.add(glow)
    if (recipe.wind) {
      const shell = windShell(color, seed, 2.4, recipe.wind)
      owned.push(shell.material)
      object.add(shell)
    }
    if (recipe.disc === 'dusty') {
      const disc = accretionDisc(STAR_PARTS.dustHot, STAR_PARTS.dustCool, seed, { doppler: 0.15, geometry: parts.dusty, inner: 1.8, outer: 12 })
      disc.rotation.x = -Math.PI / 2 + 0.3
      owned.push(disc.material)
      animated.push(disc.material)
      object.add(disc)
    }
    if (recipe.jets) {
      const jets = beams(STAR_PARTS.jet, 0.45)
      jets.scale.set(0.35, 0.9, 0.35)
      jets.rotation.x = 0.3
      owned.push(jets.children[0].material)
      object.add(jets)
    }
  }

  // A pulsar's beams sweep round its spin axis, which leans from its magnetic one.
  let spinner = null
  if (recipe.beams || recipe.loops) {
    spinner = new Group()
    spinner.rotation.z = 0.5
    if (recipe.beams) {
      const sweep = beams(STAR_PARTS.pulsarBeam, 0.75)
      owned.push(sweep.children[0].material)
      spinner.add(sweep)
    }
    if (recipe.loops) {
      const loopMaterial = new MeshBasicMaterial({ color: new Color(STAR_PARTS.fieldLine), transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false })
      owned.push(loopMaterial)
      for (let index = 0; index < 6; index += 1) {
        const loop = new Mesh(parts.loop, loopMaterial)
        loop.rotation.y = (index / 6) * Math.PI
        loop.scale.set(1, 1.6, 1)
        spinner.add(loop)
      }
    }
    object.add(spinner)
  }

  const spinPerDay = body.star?.spinSeconds ? Math.min(40, 2 + 1 / body.star.spinSeconds) : 0
  return {
    object,
    core,
    look,
    color,
    /** Draw it `radius` scene units across (its true size, or a few pixels' worth). */
    setRadius(radius) {
      object.scale.setScalar(radius)
    },
    update(day) {
      for (const material of animated) material.uniforms.uTime.value = day
      if (spinner) spinner.rotation.y = (day * spinPerDay) % (Math.PI * 2)
      if (body.star?.variable) {
        const pulse = variableAt(body.star, day)
        core.scale.setScalar(pulse.radius)
        if (core.material.uniforms?.uBrightness) core.material.uniforms.uBrightness.value = 1.15 * pulse.brightness
        if (glow) glow.material.opacity = Math.min(1, 0.9 * pulse.brightness)
      }
    },
    dispose() {
      for (const material of owned) material.dispose()
    },
  }
}
