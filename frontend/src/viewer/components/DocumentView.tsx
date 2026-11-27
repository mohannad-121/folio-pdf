/**
 * Center area: scrollable, virtualised list of pages (continuous / single / spread).
 * Handles zoom-at-pointer, hand panning, scroll-to-page requests and the text
 * selection → markup flow.
 */
import clsx from 'clsx'
import { Copy, Eraser, Highlighter, Strikethrough, Underline, WrapText } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PdfInfo } from '../../lib/api'
import { pdfRectToCss, type PageGeom } from '../coords'
import { useTextSelection, type SelectionInfo } from '../hooks/useTextSelection'
import { useViewer } from '../store'
import type { LayoutMode, MarkupType, ViewRotation } from '../types'
import PageView from './PageView'

const GAP = 16
const PAD = 24

interface LayoutItem {
  page: number
  left: number
  top: number
  w: number
  h: number
  geom: PageGeom
}

interface LayoutData {
  items: LayoutItem[]
  totalW: number
  totalH: number
}

function pageDims(info: PdfInfo, index: number, zoom: number, rotation: ViewRotation): { w: number; h: number; geom: PageGeom } {
  const p = info.pages[index] ?? { width: 612, height: 792 }
  const swapped = rotation === 90 || rotation === 270
  const geom: PageGeom = { width: p.width, height: p.height, scale: zoom, rotation }
  return { w: (swapped ? p.height : p.width) * zoom, h: (swapped ? p.width : p.height) * zoom, geom }
}

function computeLayout(info: PdfInfo, zoom: number, rotation: ViewRotation, layout: LayoutMode, containerW: number, currentPage: number): LayoutData {
  const n = info.page_count
  const items: LayoutItem[] = []
  if (layout === 'single') {
    const i = Math.min(n, Math.max(1, currentPage)) - 1
    const d = pageDims(info, i, zoom, rotation)
    const totalW = Math.max(containerW, d.w + PAD * 2)
    items.push({ page: i + 1, left: (totalW - d.w) / 2, top: PAD, w: d.w, h: d.h, geom: d.geom })
    return { items, totalW, totalH: d.h + PAD * 2 }
  }
  if (layout === 'spread') {
    let maxRow = 0
    const rows: { a: ReturnType<typeof pageDims>; b: ReturnType<typeof pageDims> | null }[] = []
    for (let i = 0; i < n; i += 2) {
      const a = pageDims(info, i, zoom, rotation)
      const b = i + 1 < n ? pageDims(info, i + 1, zoom, rotation) : null
      rows.push({ a, b })
      maxRow = Math.max(maxRow, a.w + (b ? GAP + b.w : 0))
    }
    const totalW = Math.max(containerW, maxRow + PAD * 2)
    let y = PAD
    rows.forEach((r, ri) => {
      const rowW = r.a.w + (r.b ? GAP + r.b.w : 0)
      const left = (totalW - rowW) / 2
      items.push({ page: ri * 2 + 1, left, top: y, w: r.a.w, h: r.a.h, geom: r.a.geom })
      if (r.b) items.push({ page: ri * 2 + 2, left: left + r.a.w + GAP, top: y, w: r.b.w, h: r.b.h, geom: r.b.geom })
      y += Math.max(r.a.h, r.b?.h ?? 0) + GAP
    })
    return { items, totalW, totalH: y - GAP + PAD }
  }
  let maxW = 0
  const dims = []
  for (let i = 0; i < n; i++) {
    const d = pageDims(info, i, zoom, rotation)
    dims.push(d)
    maxW = Math.max(maxW, d.w)
  }
  const totalW = Math.max(containerW, maxW + PAD * 2)
  let y = PAD
  dims.forEach((d, i) => {
    items.push({ page: i + 1, left: (totalW - d.w) / 2, top: y, w: d.w, h: d.h, geom: d.geom })
    y += d.h + GAP
  })
  return { items, totalW, totalH: y - GAP + PAD }
}

