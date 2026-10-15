/**
 * galaxyPicture.js — a small picture of a galaxy, from the generator: for the setup
 * gallery's thumbnails and for the impostors a group of galaxies is drawn with.
 *
 * Light is summed per pixel and tone-mapped (1 − e^−x), so a dense core saturates
 * softly instead of clipping, then softened with a blur.
 */
import { generateGalaxy } from './galaxyGen'

/**
 * Paint the galaxy of `type` and `seed` into `canvas` (square), seen tilted by
 * `tilt` radians from face-on. Transparent where there is no light.
 */
export function paintGalaxy(canvas, type, seed, { tilt = 0, count = 9000, gain = 0.18 } = {}) {
  const size = canvas.width
  const context = canvas.getContext('2d')
  const result = generateGalaxy({ type, seed, radiusLy: 50000, thicknessLy: 1000 }, { count })
  const half = size / 2
  const light = new Float32Array(size * size * 3)
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)
  for (let index = 0; index < result.count; index += 1) {
    const px = result.positions[index * 3]
    const py = result.positions[index * 3 + 1] * cos - result.positions[index * 3 + 2] * sin
    const x = Math.round(half + (px / 50000) * half * 0.95)
    const y = Math.round(half + (py / 50000) * half * 0.95)
    if (x < 0 || y < 0 || x >= size || y >= size) continue
    const at = (y * size + x) * 3
    const weight = result.sizes[index] * gain * (size / 128) ** 2
    light[at] += result.colors[index * 3] * weight
    light[at + 1] += result.colors[index * 3 + 1] * weight
    light[at + 2] += result.colors[index * 3 + 2] * weight
  }
  const image = context.createImageData(size, size)
  for (let index = 0; index < size * size; index += 1) {
    const r = 1 - Math.exp(-light[index * 3])
    const g = 1 - Math.exp(-light[index * 3 + 1])
    const b = 1 - Math.exp(-light[index * 3 + 2])
    image.data[index * 4] = r * 255
    image.data[index * 4 + 1] = g * 255
    image.data[index * 4 + 2] = b * 255
    image.data[index * 4 + 3] = Math.max(r, g, b) * 255
  }
  context.clearRect(0, 0, size, size)
  context.putImageData(image, 0, 0)
  context.globalCompositeOperation = 'lighter'
  context.filter = `blur(${Math.max(1, size / 96)}px)`
  context.drawImage(canvas, 0, 0)
  context.filter = 'none'
  context.globalCompositeOperation = 'source-over'
}
