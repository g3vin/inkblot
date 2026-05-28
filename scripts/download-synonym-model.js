import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_REPOS = [
  process.env.SYNONYM_REPO,
  'g3vin/inkblot-nlp-models',
].filter(Boolean)

const REPO_REF = process.env.SYNONYM_REF || 'main'
const TARGET_DIR = process.env.SYNONYM_DIR || path.join(__dirname, '..', 'public')
const ASSET = process.env.SYNONYM_ASSET || 'synonym.onnx'
const META_FILE = path.join(TARGET_DIR, '.synonym_meta.json')

const TOKEN = process.env.GITHUB_TOKEN || ''

const makeHeaders = (extra = {}) => {
  const base = { 'User-Agent': 'inkblot-synonym-downloader', 'Accept': 'application/vnd.github+json' }
  if (TOKEN) base.Authorization = `Bearer ${TOKEN}`
  return { ...base, ...extra }
}

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const loadMeta = () => {
  try {
    if (fs.existsSync(META_FILE)) return JSON.parse(fs.readFileSync(META_FILE, 'utf8'))
  } catch (e) {
    // ignore
  }
  return {}
}

const saveMeta = (meta) => {
  try {
    ensureDir(path.dirname(META_FILE))
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), 'utf8')
  } catch (e) {
    console.warn('Failed to save synonym metadata:', e?.message || e)
  }
}

const downloadFile = async (url, outPath) => {
  const res = await fetch(url, { headers: makeHeaders({ Accept: '*/*' }) })
  if (!res.ok) throw new Error(`Failed to download asset: ${res.status} ${res.statusText}`)
  ensureDir(path.dirname(outPath))
  const fileStream = fs.createWriteStream(outPath)
  await pipeline(res.body, fileStream)
}

const fetchLatestRelease = async (repo) => {
  const API_URL = `https://api.github.com/repos/${repo}/releases/latest`
  const headers = makeHeaders()
  try {
    const res = await fetch(API_URL, { headers })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

const downloadFromRepo = async (repo, meta) => {
  const outPath = path.join(TARGET_DIR, ASSET)

  // 1) Try release asset
  const release = await fetchLatestRelease(repo)
  if (release && Array.isArray(release.assets)) {
    const asset = release.assets.find((a) => a.name === ASSET)
    if (asset) {
      const remoteTag = asset.updated_at || String(asset.id) || asset.browser_download_url
      const have = meta[ASSET]
      if (have && fs.existsSync(outPath) && have === remoteTag) {
        console.log(`Skipping ${ASSET} from ${repo} — release unchanged.`)
        return true
      }

      console.log(`Downloading ${ASSET} from release in ${repo} -> ${outPath}`)
      await downloadFile(asset.browser_download_url, outPath)
      console.log(`Downloaded ${ASSET} from release in ${repo}`)
      meta[ASSET] = remoteTag
      saveMeta(meta)
      return true
    }
  }

  // 2) Download via GitHub contents API (works with LFS)
    const contentsUrl = `https://api.github.com/repos/${repo}/contents/${ASSET}?ref=${REPO_REF}`

    console.log(`Fetching file metadata from ${repo}`)

    const res = await fetch(contentsUrl, { headers: makeHeaders() })
    if (!res.ok) {
    throw new Error(`Failed to fetch file metadata: ${res.status}`)
    }

    const json = await res.json()

    if (!json.download_url) {
    throw new Error('No download_url returned from GitHub API')
    }

    const remoteTag = json.sha

    if (remoteTag && meta[ASSET] && fs.existsSync(outPath) && meta[ASSET] === remoteTag) {
    console.log(`Skipping ${ASSET} from ${repo} — unchanged.`)
    return true
    }

    console.log(`Downloading ${ASSET} from ${json.download_url}`)
    await downloadFile(json.download_url, outPath)

    meta[ASSET] = remoteTag
    saveMeta(meta)

    console.log(`Downloaded ${ASSET} successfully`)
    return true
}

const main = async () => {
  const meta = loadMeta()
  ensureDir(TARGET_DIR)

  for (const repo of DEFAULT_REPOS) {
    try {
      await downloadFromRepo(repo, meta)
      return
    } catch (err) {
      console.warn(`Failed to download ${ASSET} from ${repo}: ${err?.message || err}`)
    }
  }

  throw new Error('Synonym model download failed for all repos')
}

main().catch((err) => {
  console.warn('Synonym model download failed:', err?.message || err)
})