export default function DocumentView() {
  const info = useViewer((s) => s.info)
  const zoom = useViewer((s) => s.zoom)
  const fitMode = useViewer((s) => s.fitMode)
  const viewRotation = useViewer((s) => s.viewRotation)
  const layout = useViewer((s) => s.layout)
  const currentPage = useViewer((s) => s.currentPage)
  const scrollRequest = useViewer((s) => s.scrollRequest)
  const mode = useViewer((s) => s.mode)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const zoomAnchor = useRef<{ px: number; py: number; docX: number; docY: number; oldZoom: number } | null>(null)

  // Observe container size.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit modes.
  useEffect(() => {
    if (!info || !fitMode || !size.w || !info.pages.length) return
    const i = Math.min(info.page_count, Math.max(1, useViewer.getState().currentPage)) - 1
    const d = pageDims(info, i, 1, viewRotation)
    const cols = layout === 'spread' ? 2 : 1
    const availW = (size.w - PAD * 2 - (cols - 1) * GAP) / cols
    let z = availW / d.w
    if (fitMode === 'page') z = Math.min(z, (size.h - PAD * 2) / d.h)
    z = Math.max(0.1, Math.min(8, z))
    if (Math.abs(z - useViewer.getState().zoom) > 0.001) useViewer.setState({ zoom: z })
  }, [info, fitMode, size, viewRotation, layout])

  const layoutPage = layout === 'single' ? currentPage : 0
  const layoutData = useMemo<LayoutData | null>(() => (info ? computeLayout(info, zoom, viewRotation, layout, size.w, layoutPage) : null), [info, zoom, viewRotation, layout, size.w, layoutPage])

  const itemByPage = useMemo(() => {
    const m = new Map<number, LayoutItem>()
    layoutData?.items.forEach((it) => m.set(it.page, it))
    return m
  }, [layoutData])
  const itemByPageRef = useRef(itemByPage)
  useLayoutEffect(() => {
    itemByPageRef.current = itemByPage
  }, [itemByPage])
  const geomFor = useCallback((page: number) => itemByPageRef.current.get(page)?.geom ?? null, [])

  // Apply zoom anchor after layout changes.
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const el = containerRef.current
    if (!a || !el) return
    zoomAnchor.current = null
    const ratio = zoom / a.oldZoom
    el.scrollTop = a.docY * ratio - a.py
    el.scrollLeft = a.docX * ratio - a.px
  }, [zoom, layoutData])

  // Ctrl+wheel zoom (non-passive).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const s = useViewer.getState()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0022))
      const next = Math.max(0.1, Math.min(8, s.zoom * factor))
      if (next === s.zoom) return
      const r = el.getBoundingClientRect()
      const px = e.clientX - r.left
      const py = e.clientY - r.top
      zoomAnchor.current = { px, py, docX: el.scrollLeft + px, docY: el.scrollTop + py, oldZoom: s.zoom }
      s.setZoom(next, null)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Scroll tracking → current page.
  const onScroll = () => {
    const el = containerRef.current
    if (!el) return
    const top = el.scrollTop
    const left = el.scrollLeft
    setScroll({ top, left })
    if (!layoutData || layout === 'single') return
    const vh = el.clientHeight
    let best = 0
    let bestPage = currentPage
    for (const it of layoutData.items) {
      const vis = Math.min(it.top + it.h, top + vh) - Math.max(it.top, top)
      if (vis > best) {
        best = vis
        bestPage = it.page
      }
    }
    useViewer.getState().setCurrentPage(bestPage)
  }

  // Scroll requests (handled once per request).
  const handledNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!scrollRequest || !layoutData) return
    if (handledNonce.current === scrollRequest.nonce) return
    const el = containerRef.current
    if (!el) return
    const it = itemByPage.get(scrollRequest.page)
    if (!it) return
    handledNonce.current = scrollRequest.nonce
    if (scrollRequest.rect) {
      const css = pdfRectToCss(it.geom, scrollRequest.rect)
      el.scrollTo({ top: it.top + css.top - el.clientHeight / 2 + css.height / 2, left: Math.max(0, it.left + css.left - el.clientWidth / 2), behavior: 'smooth' })
    } else if (layout === 'single') el.scrollTo({ top: 0 })
    else el.scrollTo({ top: it.top - GAP / 2, behavior: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest, layoutData])

  // Hand panning.
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (mode !== 'hand' || e.button !== 0) return
    const el = containerRef.current!
    pan.current = { x: e.clientX, y: e.clientY, sl: el.scrollLeft, st: el.scrollTop }
    el.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pan.current
    if (!p) return
    const el = containerRef.current!
    el.scrollLeft = p.sl - (e.clientX - p.x)
    el.scrollTop = p.st - (e.clientY - p.y)
  }
  const onPointerUp = () => {
    pan.current = null
  }

  // Text selection → markup / popover.
  const { selection, clear } = useTextSelection(containerRef, geomFor, mode === 'select' || mode === 'markup')
  useEffect(() => {
    if (!selection || mode !== 'markup') return
    applyMarkup(selection, useViewer.getState().markupType)
    clear()
  }, [selection, mode, clear])

  const visibleMargin = size.h
  const visible = useMemo(() => {
    if (!layoutData) return new Set<number>()
    const set = new Set<number>()
    for (const it of layoutData.items) {
      if (it.top < scroll.top + size.h + visibleMargin && it.top + it.h > scroll.top - visibleMargin) set.add(it.page)
    }
    return set
  }, [layoutData, scroll.top, size.h, visibleMargin])

  // Only mount pages within a wider window so canvases are reused while scrolling.
  const mountMargin = size.h * 3
  const mounted = useMemo(() => {
    if (!layoutData) return []
    return layoutData.items.filter((it) => it.top < scroll.top + size.h + mountMargin && it.top + it.h > scroll.top - mountMargin)
  }, [layoutData, scroll.top, size.h, mountMargin])

  return (
    <div
      ref={containerRef}
      className={clsx('v-scroll relative h-full w-full overflow-auto bg-neutral-200/80 dark:bg-neutral-900', mode === 'hand' && 'cursor-grab active:cursor-grabbing')}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      tabIndex={-1}
    >
      {layoutData && (
        <div style={{ position: 'relative', width: layoutData.totalW, height: layoutData.totalH }}>
          {mounted.map((it) => (
            <PageView key={it.page} page={it.page} geom={it.geom} left={it.left} top={it.top} visible={visible.has(it.page)} />
          ))}
        </div>
      )}
      {selection && mode === 'select' && <SelectionPopover selection={selection} onDone={clear} />}
    </div>
  )
}

