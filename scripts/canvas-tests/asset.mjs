import { files } from './stub-fs.mjs'
const L = '../../src/lib'
const { writeAsset, writeAssetFromFile, importAssetFromPath, assetUrl, isImagePath, isAssetPath, extensionOf } = await import(`${L}/assets.js`)
const ok = (l, c) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`); if (!c) process.exitCode = 1 }
const P = 'Novel'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5])
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 9, 9, 9])

const a = await writeAsset(P, png, 'png')
ok('asset lands under .assets/', a.startsWith('.assets/') && a.endsWith('.png'))
ok('file actually written', files.has(`/appdata/Novel/${a}`))
ok('filename is the content hash', /^\.assets\/[0-9a-f]{20}\.png$/.test(a))

// THE property: same bytes -> same path, written once.
const before = files.size
const a2 = await writeAsset(P, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5]), 'png')
ok('identical bytes dedupe to the same path', a2 === a)
ok('identical bytes write no second file', files.size === before)

const b = await writeAsset(P, jpg, 'jpg')
ok('different bytes -> different path', b !== a)
ok('extension preserved', b.endsWith('.jpg'))

// paths are project-relative, so a project can be moved or synced
ok('stored path is project-relative', !a.startsWith('/') && !a.includes('appdata'))
ok('isAssetPath recognises it', isAssetPath(a) && !isAssetPath('Chapters/One.json'))

// importing a file already on disk (the Finder-drag path)
files.set('/Users/gavin/Desktop/photo.jpeg', jpg)
const c = await importAssetFromPath(P, '/Users/gavin/Desktop/photo.jpeg')
ok('imported from disk', c.startsWith('.assets/'))
ok('jpeg normalised to jpg', c.endsWith('.jpg'))
ok('imported file dedupes against identical pasted bytes', c === b)

// a paste arrives as a File/Blob
const fakeFile = { type: 'image/webp', name: 'x.webp', arrayBuffer: async () => new Uint8Array([1,2,3]).buffer }
const d = await writeAssetFromFile(P, fakeFile)
ok('mime type maps to extension', d.endsWith('.webp'))

// URL goes through the asset protocol, and resolves to the absolute path
const url = await assetUrl(P, a)
ok('assetUrl uses the asset protocol', url.startsWith('asset://'))
ok('assetUrl points at the absolute file', decodeURIComponent(url).includes(`/appdata/Novel/${a}`))
ok('assetUrl is cached (stable across calls)', (await assetUrl(P, a)) === url)

// extension sniffing used to decide what to import
ok('isImagePath: png', isImagePath('a/b.PNG'))
ok('isImagePath: rejects non-images', !isImagePath('notes.txt') && !isImagePath('doc.json'))
ok('extensionOf lowercases', extensionOf('X.JPG') === 'jpg')
