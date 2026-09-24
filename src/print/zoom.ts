/**
 * zoom.ts — Print Layout's zoom levels.
 *
 * Zoom is a scale on the whole stage, so 100% is the CSS definition of real size
 * (1in = 96px) — the convention Word and Pages use. "Actual size" is different: it
 * is the zoom at which an inch on the page is an inch on *this* screen, and needs
 * the display's physical density, which only the native shell knows.
 */

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 4

export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4]

export const clampZoom = (z: number): number => (
  Number.isFinite(z) ? Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) * 1000) / 1000 : 1
)

export const fitWidthZoom = (stageWidth: number, availableWidth: number): number => (
  clampZoom(availableWidth / Math.max(1, stageWidth))
)

export const fitPageZoom = (pageWidth: number, pageHeight: number, availableWidth: number, availableHeight: number): number => (
  clampZoom(Math.min(availableWidth / Math.max(1, pageWidth), availableHeight / Math.max(1, pageHeight)))
)

/**
 * The zoom at which the page is its physical size on screen. `pointsPerInch` is the
 * display's logical density: its width in CSS px (points, on a Mac) over its width
 * in inches. A 14-inch MacBook Pro is about 127; a 27-inch 5K display about 109.
 */
export const actualSizeZoom = (pointsPerInch: number | null | undefined): number | null => (
  pointsPerInch && pointsPerInch > 0 ? clampZoom(pointsPerInch / 96) : null
)
