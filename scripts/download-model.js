import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { spawnSync } from 'child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const REPO = process.env.MODEL_REPO || 'g3vin/inkblot-nlp-models'
const ASSET_NAME = process.env.MODEL_ASSET_NAME || 'pos_context_tagger.onnx'
const ASSET_REGEX = process.env.MODEL_ASSET_REGEX || ''
const DEFAULT_ASSETS = [
  'pos_context_tagger.onnx',
  'pos_context_meta.json',
]

const ASSET_LIST = (process.env.MODEL_ASSETS || DEFAULT_ASSETS.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
const TOKEN = process.env.GITHUB_TOKEN || ''
const TARGET_DIR = process.env.MODEL_DIR || path.join(__dirname, '..', 'src-tauri', 'assets')

const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const API_URL_LIST = `https://api.github.com/repos/${REPO}/releases`
const REPO_REF = process.env.MODEL_REF || 'main'
const REPO_PATH = process.env.MODEL_PATH || ''

const headers = {
  'User-Agent': 'inkblot-model-downloader',
  'Accept': 'application/vnd.github+json',
}
if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true })
}

const pickAsset = (assets) => {
  if (!assets?.length) return null
  if (ASSET_NAME) return assets.find(a => a.name === ASSET_NAME) || null
  if (ASSET_REGEX) {
    const regex = new RegExp(ASSET_REGEX)
    return assets.find(a => regex.test(a.name)) || null
  }
  if (assets.length === 1) return assets[0]
  return assets.find(a => /model|weights|onnx|bin|pt|pth|zip|tar\.gz|tgz/i.test(a.name)) || assets[0]
}

const pickAssetsByList = (assets, list) => {
  return list
    .map((key) => {
      const regex = new RegExp(key, 'i')
      return {
        key,
        asset: assets.find(a => regex.test(a.name)) || null,
      }
    })
    .filter(entry => entry.asset)
}

const downloadFile = async (url, outPath) => {
  if (fs.existsSync(outPath)) {
    console.log(`Using existing file: ${outPath}`)
    return
  }
  const res = await fetch(url, { headers })
  if (!res.ok) {
    throw new Error(`Failed to download asset: ${res.status} ${res.statusText}`)
  }
  ensureDir(path.dirname(outPath))
  const fileStream = fs.createWriteStream(outPath)
  await pipeline(res.body, fileStream)
}

const extractIfArchive = (filePath, destDir) => {
  if (filePath.endsWith('.zip')) {
    const result = spawnSync('unzip', ['-o', filePath, '-d', destDir], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Failed to unzip model archive')
    return true
  }
  if (filePath.endsWith('.tar.gz') || filePath.endsWith('.tgz')) {
    const result = spawnSync('tar', ['-xzf', filePath, '-C', destDir], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('Failed to extract tar.gz model archive')
    return true
  }
  return false
}

const fetchLatestRelease = async () => {
  const res = await fetch(API_URL, { headers })
  if (res.ok) return res.json()

  if (res.status === 404) {
    const listRes = await fetch(API_URL_LIST, { headers })
    if (listRes.ok) {
      const list = await listRes.json()
      if (Array.isArray(list) && list.length) {
        return list[0]
      }
    }
  }

  const hint = (!TOKEN && res.status === 404)
    ? ' (repo may be private — set GITHUB_TOKEN)'
    : ''
  throw new Error(`Failed to fetch release: ${res.status} ${res.statusText}${hint}`)
}

const downloadRawAssets = async (assets) => {
  ensureDir(TARGET_DIR)

  for (const assetName of assets) {
    const prefix = REPO_PATH ? `${REPO_PATH.replace(/\/$/, '')}/` : ''
    const rawUrl = `https://raw.githubusercontent.com/${REPO}/${REPO_REF}/${prefix}${assetName}`
    const outPath = path.join(TARGET_DIR, assetName)
    console.log(`Downloading ${assetName} -> ${outPath}`)
    await downloadFile(rawUrl, outPath)
  }
}

const main = async () => {
  console.log(`Fetching latest release from ${REPO}...`)
  let release = null
  try {
    release = await fetchLatestRelease()
  } catch (err) {
    console.warn(String(err))
    release = null
  }

  if (!release) {
    console.log('No releases found. Falling back to raw GitHub files...')
    const fallbackList = ASSET_LIST.length ? ASSET_LIST : [ASSET_NAME]
    await downloadRawAssets(fallbackList)
    console.log('Model downloads complete')
    return
  }

  if (ASSET_LIST.length) {
    const picks = pickAssetsByList(release.assets, ASSET_LIST)
    if (!picks.length) {
      console.log('No matching release assets found for MODEL_ASSETS. Falling back to raw files...')
      await downloadRawAssets(ASSET_LIST)
      console.log('Model downloads complete')
      return
    }

    for (const { key, asset } of picks) {
      ensureDir(TARGET_DIR)
      const outPath = path.join(TARGET_DIR, asset.name)
      console.log(`Downloading ${asset.name} -> ${outPath}`)
      await downloadFile(asset.browser_download_url, outPath)

      const extracted = extractIfArchive(outPath, TARGET_DIR)
      if (extracted) {
        console.log(`Model archive extracted for ${key}`)
      }
    }

    console.log('Model downloads complete')
    return
  }

  const asset = pickAsset(release.assets)
  if (!asset) {
    console.log('No assets found in latest release. Falling back to raw files...')
    await downloadRawAssets([ASSET_NAME])
    console.log('Model download complete')
    return
  }

  ensureDir(TARGET_DIR)
  const outPath = path.join(TARGET_DIR, asset.name)

  console.log(`Downloading ${asset.name} -> ${outPath}`)
  await downloadFile(asset.browser_download_url, outPath)

  const extracted = extractIfArchive(outPath, TARGET_DIR)
  if (extracted) {
    console.log('Model archive extracted')
  }

  console.log('Model download complete')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
