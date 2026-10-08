#!/usr/bin/env bash
# Generate the TypeScript view of inkblot-core's domain types.
#
# The Rust definitions in src-tauri/crates/inkblot-core/src/types/ are the single
# source of truth; the output is generated and must never be hand-edited. Run this
# after touching any #[typeshare] type, and commit the result.
#
#   ./scripts/generate-types.sh          regenerate in place
#   ./scripts/generate-types.sh --check  fail if the committed output is stale
#
# --check is the gate: it is what proves the two languages have not drifted.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$root/src-tauri/crates/inkblot-core"
ts_out="$root/src/types/inkblot-core.ts"

if ! command -v typeshare >/dev/null 2>&1; then
  echo "typeshare not found. Install it with:" >&2
  echo "  cargo install typeshare-cli --locked" >&2
  exit 127
fi

generate() {
  typeshare "$crate/src" --lang=typescript --config-file="$crate/typeshare.toml" --output-file="$1"
}

if [[ "${1:-}" == "--check" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  generate "$tmp/inkblot-core.ts"
  if ! diff -u "$ts_out" "$tmp/inkblot-core.ts"; then
    echo "Generated types are stale. Run ./scripts/generate-types.sh and commit." >&2
    exit 1
  fi
  echo "Generated types are up to date."
  exit 0
fi

generate "$ts_out"
echo "Wrote $ts_out"
