/**
 * scripts/affected.mjs: the import graph it reads, how it resolves extensionless and
 * index imports, the suites that scan rather than import, Mirrors: twins in both
 * directions, and the Rust commands — all against an in-memory tree, not the repo.
 */
import { ok } from './assert.mjs'
import { parseImports, parseMirrors, plan, resolveSpecifier } from '../../scripts/affected.mjs'

ok('static, re-export, dynamic, side-effect and worker URL imports are read', JSON.stringify(parseImports(`
  import a from './a'
  export { b } from "../b.js"
  const c = await import('./c.ts')
  import './d.css'
  new Worker(new URL('./e.worker.js', import.meta.url))
  import x from 'react'
  import raw from './f.xml?raw'
`)) === JSON.stringify(['./a', '../b.js', './c.ts', './d.css', './e.worker.js', './f.xml']))

const known = new Set(['src/lib/a.js', 'src/ui/index.js', 'src/lib/b.ts'])
const has = (file) => known.has(file)
ok('an extensionless import resolves to the file with an extension', resolveSpecifier('src/lib/x.js', './a', has) === 'src/lib/a.js')
ok('a folder import resolves to its index', resolveSpecifier('src/lib/x.js', '../ui', has) === 'src/ui/index.js')
ok('an unknown import resolves to null', resolveSpecifier('src/lib/x.js', './missing', has) === null)

ok('Mirrors: lists every twin and drops punctuation', JSON.stringify(parseMirrors('/**\n * model.js — x.\n *\n * Mirrors: `src-tauri/a.rs`, src-tauri/b.rs.\n */')) === JSON.stringify(['src-tauri/a.rs', 'src-tauri/b.rs']))
ok('Mirrors: followed by a clause still yields the path', parseMirrors(' * Mirrors: `src-tauri/a.rs`; `npm run parity` asserts they agree.')[0] === 'src-tauri/a.rs')
ok('a header without Mirrors: has no twins', parseMirrors('/** plain */').length === 0)

const files = new Map([
  ['tests/unit/canvas.mjs', "import { m } from '../../src/lib/model.js'"],
  ['tests/unit/other.mjs', "import { o } from '../../src/lib/other.js'"],
  ['tests/unit/css.mjs', ''],
  ['src/lib/model.js', "/**\n * model.js\n * Mirrors: src-tauri/crates/inkblot-core/src/model.rs\n */\nimport { g } from './geometry'"],
  ['src/lib/geometry.js', 'export const g = 1'],
  ['src/lib/other.js', 'export const o = 1'],
  ['src/components/Panel.css', ''],
  ['src-tauri/crates/inkblot-core/src/model.rs', '#[typeshare]\npub struct Model;'],
])
const suites = ['canvas', 'other', 'css']

const deep = plan({ changed: ['src/lib/geometry.js'], files, suites })
ok('a change reaches the suites that import it transitively, and only those', JSON.stringify(deep.suites) === JSON.stringify(['canvas']))

const css = plan({ changed: ['src/components/Panel.css'], files, suites })
ok('a CSS change runs the scanning css suite and the design lint', css.suites.includes('css') && css.commands.includes('npm run lint:design'))

const js = plan({ changed: ['src/lib/model.js'], files, suites })
ok('a mirrored JS change names its Rust twin and asks for parity',
  js.twins.some((twin) => twin.twin === 'src-tauri/crates/inkblot-core/src/model.rs') && js.commands.includes('npm run parity'))

const rust = plan({ changed: ['src-tauri/crates/inkblot-core/src/model.rs'], files, suites })
ok('a Rust twin change names the JS module back', rust.twins.some((twin) => twin.twin === 'src/lib/model.js'))
ok('a #[typeshare] change asks for types and the crate\'s tests',
  rust.commands.includes('npm run types') && rust.commands.some((command) => command.includes('cargo test -q -p inkblot-core')))

ok('an unrelated change asks for nothing', plan({ changed: ['README.md'], files, suites }).commands.length === 0)
