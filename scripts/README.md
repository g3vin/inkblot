# scripts/

Each script's header says how to run it. This is the index.

| Script | What it does |
|---|---|
| `affected.mjs` | `npm run affected`: the suites and checks a change needs |
| `generate-types.sh` | `npm run types` / `types:check`: the TypeScript view of the Rust `#[typeshare]` types |
| `lint-design.mjs` | `npm run lint:design`: no raw colours, fonts or radii, ratcheted against `design-baseline.json` (generated) |
| `gen-spring-tokens.mjs` | writes the `--spring-*` tokens in `tokens.css` from `src/ui/physics.js` |
| `fetch-lexicon.mjs` | `npm run lexicon`: fetches the pronouncing dictionaries into `src/lib/g2p/data/` |
| `claude/post-edit.mjs` | Claude Code hook: formats or lints each file Claude edits |
| `claude/pre-bash.mjs` | Claude Code hook: blocks recursive grep and reads of the huge data files |
| `claude/private-writing.mjs` | Claude Code hook: keeps the writer's own documents (Inkblot's app data, linked projects) out of every session |
| `dev/tauri-mock.js` | the in-browser stand-in for the desktop shell (`/?mock`) |
| `dev/screenshot.mjs` | headless screenshots of the app or the `?design` showcase |
| `dev/capture.mjs` | screenshots every surface in `design-review/surfaces.json`, both themes, two sizes |
| `dev/compare.mjs` | pixel-diffs two capture runs |
| `dev/measure.mjs` | computed styles and behaviour of overlays, for the design review |
| `dev/surfaces.mjs` | shared by capture and measure: the catalogue, sizes, opening a surface |
| `dev/misaki-reference.py` | regenerates `tests/unit/voice-reference.json` |
