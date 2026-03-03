import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_REPOS = [
  process.env.RHYME_REPO,
  'g3vin/inkblot-nlp-model',
  'g3vin/inkblot-nlp-models',
].filter(Boolean)

const REPO_REF = process.env.RHYME_REF || 'main'
const TARGET_DIR = process.env.RHYME_DIR || path.join(__dirname, '..', 'public')
const ASSETS = [
  'rhyme_model.onnx',
  'vocab.json',
]

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const downloadFile = async (url, outPath) => {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to download asset: ${res.status} ${res.statusText}`)
  }
  ensureDir(path.dirname(outPath))
  const fileStream = fs.createWriteStream(outPath)
  await pipeline(res.body, fileStream)
}

const downloadFromRepo = async (repo, asset, outPath) => {
  const rawUrl = `https://raw.githubusercontent.com/${repo}/${REPO_REF}/${asset}`
  console.log(`Trying ${repo} for ${asset}`)
  await downloadFile(rawUrl, outPath)
}

const main = async () => {
  for (const asset of ASSETS) {
    const outPath = path.join(TARGET_DIR, asset)

    if (fs.existsSync(outPath)) {
      console.log(`${asset} already exists at ${outPath}, skipping`)
      continue
    }

    let downloaded = false
    let lastErr = null

    for (const repo of DEFAULT_REPOS) {
      try {
        console.log(`Fetching ${asset} from ${repo}...`)
        await downloadFromRepo(repo, asset, outPath)
        console.log(`Downloaded ${asset} from ${repo}`)
        downloaded = true
        break
      } catch (err) {
        lastErr = err
        console.warn(`Failed to download ${asset} from ${repo}: ${err.message || err}`)
      }
    }

    if (!downloaded) {
      if (lastErr) throw lastErr
      throw new Error(`No rhyme repo configured to provide ${asset}`)
    }
  }

  console.log('Rhyme model downloads complete')
}

main().catch(err => {
  console.warn('Rhyme model download failed; continuing without rhyme model:', err?.message || err)
  // Do not exit with non-zero status during dev; missing rhyme model is optional for development.
})
