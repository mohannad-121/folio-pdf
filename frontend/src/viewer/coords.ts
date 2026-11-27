import type { PointT, RectT, ViewRotation } from './types'

/**
 * Geometry of a displayed page. `width`/`height` come from pdf-info (already
 * account for the page's intrinsic /Rotate). `scale` = CSS px per PDF point.
 * `rotation` is the extra *view* rotation applied in the browser only.
 */
export interface PageGeom {
  width: number
  height: number
  scale: number
  rotation: ViewRotation
}

export interface CssRect {
  left: number
  top: number
  width: number
  height: number
}

export function cssSize(g: PageGeom): { w: number; h: number } {
  const swapped = g.rotation === 90 || g.rotation === 270
  return swapped ? { w: g.height * g.scale, h: g.width * g.scale } : { w: g.width * g.scale, h: g.height * g.scale }
}

export function pdfToCss(g: PageGeom, [x, y]: PointT): PointT {
  const s = g.scale
  switch (g.rotation) {
    case 90:
      return [(g.height - y) * s, x * s]
    case 180:
      return [(g.width - x) * s, (g.height - y) * s]
    case 270:
      return [y * s, (g.width - x) * s]
    default:
      return [x * s, y * s]
  }
}

export function cssToPdf(g: PageGeom, [cx, cy]: PointT): PointT {
  const u = cx / g.scale
  const v = cy / g.scale
  switch (g.rotation) {
    case 90:
      return [v, g.height - u]
    case 180:
      return [g.width - u, g.height - v]
    case 270:
      return [g.width - v, u]
    default:
      return [u, v]
  }
}

export function normRect(x0: number, y0: number, x1: number, y1: number): RectT {
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)]
}

export function pdfRectToCss(g: PageGeom, r: RectT): CssRect {
  const a = pdfToCss(g, [r[0], r[1]])
  const b = pdfToCss(g, [r[2], r[3]])
  const n = normRect(a[0], a[1], b[0], b[1])
  return { left: n[0], top: n[1], width: n[2] - n[0], height: n[3] - n[1] }
}

export function cssRectToPdf(g: PageGeom, r: CssRect): RectT {
  const a = cssToPdf(g, [r.left, r.top])
  const b = cssToPdf(g, [r.left + r.width, r.top + r.height])
  return normRect(a[0], a[1], b[0], b[1])
}

/** Clamp a PDF rect to the page bounds. */
export function clampRect(g: PageGeom, r: RectT): RectT {
  return [
    Math.max(0, Math.min(g.width, r[0])),
    Math.max(0, Math.min(g.height, r[1])),
    Math.max(0, Math.min(g.width, r[2])),
    Math.max(0, Math.min(g.height, r[3])),
  ]
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function roundRect(r: RectT): RectT {
  return [round2(r[0]), round2(r[1]), round2(r[2]), round2(r[3])]
}

export function rectsIntersect(a: RectT, b: RectT): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]
}

export function rectContains(r: RectT, p: PointT): boolean {
  return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]
}

export function unionRects(rects: RectT[]): RectT {
  const out: RectT = [Infinity, Infinity, -Infinity, -Infinity]
  for (const r of rects) {
    out[0] = Math.min(out[0], r[0])
    out[1] = Math.min(out[1], r[1])
    out[2] = Math.max(out[2], r[2])
    out[3] = Math.max(out[3], r[3])
  }
  return out
}
