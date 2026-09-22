#!/bin/sh
# Copy the built editor bundle (the repo's dist/) into the app, as Resources/web — and
# the synonym tokenizer beside it.
#
# Run by the app target's "Embed Web Bundle" build phase. It copies rather than builds:
# Xcode's build environment does not reliably have node on PATH, and a phase that runs
# `npm run build` on every ⌘R would put a Vite build inside every Swift edit-run loop.
# So build the web side yourself (`npm run build` at the repo root) and this picks it
# up — and it warns, rather than silently shipping yesterday's editor, when the source
# is newer than the bundle.
set -eu

root="$SRCROOT/../.."
dist="$root/dist"
dest="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/web"

if [ ! -f "$dist/index.html" ]; then
  echo "error: $dist/index.html is missing. Run \`npm run build\` at the repo root first."
  exit 1
fi

if [ -n "$(find "$root/src" -newer "$dist/index.html" -type f -print -quit)" ]; then
  echo "warning: src/ has changed since dist/ was built. Run \`npm run build\` to pick it up."
fi

mkdir -p "$dest"
rsync -a --delete "$dist/" "$dest/"

# The synonym model's tokenizer, which both shells bundle rather than download — the
# Tauri app lists it under `bundle.resources`. `ModelService` looks for it here.
cp "$root/src-tauri/resources/minilm-tokenizer.json" "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/"
