/**
 * importScript.js — File ▸ Import Fountain Script…: a .fountain file (or a plain-text
 * script written in it) becomes a new document beside the one open, written as a
 * screenplay and set on the screenplay page, so it prints as a script straight away.
 */
import { open } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'

import { documentExists, writeDocumentRaw } from '../lib/FileSystem'
import { nameForKind } from '../lib/createDocument'
import { applyFormat } from '../print/formats'
import { parseFountain } from './fountain'

const stemOf = (path) => path.replace(/^.*[/\\]/, '').replace(/\.[^.]+$/, '')
const folderOf = (docPath) => (docPath && docPath.includes('/') ? docPath.replace(/\/[^/]*$/, '') : '')
const safeName = (name) => String(name || '').replace(/[/\\:*?"<>|]+/g, '-').trim()

/**
 * Ask for a script, and make a document of it in the folder `nearDoc` is in. Resolves
 * to the new document's path, or null when nothing was picked.
 */
export async function importFountainScript({ projectName, nearDoc }) {
  if (!projectName) return null
  const picked = await open({
    title: 'Import Fountain script',
    multiple: false,
    directory: false,
    filters: [{ name: 'Fountain', extensions: ['fountain', 'spmd', 'txt'] }],
  })
  const file = Array.isArray(picked) ? picked[0] : picked
  if (!file) return null

  const { titlePage, doc } = parseFountain(await readTextFile(file))
  doc.attrs = { ...doc.attrs, pageSetup: applyFormat('screenplay') }

  // Named for its title, or the file; never over a document already there.
  const folder = folderOf(nearDoc)
  const base = safeName(titlePage.title) || safeName(stemOf(file)) || 'Imported Script'
  const pathFor = (n) => nameForKind(`${folder ? `${folder}/` : ''}${base}${n > 1 ? ` ${n}` : ''}`, 'doc')
  let n = 1
  while (await documentExists(projectName, pathFor(n))) n += 1
  const path = pathFor(n)
  await writeDocumentRaw(projectName, path, { content: doc, notes: [] })
  return path
}
