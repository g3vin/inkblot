# Contributing

Inkblot is proprietary software (see [LICENSE](LICENSE)). These are the working conventions for everyone with access to the repository.

Before changing anything that crosses a boundary (page ↔ shell, JavaScript ↔ Rust,
Rust ↔ Swift), read [ARCHITECTURE.md](ARCHITECTURE.md).

## Branches

`main` is always releasable. Work happens on short-lived branches cut from `main` and merged back through a pull request.

Name a branch `<type>/<topic>`, using the same types as commits:

| Branch | For |
|---|---|
| `feat/maps-timeline` | A new capability |
| `fix/rename-open-document` | A bug fix |
| `refactor/editor-hooks` | Restructuring with no change in behaviour |
| `docs/privacy-policy` | Documentation only |
| `test/print-layout` | Tests only |
| `chore/bump-tauri` | Tooling, dependencies, housekeeping |
| `ci/cache-typeshare` | The CI workflows |

Delete the branch once it is merged.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <summary in the imperative, lower case, no period>

<optional body: what changed and why, wrapped at 72 columns>
```

- **Types:** `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `style`, `build`,
  `ci`, `chore`.
- **Scopes** name the area: `core`, `models`, `ffi`, `native`, `bridge`, `canvas`,
  `maps`, `print`, `references`, `notes`, `editor`.
- Put a behaviour change in its own commit, separate from a refactor.
- A breaking change to the bridge protocol or the on-disk format gets a `BREAKING CHANGE:` footer.

## Pull requests

1. Rebase on `main` and run the checks in the [README](README.md#checks). CI runs the
   web, Rust and generated-type checks. The Xcode tests and `npm run test:layout` are
   local only, so run them yourself when you touch `native/` or `src/print/`.
2. Fill in the pull request template.
3. Merge with a merge commit, so the branch's history stays readable, and delete the branch.

## Design

Every user-facing change follows the design language in [docs/DESIGN.md](docs/DESIGN.md):
build from `src/ui/` and the tokens in `src/styles/tokens.css`, never hard-code a
colour, font, radius or shadow, and register new actions with the command palette.
`npm run dev` then `?design` shows every token and component in both themes.

## Code style

- **Lint clean.** `npm run lint` must report 0 errors and 0 warnings. Format Rust with
  `cargo fmt`.
- **Comments describe the code as it is.** Say what the code does and why. Don't
  narrate how it got there, what it used to do, or which bug it fixed; that belongs in
  the commit message.
- **Generated files are never edited by hand.** `src/types/inkblot-core.ts` and
  `native/inkblot-core/inkblot-core/Generated/` come from `npm run types` and
  `./scripts/build-xcframework.sh`.
- **Mount it or it's untested.** A component with logic worth keeping is mounted by a
  suite in `tests/unit/`.
- **Mirror both sides.** A function that exists in both JavaScript and Rust gets a
  parity case in `tests/parity/cases/`.
