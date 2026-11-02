#!/usr/bin/env node
/**
 * private-writing.mjs — Claude Code's PreToolUse hook (.claude/settings.json) that keeps
 * the writer's own documents out of every session. Their projects are personal
 * writing: no tool may read, search, list into, copy or edit them. The rule in
 * CLAUDE.md says the same; this hook is what enforces it, for subagents too.
 *
 * Protected:
 *   - Inkblot's app data folder on every platform (`com.inkblot.app`): the default
 *     projects, preferences (which hold excerpts), stats and version history
 *   - every project folder the writer linked elsewhere, read from the location
 *     registry in that folder (`.inkblot-project-locations.json`); its paths are read
 *     here, never printed
 *
 * Allowed: a plain `ls` of the app data folder itself, which shows project names and
 * nothing inside them. Everything else touching a protected path is blocked (exit 2,
 * reason on stderr), as is a recursive search that starts at the home folder or the
 * disk root, which would walk into them. Development uses the in-memory mock
 * (`/?mock`) and the test fixtures instead.
 *
 * Unlike the other hooks, an unexpected input blocks rather than passes when it names
 * the app's identifier: failing open here would leak the very data it guards.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = os.homedir()
const ID = 'com.inkblot.app'
const APP_DATA = [
  path.join(HOME, 'Library/Application Support', ID),
  path.join(HOME, '.local/share', ID),
  path.join(HOME, '.config', ID),
  process.env.APPDATA && path.join(process.env.APPDATA, ID),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, ID),
].filter(Boolean)

function linkedProjects() {
  const dirs = []
  for (const root of APP_DATA) {
    try {
      const registry = JSON.parse(fs.readFileSync(path.join(root, '.inkblot-project-locations.json'), 'utf8'))
      for (const dir of Object.values(registry)) if (typeof dir === 'string' && dir) dirs.push(dir)
    } catch {
      // No registry on this platform's path.
    }
  }
  return dirs
}

const strip = (dir) => dir.replace(/[\\/]+$/, '')
const PROTECTED = [...APP_DATA, ...linkedProjects()].map(strip)

const REASON =
  "Blocked: that path holds the writer's own documents (Inkblot projects and app data). " +
  'Never read, search, copy or edit them. Use the in-memory mock (`/?mock`, scripts/dev/tauri-mock.js) ' +
  "or the test fixtures. Only a plain `ls` of the app data folder, for project names, is allowed."

const block = () => {
  console.error(REASON)
  process.exit(2)
}

let input
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'))
} catch {
  process.exit(0)
}
const tool = input.tool_name
const args = input.tool_input ?? {}
const cwd = input.cwd || process.cwd()

const expand = (value) => {
  let out = String(value).replace(/^~(?=$|[\\/])/, HOME).replace(/\$HOME|\$\{HOME\}/g, HOME)
  if (!path.isAbsolute(out)) out = path.resolve(cwd, out)
  return strip(out)
}
/**
 * A command's simple commands, each as its words with quotes removed: split on
 * unquoted `|`, `||`, `&&`, `;`, `&`, newlines and `$(`, so a quoted regex such as
 * `'^  // |x'` stays one word. Heredoc bodies come out as words too, which is harmless:
 * only a segment's first word decides whether it is a search.
 */
function shellSegments(text) {
  const segments = [[]]
  let word = null
  let quote = null
  const end = () => {
    if (word !== null) segments.at(-1).push(word)
    word = null
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && i + 1 < text.length) word += text[++i]
      else word += c
    } else if (c === "'" || c === '"') {
      quote = c
      word ??= ''
    } else if (c === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[++i]
    } else if (/\s/.test(c) && c !== '\n') {
      end()
    } else if (c === '\n' || c === ';' || c === '|' || c === '&' || (c === '$' && text[i + 1] === '(')) {
      end()
      if (c === '$') i++
      if (segments.at(-1).length) segments.push([])
    } else {
      word = (word ?? '') + c
    }
  }
  end()
  return segments.filter((segment) => segment.length)
}

const inside = (target) => PROTECTED.some((root) => target === root || target.startsWith(root + path.sep) || target.startsWith(root + '/'))
const names = (text) => text.includes(ID) || PROTECTED.some((root) => text.includes(root) || text.includes(root.replace(HOME, '~')))
// In a shell command the identifier counts only as a path or a bare word: beside a
// separator (`…/com.inkblot.app`, `com.inkblot.app/…`) or standing alone (`cd
// com.inkblot.app`). In prose being written to a repo file it's usually in backticks.
const PATH_LIKE = /[\\/]com\.inkblot\.app|com\.inkblot\.app[\\/]|(^|[\s"'=])com\.inkblot\.app(["']|\s|$)/
const commandNames = (text) => PATH_LIKE.test(text) || PROTECTED.some((root) => text.includes(root) || text.includes(root.replace(HOME, '~')))

if (tool === 'Bash') {
  const command = String(args.command ?? '')

  // A recursive search rooted at home or / walks into the protected folders. Judged per
  // shell segment, on the segment's own command word, so prose in a heredoc ("grep for
  // it … a / b") isn't mistaken for a search.
  const SEARCH = new Set(['rg', 'grep', 'egrep', 'find', 'fd', 'ag', 'ack', 'du', 'tree', 'ls'])
  const ROOT = /^(~|\$HOME|\$\{HOME\}|\/|\/Users(\/[^/\s]+)?|\/home(\/[^/\s]+)?)\/?$/
  for (const words of shellSegments(command)) {
    while (words.length && (/^\w+=/.test(words[0]) || ['sudo', 'xargs', 'command', 'time', 'nice', 'env'].includes(words[0]))) words.shift()
    if (!SEARCH.has(words[0])) continue
    const recursive = words[0] !== 'ls' || words.some((word) => /^-[a-zA-Z]*R/.test(word))
    if (recursive && words.slice(1).some((word) => ROOT.test(word) || expand(word) === HOME)) block()
  }

  if (!commandNames(command)) process.exit(0)

  // The one allowed form: `ls [-1aAF]` of a protected root itself, alone.
  const listing = command.trim().match(/^ls(\s+-[1aAFp]+)*\s+(['"]?)(.+?)\2\s*$/)
  if (listing && PROTECTED.includes(expand(listing[3]))) process.exit(0)
  block()
}

// File tools: every argument that can carry a path.
for (const key of ['file_path', 'path', 'notebook_path', 'pattern', 'glob']) {
  // Grep's pattern is the text searched for, not a place; Glob's is a path.
  if (key === 'pattern' && tool === 'Grep') continue
  const value = args[key]
  if (typeof value !== 'string' || !value) continue
  if (names(value)) block()
  if (key !== 'pattern' && key !== 'glob' && inside(expand(value))) block()
  if ((key === 'pattern' || key === 'glob') && path.isAbsolute(value.replace(/^~/, HOME)) && inside(expand(value.split('*')[0] || '/'))) block()
}
// A Grep or Glob with no path searches the working directory; started from home or /,
// that would reach the protected folders.
if ((tool === 'Grep' || tool === 'Glob') && !args.path && [HOME, '/'].includes(strip(cwd) || '/')) block()
