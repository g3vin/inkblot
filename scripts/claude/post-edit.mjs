#!/usr/bin/env node
/**
 * post-edit.mjs — Claude Code's PostToolUse hook (.claude/settings.json) for Edit and
 * Write: format or lint the one file just changed, so a style failure surfaces at
 * the edit that caused it rather than at the commit.
 *
 *   .rs                 rustfmt, in place (silent)
 *   .js .jsx .ts .tsx   eslint --fix on the file; what it can't fix is reported
 *   .css .jsx .tsx …    the design lint (repo-wide but fast) when the file is in src/
 *   any source file     the size lint (scripts/lint-size.mjs): over 700 lines and its
 *                       baseline, it is reported so the split happens now, not at review
 *
 * Silent when all is well. Problems go to stderr with exit code 2, which Claude Code
 * hands back to the model; any other failure (a missing tool) exits 0 so a broken
 * toolchain never blocks an edit.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { countLines, sizeVerdict } from '../lint-size.mjs'

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')

let file
try {
  file = JSON.parse(fs.readFileSync(0, 'utf8')).tool_input?.file_path
} catch {
  process.exit(0)
}
if (!file || !fs.existsSync(file)) process.exit(0)
const rel = path.relative(repo, file)
if (rel.startsWith('..') || /(^|\/)(node_modules|target|dist)\//.test(rel)) process.exit(0)

const run = (command, args) => spawnSync(command, args, { cwd: repo, encoding: 'utf8' })
const problems = []

if (rel.endsWith('.rs')) {
  // Same edition as src-tauri/Cargo.toml, so rustfmt agrees with `cargo fmt`.
  const result = run('rustfmt', ['--edition', '2021', file])
  if (result.status && result.stderr) problems.push(`rustfmt:\n${result.stderr.trim()}`)
}

if (/\.(jsx?|tsx?|mjs)$/.test(rel)) {
  const result = run('npx', ['--no-install', 'eslint', '--fix', '--max-warnings', '0', file])
  if (result.status === 1) problems.push(`eslint:\n${result.stdout.trim()}`)
}

if (rel.startsWith('src/') && /\.(css|jsx?|tsx?)$/.test(rel)) {
  const result = run('node', ['scripts/lint-design.mjs'])
  if (result.status) problems.push(`lint:design:\n${(result.stdout + result.stderr).trim()}`)
}

const tooBig = sizeVerdict(rel.split(path.sep).join('/'), countLines(fs.readFileSync(file, 'utf8')))
if (tooBig) problems.push(`lint:size:\n${tooBig} See .claude/rules/file-size.md.`)

if (problems.length) {
  console.error(`${rel}\n${problems.join('\n\n')}`)
  process.exit(2)
}
