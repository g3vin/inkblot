#!/usr/bin/env bash
# Generate the TypeScript and Swift views of inkblot-core's domain types.
#
# The Rust definitions in src-tauri/crates/inkblot-core/src/types/ are the single
# source of truth; these outputs are generated and must never be hand-edited. Run
# this after touching any #[typeshare] type, and commit the result.
#
#   ./scripts/generate-types.sh          regenerate in place
#   ./scripts/generate-types.sh --check  fail if the committed output is stale
#
# --check is the gate: it is what proves the three languages have not drifted.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$root/src-tauri/crates/inkblot-core"
ts_out="$root/src/types/inkblot-core.ts"
swift_out="$crate/generated/InkblotCore.swift"

if ! command -v typeshare >/dev/null 2>&1; then
  echo "typeshare not found. Install it with:" >&2
  echo "  cargo install typeshare-cli --locked" >&2
  exit 127
fi

generate() {
  local ts="$1" swift="$2"
  typeshare "$crate/src" --lang=typescript --config-file="$crate/typeshare.toml" --output-file="$ts"
  typeshare "$crate/src" --lang=swift --config-file="$crate/typeshare.toml" --output-file="$swift"
}

if [[ "${1:-}" == "--check" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  generate "$tmp/inkblot-core.ts" "$tmp/InkblotCore.swift"
  status=0
  diff -u "$ts_out" "$tmp/inkblot-core.ts" || status=1
  diff -u "$swift_out" "$tmp/InkblotCore.swift" || status=1
  if [[ $status -ne 0 ]]; then
    echo "Generated types are stale. Run ./scripts/generate-types.sh and commit." >&2
    exit 1
  fi
  echo "Generated types are up to date."
  exit 0
fi

generate "$ts_out" "$swift_out"
echo "Wrote $ts_out"
echo "Wrote $swift_out"
