# Logo generator

Builds the Inkblot logo. The design is in [DESIGN.md §2](../../DESIGN.md#2-brand):
`splash.py` models the ink impact, and `generate.py` sets the letters from the font
outlines, swaps each *i*'s dot for the splash, and writes `src/ui/brandPaths.js`,
`src/assets/brand/*.svg` and `public/favicon.svg`.

Its settings are decisions from the brand review, so change them only on purpose:

- `MARK`: the splash is large and close to the stem (`dot_width` 360, `dot_gap` 40).
  The monogram keeps its tight *i*–*b* spacing (`kern` −40), and the splash moves left
  (`dot_dx` −45) to clear the *b*; widening the spacing loosened the monogram.
- `WORDMARK_DOT`: `dot_width` 330, `dot_gap` 55. The splash adds height, so a
  `Wordmark` is sized about 1.3× the height its letters alone would need.
- `ICON_SIZE`, `ICON_CENTRE`: the mark fills 41 of the 64-unit tile, and the point
  halfway between the ink's box centre and its centre of weight sits at (32, 31.6).

After a change:

1. Run `generate.py`.
2. Rasterise `app-icon.svg` into the two 1024px sources in `src-tauri/icons/source/`:
   `icon-macos-1024.png`, inset 100px with corners at 0.225 of the tile and
   transparent around it, and `icon-ios-1024.png`, full-bleed and opaque. Use
   `rsvg-convert` (librsvg) or a headless browser screenshot.
3. Run `npx tauri icon` on each, and copy `ios/` from the iOS run.
