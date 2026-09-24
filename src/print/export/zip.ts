/**
 * zip.ts — just enough ZIP to write an EPUB.
 *
 * An EPUB is a ZIP with one hard rule: the first entry is `mimetype`, stored (not
 * compressed), with no extra field — readers sniff the first bytes of the file for
 * `mimetypeapplication/epub+zip`. Everything else may be deflated. WebKit ships
 * `CompressionStream('deflate-raw')`, which is exactly ZIP's method 8, so no library
 * is needed; where it is missing, entries are stored, which is still valid.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array | string
  /** Store without compression. Always true for `mimetype`. */
  store?: boolean
}

const encoder = new TextEncoder()

let crcTable: Uint32Array | null = null
const crc32 = (bytes: Uint8Array): number => {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const deflateRaw = async (bytes: Uint8Array): Promise<Uint8Array | null> => {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw' as CompressionFormat))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

/** DOS date/time, as ZIP stores modification times. */
const dosDateTime = (date: Date) => {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export const createZip = async (entries: ZipEntry[], now = new Date()): Promise<Uint8Array> => {
  const { time, day } = dosDateTime(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const raw = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    const crc = crc32(raw)
    const deflated = entry.store ? null : await deflateRaw(raw)
    const useDeflate = Boolean(deflated && deflated.length < raw.length)
    const body = useDeflate ? deflated! : raw
    const method = useDeflate ? 8 : 0

    const local = new Uint8Array(30 + name.length + body.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed: 2.0
    lv.setUint16(6, 0x0800, true) // UTF-8 names
    lv.setUint16(8, method, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, day, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, body.length, true)
    lv.setUint32(22, raw.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true) // no extra field — required for `mimetype`
    local.set(name, 30)
    local.set(body, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, method, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, day, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, body.length, true)
    cv.setUint32(24, raw.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Read a ZIP's entry names and stored bytes back — for tests, not a general reader. */
export const listZip = (bytes: Uint8Array): Array<{ name: string; method: number; offset: number; extraLength: number }> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = []
  let at = 0
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true)
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extraLength = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength))
    out.push({ name, method, offset: at, extraLength })
    at += 30 + nameLength + extraLength + size
  }
  return out
}
