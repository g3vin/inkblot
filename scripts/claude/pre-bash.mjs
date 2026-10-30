#!/usr/bin/env node
/**
 * pre-bash.mjs — Claude Code's PreToolUse hook (.claude/settings.json) for Bash: stops
 * the two shell commands that flood a session's context.
 *
 *   grep -r / -R      walks dist/, showcase/.dist/ and the one-line data files that
 *                     .gitignore and .ignore keep out of ripgrep; one match in a
 *                     minified bundle prints tens of kilobytes
 *   cat/head/tail …   on a multi-megabyte, single-line data file
 *
 * A blocked command exits 2 with the reason on stderr, which Claude Code hands back to
 * the model. Anything unexpected exits 0, so a broken hook never blocks work.
 */
import fs from 'node:fs'

let command
try {
  command = JSON.parse(fs.readFileSync(0, 'utf8')).tool_input?.command
} catch {
  process.exit(0)
}
if (typeof command !== 'string') process.exit(0)

const block = (reason) => {
  console.error(reason)
  process.exit(2)
}

// Each segment of a pipeline or command list, so `git grep -r` and `rg … | grep -v` pass.
for (const segment of command.split(/&&|\|\||[|;\n]/)) {
  const words = segment.trim().split(/\s+/)
  const at = words.findIndex((word) => /^(e|f)?grep$/.test(word))
  if (at < 0 || words[at - 1] === 'git') continue
  const flags = words.slice(at + 1).filter((word) => word.startsWith('-'))
  const recursive = flags.some((flag) => flag === '--recursive' || /^-[a-zA-Z]*[rR]/.test(flag))
  if (recursive && !flags.some((flag) => flag.startsWith('--exclude-dir'))) {
    block(
      'Recursive grep walks build output and data files that .gitignore and .ignore exclude. ' +
        'Use the Grep tool, or `rg <pattern> <path>` (always pass a path: rg reads stdin when it has none).',
    )
  }
}

// head and tail are fine on the generated types (they're line-based); on a one-line file
// they still print megabytes.
const ONE_LINE = /minilm-tokenizer\.json/
const GENERATED = /src\/types\/inkblot-core\.ts/
if (
  (/\b(cat|head|tail|less|more|bat)\b/.test(command) && ONE_LINE.test(command)) ||
  (/\b(cat|less|more|bat)\b/.test(command) && GENERATED.test(command))
) {
  block(
    'That file is huge (a single multi-megabyte line, or 5,000 generated lines). ' +
      'Search it with `rg -o` and a narrow pattern, or read the Rust type it was generated from.',
  )
}