function applyMarkup(sel: SelectionInfo, type: MarkupType) {
  const s = useViewer.getState()
  for (const [page, rects] of sel.byPage) {
    s.addOp({ type, page, rects, color: s.style.color, opacity: s.style.opacity }, false)
  }
}

function SelectionPopover({ selection, onDone }: { selection: SelectionInfo; onDone: () => void }) {
  const style = useViewer((s) => s.style)
  const container = document.querySelector<HTMLElement>('.v-scroll')
  const cr = container?.getBoundingClientRect()
  const x = selection.anchor.x - (cr?.left ?? 0) + (container?.scrollLeft ?? 0)
  const y = selection.anchor.y - (cr?.top ?? 0) + (container?.scrollTop ?? 0)
  const act = (type: MarkupType, color?: string) => {
    const s = useViewer.getState()
    const c = color ?? (type === 'highlight' ? (style.color === '#ff0000' ? '#ffd400' : style.color) : '#ff0000')
    for (const [page, rects] of selection.byPage) s.addOp({ type, page, rects, color: c, opacity: style.opacity }, false)
    onDone()
  }
  const redact = () => {
    const s = useViewer.getState()
    for (const [page, rects] of selection.byPage) s.addOp({ type: 'redact', page, rects, fill: '#000000' }, false)
    onDone()
  }
  const btn = 'grid h-7 w-7 place-items-center rounded hover:bg-neutral-700 v-tip'
  return (
    <div data-selection-popover className="v-fade-in absolute z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-lg bg-neutral-900 p-1 text-white shadow-xl" style={{ left: x, top: y + 8 }} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className={btn} data-tip="Highlight" data-tip-side="bottom" onClick={() => act('highlight')}>
        <Highlighter size={15} style={{ color: style.color === '#ff0000' ? '#ffd400' : style.color }} />
      </button>
      <button type="button" className={btn} data-tip="Underline" data-tip-side="bottom" onClick={() => act('underline')}>
        <Underline size={15} />
      </button>
      <button type="button" className={btn} data-tip="Strikeout" data-tip-side="bottom" onClick={() => act('strikeout')}>
        <Strikethrough size={15} />
      </button>
      <button type="button" className={btn} data-tip="Squiggly" data-tip-side="bottom" onClick={() => act('squiggly')}>
        <WrapText size={15} />
      </button>
      <span className="mx-0.5 h-4 w-px bg-neutral-600" />
      <button type="button" className={btn} data-tip="Redact" data-tip-side="bottom" onClick={redact}>
        <Eraser size={15} className="text-red-400" />
      </button>
      <button
        type="button"
        className={btn}
        data-tip="Copy"
        data-tip-side="bottom"
        onClick={() => {
          void navigator.clipboard?.writeText(selection.text)
          onDone()
        }}
      >
        <Copy size={15} />
      </button>
    </div>
  )
}
