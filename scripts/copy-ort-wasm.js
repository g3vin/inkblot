import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const SRC_DIR = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist')
const DEST_DIR = path.join(__dirname, '..', 'public', 'ort')

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const copyFile = (src, dest) => {
  fs.copyFileSync(src, dest)
}

const main = () => {
  if (!fs.existsSync(SRC_DIR)) {
    throw new Error(`onnxruntime-web dist not found at ${SRC_DIR}`)
  }

  ensureDir(DEST_DIR)

  const files = fs.readdirSync(SRC_DIR)
    .filter(name => /\.(wasm|mjs|js)$/.test(name))

  if (!files.length) {
    throw new Error('No wasm assets found in onnxruntime-web/dist')
  }

  for (const file of files) {
    const srcPath = path.join(SRC_DIR, file)
    const destPath = path.join(DEST_DIR, file)
    copyFile(srcPath, destPath)
  }

  console.log(`Copied ${files.length} ONNX Runtime wasm assets to ${DEST_DIR}`)
}

try {
  main()
} catch (err) {
  console.error(err)
  process.exit(1)
}
