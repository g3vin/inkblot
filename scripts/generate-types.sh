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
# The Xcode target compiles its own copy. A synchronized group cannot reach outside
# its folder, and a symlink in one is a build that works on the machine that made it.
# --check diffs this copy too, so it cannot drift from the one next to the crate.
native_swift_out="$root/native/inkblot-core/inkblot-core/Generated/InkblotCore.swift"

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

# Typecheck the Swift. `npm run typecheck` covers the TypeScript; nothing else looks
# at the Swift until the Phase 5 Xcode target exists, which is much too late to find
# out that a Rust type generates something Swift will not accept.
#
# AnyCodable is stubbed because the real one comes from a package the Xcode target
# will add. Skipped where swiftc is absent, so this still runs on Linux.
check_swift() {
  local swift="$1"
  if ! command -v swiftc >/dev/null 2>&1; then
    echo "swiftc not found; skipping the Swift typecheck."
    return 0
  fi

  local stub
  stub="$(mktemp -d)/AnyCodable.swift"
  cat > "$stub" <<'SWIFT'
public struct AnyCodable: Codable, Equatable {
    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool { true }
    public init(from decoder: Decoder) throws {}
    public func encode(to encoder: Encoder) throws {}
}
SWIFT

  swiftc -typecheck "$stub" "$swift"
  echo "Swift typechecks."
}

if [[ "${1:-}" == "--check" ]]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  generate "$tmp/inkblot-core.ts" "$tmp/InkblotCore.swift"
  status=0
  diff -u "$ts_out" "$tmp/inkblot-core.ts" || status=1
  diff -u "$swift_out" "$tmp/InkblotCore.swift" || status=1
  diff -u "$native_swift_out" "$tmp/InkblotCore.swift" || status=1
  if [[ $status -ne 0 ]]; then
    echo "Generated types are stale. Run ./scripts/generate-types.sh and commit." >&2
    exit 1
  fi
  check_swift "$swift_out"
  echo "Generated types are up to date."
  exit 0
fi

generate "$ts_out" "$swift_out"
mkdir -p "$(dirname "$native_swift_out")"
cp "$swift_out" "$native_swift_out"
check_swift "$swift_out"
echo "Wrote $ts_out"
echo "Wrote $swift_out"
echo "Wrote $native_swift_out"
