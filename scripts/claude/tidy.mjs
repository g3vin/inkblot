#!/usr/bin/env node
/**
 * tidy.mjs — the bookkeeping behind the `tidy` skill (.claude/skills/tidy/SKILL.md):
 * what code changed since the last tidy, so each pass reviews only new work.
 *
 *   diff [path…]   the code diff to review, since the last tidy or since HEAD,
 *                  whichever is smaller (a commit or a branch switch since the last tidy
 *                  makes HEAD the closer base)
 *   mark           record the working tree as tidied
 *   stop           Claude Code's Stop hook (.claude/settings.json): when this session
 *                  edited files and enough code changed since the last tidy, block the
 *                  stop once and ask for the pass
 *
 * A snapshot is a git tree of the whole working tree, untracked files included, written
 * through a throwaway copy of the index so the real index and the stash are untouched.
 * Its id lives in the git dir, so it is per worktree and never committed.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..')
// Below this many changed lines a pass costs more than it finds.
const MIN_LINES = 10
const CODE = ['*.js', '*.jsx', '*.ts', '*.tsx', '*.mjs', '*.rs', '*.css', ':(exclude)src/types/inkblot-core.ts']

const git = (args, env) =>
  execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 << 20 })
const gitDir = git(['rev-parse', '--absolute-git-dir']).trim()
const MARK = path.join(gitDir, 'inkblot-tidy')

function snapshot() {
  const index = path.join(gitDir, 'inkblot-tidy-index')
  fs.copyFileSync(path.join(gitDir, 'index'), index)
  git(['add', '-A'], { GIT_INDEX_FILE: index })
  return git(['write-tree'], { GIT_INDEX_FILE: index }).trim()
}

const changedLines = (base, tree, paths) =>
  git(['diff', '--numstat', base, tree, '--', ...paths])
    .split('\n')
    .reduce((total, line) => total + (Number(line.split('\t')[0]) || 0) + (Number(line.split('\t')[1]) || 0), 0)

/** The closer of the last tidy and HEAD, with how many code lines changed since it. */
function base(tree, paths = CODE) {
  const bases = ['HEAD^{tree}']
  try {
    const mark = fs.readFileSync(MARK, 'utf8').trim()
    git(['cat-file', '-e', mark])
    bases.push(mark)
  } catch {
    // No tidy yet in this worktree, or its tree was garbage-collected.
  }
  return bases
    .map((ref) => ({ ref, lines: changedLines(ref, tree, paths) }))
    .sort((a, b) => a.lines - b.lines)[0]
}

function diff(paths) {
  const scoped = paths.length ? [...paths, ...CODE.filter((spec) => spec.startsWith(':'))] : CODE
  const tree = snapshot()
  const { ref, lines } = base(tree, scoped)
  if (!lines) {
    console.log('Nothing to tidy: no code changed since the last tidy.')
    return
  }
  const since = ref.startsWith('HEAD') ? 'HEAD' : 'the last tidy'
  console.log(`${lines} changed lines since ${since}.\n`)
  process.stdout.write(git(['diff', '--stat=100', ref, tree, '--', ...scoped]))
  process.stdout.write(`\n${git(['diff', ref, tree, '--', ...scoped])}`)
}

function mark() {
  fs.writeFileSync(MARK, `${snapshot()}\n`)
}

function stop() {
  let input
  try {
    input = JSON.parse(fs.readFileSync(0, 'utf8'))
  } catch {
    return
  }
  // Already asked once this stop: never hold the session in a loop.
  if (input.stop_hook_active) return
  try {
    const transcript = fs.readFileSync(input.transcript_path, 'utf8')
    if (!/"name":\s*"(Edit|Write|MultiEdit|NotebookEdit)"/.test(transcript)) return
  } catch {
    // No transcript to check: fall through to the diff, which still gates the ask.
  }
  const { lines } = base(snapshot())
  if (lines < MIN_LINES) return
  console.log(JSON.stringify({
    decision: 'block',
    reason:
      `${lines} lines of code changed since the last tidy. If the change is finished, run the ` +
      'tidy skill, then give your report. If it is not (you are waiting on the user, or ' +
      'stopping midway), say so in one line and stop.',
  }))
}

const [command, ...args] = process.argv.slice(2)
try {
  if (command === 'diff') diff(args)
  else if (command === 'mark') mark()
  else if (command === 'stop') stop()
  else {
    console.error('Usage: tidy.mjs diff [path…] | mark | stop')
    process.exit(1)
  }
} catch (error) {
  // A broken hook must never block a session; the other commands report the failure.
  if (command === 'stop') process.exit(0)
  throw error
}
