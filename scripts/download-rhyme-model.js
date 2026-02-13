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

const downloadFromRepo = async (repo) => {
  for (const asset of ASSETS) {
    const rawUrl = `https://raw.githubusercontent.com/${repo}/${REPO_REF}/${asset}`
    const outPath = path.join(TARGET_DIR, asset)
    console.log(`Downloading ${asset} -> ${outPath}`)
    await downloadFile(rawUrl, outPath)
  }
}

const main = async () => {
  let lastError = null

  for (const repo of DEFAULT_REPOS) {
    try {
      console.log(`Fetching rhyme assets from ${repo}...`)
      await downloadFromRepo(repo)
      console.log('Rhyme model downloads complete')
      return
    } catch (err) {
      lastError = err
      console.warn(`Failed to download from ${repo}: ${err.message || err}`)
    }
  }

  if (lastError) {
    throw lastError
  }

  throw new Error('No rhyme repo configured')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
