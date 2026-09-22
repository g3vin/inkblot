#!/usr/bin/env bash
# Build inkblot-core for the Swift shell: an XCFramework plus its UniFFI bindings.
#
#   ./scripts/build-xcframework.sh            release (what the app should link)
#   ./scripts/build-xcframework.sh --debug    faster, unoptimized
#
# Outputs, both gitignored because both are build products of the Rust source:
#   native/build/InkblotFFI.xcframework                     linked by the app target
#   native/inkblot-core/inkblot-core/Generated/inkblot_ffi.swift
#
# The two must come from the same build. UniFFI compiles a checksum of every
# exported function into the library and the Swift checks it at first call, so a
# stale inkblot_ffi.swift against a fresh library builds cleanly and then fails at
# launch. That is why this script writes both, and why the bindgen is the crate's
# own pinned binary rather than whatever uniffi-bindgen is on PATH.
#
# Re-run after changing anything in src-tauri/crates/inkblot-ffi or inkblot-core.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workspace="$root/src-tauri"
build="$root/native/build"
swift_out="$root/native/inkblot-core/inkblot-core/Generated"

profile="release"
cargo_profile=(--release)
if [[ "${1:-}" == "--debug" ]]; then
  profile="debug"
  cargo_profile=()
fi

# MACOSX_DEPLOYMENT_TARGET is deliberately left alone. rustc's default (11.0) is older
# than the app's, which is the harmless direction — and exporting it also reaches the
# host proc-macro dylibs, which the current linker then emits in a form dyld refuses
# to load ("mis-aligned LINKEDIT string pool"), failing the build a hundred crates in.
unset MACOSX_DEPLOYMENT_TARGET

# The C and C++ underneath the models — whisper.cpp, and oniguruma inside
# `tokenizers` — are compiled by cc/cmake, which without a deployment target build for
# the machine's own macOS, not the app's. The linker then warns that each object is
# "built for newer macOS", and the app would not load on the oldest macOS it claims.
# The flag goes to C and C++ only, where it cannot reach the proc-macro dylibs.
min_macos="26.4"
for triple in aarch64_apple_darwin x86_64_apple_darwin; do
  export "CFLAGS_$triple=-mmacosx-version-min=$min_macos"
  export "CXXFLAGS_$triple=-mmacosx-version-min=$min_macos"
done

# Every Apple Silicon Mac this app can run on is arm64; Intel is built only if its
# target is installed, and then the two are merged with lipo.
targets=(aarch64-apple-darwin)
if rustup target list --installed 2>/dev/null | grep -qx x86_64-apple-darwin; then
  targets+=(x86_64-apple-darwin)
fi

libs=()
for target in "${targets[@]}"; do
  echo "Building inkblot-ffi for $target ($profile)…"
  cargo build --manifest-path "$workspace/Cargo.toml" -p inkblot-ffi --lib \
    --target "$target" "${cargo_profile[@]}"
  libs+=("$workspace/target/$target/$profile/libinkblot_ffi.a")
done

rm -rf "$build"
mkdir -p "$build/headers" "$build/bindings" "$build/lib"

if [[ ${#libs[@]} -gt 1 ]]; then
  lipo -create "${libs[@]}" -output "$build/lib/libinkblot_ffi.a"
else
  cp "${libs[0]}" "$build/lib/libinkblot_ffi.a"
fi

echo "Generating Swift bindings…"
# From inside the workspace: library mode runs `cargo metadata` in the working
# directory to map the library back to its crate.
(cd "$workspace" && cargo run -q -p inkblot-ffi --features bindgen --bin uniffi-bindgen -- \
  generate --library "$workspace/target/${targets[0]}/$profile/libinkblot_ffi.dylib" \
  --language swift --out-dir "$build/bindings")

# An XCFramework's headers directory needs the module map under exactly this name.
cp "$build/bindings/inkblot_ffiFFI.h" "$build/headers/"
cp "$build/bindings/inkblot_ffiFFI.modulemap" "$build/headers/module.modulemap"

xcodebuild -create-xcframework \
  -library "$build/lib/libinkblot_ffi.a" \
  -headers "$build/headers" \
  -output "$build/InkblotFFI.xcframework" >/dev/null

mkdir -p "$swift_out"
# The app target defaults every declaration to the main actor
# (SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor), and the bindings are compiled into it —
# so without this, every call into Rust is main-actor-only, and a model load or a
# download would freeze the window. The generated code holds no UI state and UniFFI
# already marks its objects Sendable; `nonisolated` says so to the compiler. Every
# declaration uniffi writes at column 0 gets it — members too, where it is redundant
# but harmless — which is cruder than parsing Swift and much less likely to break
# when uniffi changes its formatting.
sed -E 's/^(public|open|fileprivate|private|internal|extension|final|struct|class|enum|protocol|func|let|var) /nonisolated \1 /' \
  "$build/bindings/inkblot_ffi.swift" > "$swift_out/inkblot_ffi.swift"

echo "Wrote $build/InkblotFFI.xcframework"
echo "Wrote $swift_out/inkblot_ffi.swift"
