import clsx from 'clsx'
import { BookOpen, ChevronLeft, ChevronRight, Columns2, Maximize, MoveHorizontal, RotateCw, Rows3, ZoomIn, ZoomOut } from 'lucide-react'
import { useState } from 'react'
import { usePageOrder, useViewer } from '../store'
import type { LayoutMode } from '../types'
import { IconButton } from './ui'

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export default function StatusBar() {
  const pageCount = useViewer((s) => s.info?.page_count ?? 0)
  // Positions follow the display order (pages may have been dragged into a new order).
  const order = usePageOrder()
  const currentPage = Math.max(1, order.indexOf(useViewer((s) => s.currentPage)) + 1)
  const zoom = useViewer((s) => s.zoom)
  const fitMode = useViewer((s) => s.fitMode)
  const layout = useViewer((s) => s.layout)
  const viewRotation = useViewer((s) => s.viewRotation)
  const [pageInput, setPageInput] = useState(String(currentPage))
  const [prevPage, setPrevPage] = useState(currentPage)
  if (prevPage !== currentPage) {
    setPrevPage(currentPage)
    setPageInput(String(currentPage))
  }

  const go = (p: number) => {
    const n = Math.min(pageCount, Math.max(1, Math.round(p)))
    if (Number.isFinite(n) && order[n - 1]) useViewer.getState().scrollToPage(order[n - 1])
  }

  const layouts: { v: LayoutMode; label: string; icon: React.ReactNode }[] = [
    { v: 'continuous', label: 'Continuous', icon: <Rows3 size={15} /> },
    { v: 'single', label: 'Single page', icon: <BookOpen size={15} /> },
    { v: 'spread', label: 'Two-page spread', icon: <Columns2 size={15} /> },
  ]

  return (
    <div className="flex h-9 items-center gap-1 border-t border-neutral-200 bg-white px-2 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
      <IconButton label="Previous page" tipSide="top" disabled={currentPage <= 1} onClick={() => go(currentPage - 1)} className="h-7 w-7">
        <ChevronLeft size={15} />
      </IconButton>
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          go(Number(pageInput))
        }}
      >
        <input
          aria-label="Page number"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value)}
          onBlur={() => go(Number(pageInput))}
          onFocus={(e) => e.target.select()}
          className="h-6 w-10 rounded border border-neutral-300 bg-white text-center tabular-nums outline-none focus:border-brand-500 dark:border-neutral-600 dark:bg-neutral-800"
        />
        <span className="text-neutral-500">/ {pageCount}</span>
      </form>
      <IconButton label="Next page" tipSide="top" disabled={currentPage >= pageCount} onClick={() => go(currentPage + 1)} className="h-7 w-7">
        <ChevronRight size={15} />
      </IconButton>

      <span className="flex-1" />

      <IconButton label="Zoom out" shortcut="-" tipSide="top" onClick={() => useViewer.getState().setZoom(zoom / 1.2)} className="h-7 w-7">
        <ZoomOut size={15} />
      </IconButton>
      <select
        aria-label="Zoom"
        value={fitMode ?? 'custom'}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'width' || v === 'page') useViewer.getState().setFitMode(v)
          else if (v !== 'custom') useViewer.getState().setZoom(Number(v))
        }}
        className="h-6 rounded border border-neutral-300 bg-white px-1 tabular-nums outline-none dark:border-neutral-600 dark:bg-neutral-800"
      >
        <option value="custom">{Math.round(zoom * 100)}%</option>
        <option value="width">Fit width</option>
        <option value="page">Fit page</option>
        {ZOOM_PRESETS.map((z) => (
          <option key={z} value={z}>
            {Math.round(z * 100)}%
          </option>
        ))}
      </select>
      <IconButton label="Zoom in" shortcut="+" tipSide="top" onClick={() => useViewer.getState().setZoom(zoom * 1.2)} className="h-7 w-7">
        <ZoomIn size={15} />
      </IconButton>
      <IconButton label="Fit width" tipSide="top" active={fitMode === 'width'} onClick={() => useViewer.getState().setFitMode('width')} className="h-7 w-7">
        <MoveHorizontal size={15} />
      </IconButton>
      <IconButton label="Fit page" tipSide="top" active={fitMode === 'page'} onClick={() => useViewer.getState().setFitMode('page')} className="h-7 w-7">
        <Maximize size={15} />
      </IconButton>
      <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
      <IconButton label={`Rotate view (${viewRotation}°)`} tipSide="top" onClick={() => useViewer.getState().setViewRotation((((viewRotation + 90) % 360) as 0 | 90 | 180 | 270))} className="h-7 w-7">
        <RotateCw size={15} />
      </IconButton>
      <div className="ml-1 flex items-center rounded-md border border-neutral-200 p-0.5 dark:border-neutral-700">
        {layouts.map((l) => (
          <button
            key={l.v}
            type="button"
            aria-label={l.label}
            data-tip={l.label}
            data-tip-side="top"
            onClick={() => useViewer.getState().setLayout(l.v)}
            className={clsx('v-tip relative grid h-6 w-7 place-items-center rounded', layout === l.v ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}
          >
            {l.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
