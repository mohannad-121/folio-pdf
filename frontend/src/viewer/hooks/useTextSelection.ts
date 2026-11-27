import { useCallback, useEffect, useState } from 'react'
import { cssRectToPdf, roundRect, type PageGeom } from '../coords'
import type { RectT } from '../types'

export interface SelectionInfo {
  /** PDF rects grouped by 1-based page. */
  byPage: Map<number, RectT[]>
  /** Anchor for a floating popover (viewport coords). */
  anchor: { x: number; y: number }
  text: string
}

/**
 * Reads the current DOM selection inside the document container and converts
 * the client rects of the range into PDF rects per page. Pages must carry
 * `data-page="<1-based>"` and expose their geometry via `geomFor`.
 */
export function readSelection(container: HTMLElement, geomFor: (page: number) => PageGeom | null): SelectionInfo | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null
  const rects = Array.from(range.getClientRects())
  if (!rects.length) return null
  const byPage = new Map<number, RectT[]>()
  const pages = container.querySelectorAll<HTMLElement>('[data-page]')
  let maxBottom = -Infinity
  let anchorX = 0
  for (const pageEl of pages) {
    const page = Number(pageEl.dataset.page)
    const geom = geomFor(page)
    if (!geom) continue
    const pb = pageEl.getBoundingClientRect()
    const out: RectT[] = []
    for (const r of rects) {
      if (r.width < 0.5 || r.height < 0.5) continue
      if (r.height > pb.height * 0.5) continue // the endOfContent filler
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (cx < pb.left || cx > pb.right || cy < pb.top || cy > pb.bottom) continue
      const css = {
        left: Math.max(0, r.left - pb.left),
        top: Math.max(0, r.top - pb.top),
        width: Math.min(r.width, pb.width),
        height: Math.min(r.height, pb.height),
      }
      out.push(roundRect(cssRectToPdf(geom, css)))
      if (r.bottom > maxBottom) {
        maxBottom = r.bottom
        anchorX = r.left + r.width / 2
      }
    }
    if (out.length) byPage.set(page, mergeLineRects(out))
  }
  if (!byPage.size) return null
  return { byPage, anchor: { x: anchorX, y: maxBottom }, text: sel.toString() }
}

/** Merge rects that sit on the same line (same vertical band) to avoid per-span fragments. */
function mergeLineRects(rects: RectT[]): RectT[] {
  const sorted = rects.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const out: RectT[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && Math.abs(last[1] - r[1]) < 2 && Math.abs(last[3] - r[3]) < 2 && r[0] <= last[2] + 3) {
      last[2] = Math.max(last[2], r[2])
      last[0] = Math.min(last[0], r[0])
    } else out.push([...r])
  }
  return out
}

/** Tracks text selection inside a container; fires when the mouse is released. */
export function useTextSelection(
  containerRef: React.RefObject<HTMLElement | null>,
  geomFor: (page: number) => PageGeom | null,
  enabled: boolean,
) {
  const [selection, setSelection] = useState<SelectionInfo | null>(null)
  const clear = useCallback(() => {
    setSelection(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || !enabled) return
    const onUp = () => {
      // Wait for the browser to finalise the selection.
      setTimeout(() => setSelection(readSelection(el, geomFor)), 0)
    }
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-selection-popover]')) return
      setSelection(null)
    }
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointerdown', onDown)
    return () => {
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointerdown', onDown)
    }
  }, [containerRef, geomFor, enabled])

  return { selection, clear }
}
