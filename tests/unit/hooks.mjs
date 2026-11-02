/**
 * The Claude Code hooks in scripts/claude/, run as Claude Code runs them (a tool call
 * as JSON on stdin, exit 2 to block): the privacy guard that keeps the writer's own
 * documents out of every session, and the guard against commands that flood one.
 *
 * Paths are built from the home folder and never read: only the hooks' verdicts are
 * checked.
 */
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ok } from './assert.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const HOME = os.homedir()
const APP = `${HOME}/Library/Application Support/com.inkblot.app`

const verdict = (hook, tool_name, tool_input) =>
  spawnSync('node', [path.join(repo, 'scripts/claude', hook)], { input: JSON.stringify({ tool_name, tool_input, cwd: repo }) }).status

const blocks = (label, tool, input, hook = 'private-writing.mjs') => ok(`${hook}: blocks ${label}`, verdict(hook, tool, input) === 2)
const allows = (label, tool, input, hook = 'private-writing.mjs') => ok(`${hook}: allows ${label}`, verdict(hook, tool, input) === 0)

allows('listing the project names', 'Bash', { command: `ls "${APP}"` })
blocks('listing inside a project', 'Bash', { command: `ls "${APP}/A novel"` })
blocks('a recursive listing', 'Bash', { command: `ls -R "${APP}"` })
blocks('reading the preferences (they hold excerpts)', 'Bash', { command: `cat "${APP}/preferences.json"` })
blocks('an escaped path', 'Bash', { command: 'cat ~/Library/Application\\ Support/com.inkblot.app/preferences.json' })
blocks('a relative path after cd', 'Bash', { command: 'cd ~/Library/Application\\ Support && cat com.inkblot.app/preferences.json' })
blocks('copying the folder away', 'Bash', { command: `cp -r "${APP}" /tmp/x` })
blocks('a search from home', 'Bash', { command: 'rg secret ~' })
blocks('a search from the home path', 'Bash', { command: `rg foo "${HOME}"` })
blocks('a find from the root', 'Bash', { command: 'find / -name x' })
blocks('a find inside $( )', 'Bash', { command: 'echo $(find ~ -name x)' })
blocks('a sudo du of the root', 'Bash', { command: 'sudo du -sh /' })
allows('a plain ls of home', 'Bash', { command: 'ls ~' })
allows('a search inside the repo', 'Bash', { command: 'rg foo src/lib' })
allows('a quoted regex with // and |', 'Bash', { command: "rg -n '^  // |^export' src/components/Editor.jsx | awk -F: '$1>4 && $1<9'" })
allows('the identifier in prose being written', 'Bash', { command: "python3 -c \"s='(`com.inkblot.app`)'\"" })
allows('a heredoc that says grep, then a / b', 'Bash', { command: "python3 - <<'EOF'\nold='grep for a test'\nnew='`a` / `b`'\nEOF" })
blocks('reading a document', 'Read', { file_path: `${APP}/A novel/Chapter 1.json` })
blocks('editing the preferences', 'Edit', { file_path: `${APP}/preferences.json` })
blocks('a Grep inside the folder', 'Grep', { pattern: 'the', path: APP })
blocks('a Glob into the folder', 'Glob', { pattern: `${APP}/**/*.json` })
allows('a Grep for the identifier in the repo', 'Grep', { pattern: 'com.inkblot.app', path: 'src-tauri' })
allows('reading the repo', 'Read', { file_path: 'src/lib/docKind.js' })

blocks('a recursive grep', 'Bash', { command: 'grep -rn foo src' }, 'pre-bash.mjs')
allows('git grep', 'Bash', { command: 'git grep -r foo' }, 'pre-bash.mjs')
allows('grep in a pipe', 'Bash', { command: 'rg foo src | grep -v bar' }, 'pre-bash.mjs')
blocks('cat on the generated types', 'Bash', { command: 'cat src/types/inkblot-core.ts' }, 'pre-bash.mjs')
allows('head on the generated types', 'Bash', { command: 'head -5 src/types/inkblot-core.ts' }, 'pre-bash.mjs')
