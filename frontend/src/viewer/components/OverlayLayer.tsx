/**
 * Per-page overlay: renders pending ops optimistically, outlines existing
 * annotations/links/images, search hits, and handles pointer interactions for
 * the drawing/placement tools.
 */
import clsx from 'clsx'
import { Check, ExternalLink, StickyNote, Trash2, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { downloadUrl } from '../../lib/api'
import { clampRect, cssRectToPdf, cssToPdf, normRect, pdfRectToCss, pdfToCss, roundRect, type CssRect, type PageGeom } from '../coords'
import { canMove, canResize, isVisualOp, opBounds, resizeOp, translateOp } from '../ops'
import { stampSubtext, useViewer } from '../store'
import { fontFamily } from '../fonts'
import type { EditOp, FieldType, PendingOp, PointT, RectT } from '../types'

const CAPTURE_MODES = new Set(['draw', 'eraser', 'shape', 'text', 'note', 'image', 'link', 'redact', 'sign', 'stamp'])
/** Placement modes: existing pending ops remain clickable/movable while the tool is active. */
const OPS_INTERACTIVE_MODES = new Set(['text', 'note', 'image', 'link', 'sign', 'stamp'])

type Draft =
  | { kind: 'rect'; start: PointT; current: PointT }
  | { kind: 'line'; start: PointT; current: PointT }
  | { kind: 'ink'; points: PointT[] }

interface Props {
  page: number
  geom: PageGeom
  cssW: number
  cssH: number
}

export default function OverlayLayer({ page, geom, cssW, cssH }: Props) {
  const mode = useViewer((s) => s.mode)
  const fieldTool = useViewer((s) => s.fieldTool)
  const ops = useViewer((s) => s.ops)
  const selection = useViewer((s) => s.selection)
  const annotations = useViewer((s) => s.annotations)
  const links = useViewer((s) => s.links)
  const imagesByPage = useViewer((s) => s.images)
  const newFields = useViewer((s) => s.newFields)
  const searchHits = useViewer((s) => s.search.hits)
  const searchIndex = useViewer((s) => s.search.index)
  const redactMatches = useViewer((s) => s.redactMatches)
  const ref = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const pageOps = useMemo(() => ops.filter((p) => 'page' in p.op && p.op.page === page && isVisualOp(p.op)), [ops, page])
  const pageAnnots = useMemo(() => annotations.filter((a) => a.page === page), [annotations, page])
  const pageLinks = useMemo(() => links.filter((l) => l.page === page), [links, page])
  const pageImages = imagesByPage[page] ?? []
  const pageFields = useMemo(() => newFields.map((f, i) => [f, i] as const).filter(([f]) => f.page === page), [newFields, page])
  const pageHits = useMemo(() => searchHits.map((h, i) => [h, i] as const).filter(([h]) => h.page === page), [searchHits, page])
  const pageRedactMatches = useMemo(() => redactMatches.filter((m) => m.page === page), [redactMatches, page])

  const capture = CAPTURE_MODES.has(mode) || (mode === 'forms' && !!fieldTool)
  const opsInteractive = !capture || OPS_INTERACTIVE_MODES.has(mode)

  const localPoint = (e: React.PointerEvent): PointT => {
    const r = ref.current!.getBoundingClientRect()
    return [Math.max(0, Math.min(cssW, e.clientX - r.left)), Math.max(0, Math.min(cssH, e.clientY - r.top))]
  }

  // ---- creation handlers ---------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!capture || e.button !== 0) return
    const s = useViewer.getState()
    if (s.editingOpId) {
      s.setEditingOpId(null)
      return
    }
    const p = localPoint(e)
    const pdfP = cssToPdf(geom, p)
    e.currentTarget.setPointerCapture(e.pointerId)
    switch (mode) {
      case 'draw':
        setDraft({ kind: 'ink', points: [p] })
        break
      case 'eraser':
        eraseAt(p)
        break
      case 'shape':
        setDraft(s.shapeType === 'line' || s.shapeType === 'arrow' ? { kind: 'line', start: p, current: p } : { kind: 'rect', start: p, current: p })
        break
      case 'redact':
      case 'link':
      case 'forms':
        setDraft({ kind: 'rect', start: p, current: p })
        break
      case 'image':
        if (!s.pendingImage) {
          document.getElementById('v-image-input')?.click()
          return
        }
        setDraft({ kind: 'rect', start: p, current: p })
        break
      case 'text': {
        const w = Math.min(200, geom.width - pdfP[0])
        const h = s.style.fontSize * 1.5
        const rect = clampRect(geom, roundRect([pdfP[0], pdfP[1], pdfP[0] + Math.max(60, w), pdfP[1] + h]))
        const base = { page, rect, text: '', font_size: s.style.fontSize, color: s.style.color === '#ffd400' ? '#000000' : s.style.color, font: s.style.font, align: s.style.align }
        const id = s.addOp(s.textBaked ? { type: 'text', ...base } : { type: 'freetext', ...base })
        s.setEditingOpId(id)
        break
      }
      case 'note':
        s.addOp({ type: 'note', page, point: [Math.round(pdfP[0]), Math.round(pdfP[1])], contents: '', author: 'Folio' })
        break
      case 'sign':
        placeSignature(pdfP)
        break
      case 'stamp':
        placeStamp(pdfP)
        break
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draft && mode !== 'eraser') return
    const p = localPoint(e)
    if (mode === 'eraser') {
      if (e.buttons & 1) eraseAt(p)
      return
    }
    setDraft((d) => {
      if (!d) return d
      if (d.kind === 'ink') return { ...d, points: [...d.points, p] }
      return { ...d, current: p }
    })
  }

  const onPointerUp = () => {
    if (!draft) return
    const s = useViewer.getState()
    const d = draft
    setDraft(null)
    if (d.kind === 'ink') {
      if (d.points.length < 2) return
      const pts = simplify(d.points).map((p) => cssToPdf(geom, p).map((n) => Math.round(n * 10) / 10) as PointT)
      s.addOp({ type: 'ink', page, paths: [pts], color: s.style.color, width: s.style.strokeWidth, opacity: s.style.opacity }, false)
      return
    }
    if (d.kind === 'line') {
      const from = cssToPdf(geom, d.start)
      const to = cssToPdf(geom, d.current)
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 2) return
      s.addOp({ type: s.shapeType === 'arrow' ? 'arrow' : 'line', page, from: roundPt(from), to: roundPt(to), stroke: s.style.color, width: s.style.strokeWidth })
      return
    }
    // rect-like
    const dragged = Math.abs(d.current[0] - d.start[0]) > 3 && Math.abs(d.current[1] - d.start[1]) > 3
    const cssRect: CssRect = {
      left: Math.min(d.start[0], d.current[0]),
      top: Math.min(d.start[1], d.current[1]),
      width: Math.abs(d.current[0] - d.start[0]),
      height: Math.abs(d.current[1] - d.start[1]),
    }
    const rect = clampRect(geom, roundRect(cssRectToPdf(geom, cssRect)))
    const startPdf = cssToPdf(geom, d.start)
    switch (mode) {
      case 'shape':
        if (!dragged) return
        s.addOp({ type: s.shapeType === 'ellipse' ? 'ellipse' : 'rect', page, rect, stroke: s.style.color, fill: s.style.fill, width: s.style.strokeWidth, opacity: s.style.opacity })
        return
      case 'redact':
        if (!dragged) return
        s.addOp({ type: 'redact', page, rects: [rect], fill: '#000000' })
        return
      case 'link':
        if (!dragged) return
        s.addOp({ type: 'link', page, rect })
        return
      case 'image': {
        const img = s.pendingImage
        if (!img) return
        let r = rect
        if (!dragged) {
          const w = Math.min(200, geom.width * 0.5)
          r = clampRect(geom, roundRect([startPdf[0], startPdf[1], startPdf[0] + w, startPdf[1] + w / img.aspect]))
        }
        s.addOp({ type: 'image', page, rect: r, image_file_id: img.fileId, rotate: 0 })
        return
      }
      case 'forms': {
        const t = s.fieldTool
        if (!t) return
        let r = rect
        if (!dragged) {
          const [w, h] = defaultFieldSize(t)
          r = clampRect(geom, roundRect([startPdf[0], startPdf[1], startPdf[0] + w, startPdf[1] + h]))
        }
        const n = s.newFields.length + s.fields.length + 1
        s.addField({
          type: t,
          name: `${t}_${n}`,
          page,
          rect: r,
          options: t === 'combobox' || t === 'listbox' || t === 'radio' ? ['Option 1', 'Option 2'] : undefined,
          multiline: t === 'text' && r[3] - r[1] > 30 ? true : undefined,
        })
        return
      }
    }
  }

  const eraseAt = (p: PointT) => {
    const s = useViewer.getState()
    for (const po of pageOps) {
      if (po.op.type !== 'ink') continue
      const hit = po.op.paths.some((path) =>
        path.some((pt) => {
          const c = pdfToCss(geom, pt)
          return Math.hypot(c[0] - p[0], c[1] - p[1]) < 8
        }),
      )
      if (hit) s.removeOp(po.id)
    }
  }

  const placeSignature = (pdfP: PointT) => {
    const s = useViewer.getState()
    if (s.signPlacement === 'date') {
      const text = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      const w = text.length * 6 + 8
      const rect = clampRect(geom, roundRect([pdfP[0], pdfP[1], pdfP[0] + w, pdfP[1] + 16]))
      s.addOp({ type: 'text', page, rect, text, font_size: 11, color: '#000000', font: 'helv', align: 'left' })
      return
    }
    const sig = s.activeSignature
    if (!sig) {
      s.notify('info', 'Create or pick a signature first')
      s.setDialog('signature')
      return
    }
    const aspect = sig.aspect ?? 3
    const w = s.signPlacement === 'initials' ? 60 : Math.min(180, geom.width * 0.4)
    const h = w / aspect
    const rect = clampRect(geom, roundRect([pdfP[0] - w / 2, pdfP[1] - h / 2, pdfP[0] + w / 2, pdfP[1] + h / 2]))
    s.addOp({ type: 'signature', page, rect, image_file_id: sig.file_id })
  }

  const placeStamp = (pdfP: PointT) => {
    const s = useViewer.getState()
    const st = s.stamp
    const text = st.text.trim().toUpperCase()
    if (!text) {
      s.notify('info', 'Type the stamp text first')
      return
    }
    const subtext = stampSubtext(st)
    // Size from the label (≈15pt per character at the default size), bounded to the page.
    const w = Math.min(geom.width * 0.7, Math.max(110, text.length * 15 + 36, subtext ? subtext.length * 5.5 + 36 : 0))
    const h = subtext ? 62 : 48
    const rect = clampRect(geom, roundRect([pdfP[0] - w / 2, pdfP[1] - h / 2, pdfP[0] + w / 2, pdfP[1] + h / 2]))
    s.addOp({ type: 'stamp', page, rect, text, ...(subtext ? { subtext } : {}), color: st.color, opacity: st.opacity, rotate: st.rotate })
  }

  const onBackgroundClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !capture) useViewer.getState().select(null)
  }

  const deletedAnnots = useMemo(() => new Set(ops.filter((p) => p.op.type === 'delete_annot').map((p) => (p.op as { xref: number }).xref)), [ops])
  const deletedLinks = useMemo(
    () => new Set(ops.filter((p) => p.op.type === 'delete_link' || (p.op.type === 'link' && p.op.remove_xref != null)).map((p) => (p.op.type === 'link' ? p.op.remove_xref! : (p.op as { xref: number }).xref))),
    [ops],
  )
  const deletedImages = useMemo(() => new Set(ops.filter((p) => p.op.type === 'delete_image').map((p) => (p.op as { xref: number }).xref)), [ops])
  const replacedImages = useMemo(() => new Set(ops.filter((p) => p.op.type === 'replace_image').map((p) => (p.op as { xref: number }).xref)), [ops])

  const showAnnots = mode === 'select'
  const showLinks = mode === 'link' || mode === 'select'
  const showImages = mode === 'edit-text' || mode === 'image'

  return (
    <div
      ref={ref}
      className={clsx('v-overlay', capture ? 'capture' : 'passthrough', opsInteractive && 'ops-interactive')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDraft(null)}
      onClick={onBackgroundClick}
    >
      {/* search hits */}
      {pageHits.map(([h, i]) => (
        <div key={`hit-${i}`} className={clsx('v-search-hit', i === searchIndex && 'current')} style={rectStyle(pdfRectToCss(geom, h.rect))} />
      ))}
      {/* redact search matches */}
      {pageRedactMatches.map((m, i) => (
        <div key={`rm-${i}`} className="v-redact-match" style={rectStyle(pdfRectToCss(geom, m.rect))} title="Will be redacted" />
      ))}

      {/* existing annotations */}
      {showAnnots &&
        pageAnnots.map((a) => (
          <div
            key={`a-${a.xref}`}
            className={clsx('v-annot-outline', selection?.kind === 'annot' && selection.xref === a.xref && 'selected', deletedAnnots.has(a.xref) && 'deleted')}
            style={rectStyle(pdfRectToCss(geom, a.rect))}
            title={`${a.type}${a.contents ? ': ' + a.contents : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              useViewer.getState().select({ kind: 'annot', xref: a.xref, page })
            }}
          />
        ))}

      {/* existing links */}
      {showLinks &&
        pageLinks.map((l) => (
          <div
            key={`l-${l.xref}`}
            className={clsx('v-annot-outline', selection?.kind === 'link' && selection.xref === l.xref && 'selected', deletedLinks.has(l.xref) && 'deleted')}
            style={{ ...rectStyle(pdfRectToCss(geom, l.rect)), borderColor: mode === 'link' ? 'rgba(37,99,235,0.7)' : undefined, borderStyle: 'dashed' }}
            title={l.uri ?? (l.target_page ? `Page ${l.target_page}` : l.kind)}
            onClick={(e) => {
              e.stopPropagation()
              useViewer.getState().select({ kind: 'link', xref: l.xref, page })
            }}
          />
        ))}

      {/* existing images */}
      {showImages &&
        pageImages.map((im) => (
          <div
            key={`im-${im.xref}`}
            className={clsx('v-annot-outline', selection?.kind === 'image' && selection.xref === im.xref && 'selected', deletedImages.has(im.xref) && 'deleted')}
            style={{ ...rectStyle(pdfRectToCss(geom, im.bbox)), borderStyle: 'dotted', borderColor: 'rgba(124,58,237,0.6)' }}
            title={`Image ${im.width}×${im.height}`}
            onClick={(e) => {
              e.stopPropagation()
              useViewer.getState().select({ kind: 'image', xref: im.xref, page })
            }}
          >
            {replacedImages.has(im.xref) && <span className="absolute left-1 top-1 rounded bg-violet-600 px-1 text-[10px] text-white">replaced</span>}
          </div>
        ))}

      {/* pending new form fields */}
      {pageFields.map(([f, i]) => (
        <div key={`nf-${i}`} className="absolute border-2 border-dashed border-emerald-500 bg-emerald-100/50 text-[10px] text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" style={rectStyle(pdfRectToCss(geom, f.rect))}>
          <span className="absolute left-1 top-0.5 truncate font-medium">{f.type}: {f.name}</span>
          <button type="button" aria-label="Remove field" className="absolute -right-2 -top-2 grid h-4 w-4 place-items-center rounded-full bg-emerald-600 text-white" onClick={() => useViewer.getState().removeField(i)}>
            <X size={10} />
          </button>
        </div>
      ))}

      {/* pending ops */}
      {pageOps.map((po) => (
        <OpView key={po.id} po={po} geom={geom} selected={selection?.kind === 'op' && selection.id === po.id} interactive={opsInteractive} />
      ))}

      {/* in-progress draft */}
      {draft && <DraftView draft={draft} />}
    </div>
  )
}

// ---- helpers -----------------------------------------------------------------

function rectStyle(r: CssRect): CSSProperties {
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

function roundPt(p: PointT): PointT {
  return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]
}

function simplify(points: PointT[]): PointT[] {
  const out: PointT[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5) out.push(p)
  }
  return out
}

function defaultFieldSize(t: FieldType): [number, number] {
  switch (t) {
    case 'checkbox':
    case 'radio':
      return [14, 14]
    case 'signature':
      return [160, 40]
    case 'listbox':
      return [140, 60]
    default:
      return [140, 20]
  }
}

function DraftView({ draft }: { draft: Draft }) {
  const style = useViewer((s) => s.style)
  const mode = useViewer((s) => s.mode)
  const shapeType = useViewer((s) => s.shapeType)
  if (draft.kind === 'ink') {
    return (
      <svg>
        <polyline points={draft.points.map((p) => p.join(',')).join(' ')} fill="none" stroke={style.color} strokeWidth={Math.max(1, style.strokeWidth * 1.3)} strokeOpacity={style.opacity} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (draft.kind === 'line') {
    return (
      <svg>
        <line x1={draft.start[0]} y1={draft.start[1]} x2={draft.current[0]} y2={draft.current[1]} stroke={style.color} strokeWidth={Math.max(1, style.strokeWidth)} strokeLinecap="round" />
      </svg>
    )
  }
  const r = normRect(draft.start[0], draft.start[1], draft.current[0], draft.current[1])
  const css: CssRect = { left: r[0], top: r[1], width: r[2] - r[0], height: r[3] - r[1] }
  if (mode === 'shape') {
    return (
      <svg>
        {shapeType === 'ellipse' ? (
          <ellipse cx={css.left + css.width / 2} cy={css.top + css.height / 2} rx={css.width / 2} ry={css.height / 2} stroke={style.color} fill={style.fill ?? 'none'} strokeWidth={style.strokeWidth} />
        ) : (
          <rect x={css.left} y={css.top} width={css.width} height={css.height} stroke={style.color} fill={style.fill ?? 'none'} strokeWidth={style.strokeWidth} />
        )}
      </svg>
    )
  }
  const cls = mode === 'redact' ? 'border-2 border-red-500 bg-black/70' : mode === 'forms' ? 'border-2 border-dashed border-emerald-500 bg-emerald-200/30' : 'border-2 border-dashed border-brand-500 bg-brand-500/10'
  return <div className={clsx('absolute', cls)} style={rectStyle(css)} />
}

// ---- a single pending op -------------------------------------------------------

function OpView({ po, geom, selected, interactive }: { po: PendingOp; geom: PageGeom; selected: boolean; interactive: boolean }) {
  const [draftOp, setDraftOp] = useState<EditOp | null>(null)
  const dragRef = useRef<{ start: PointT; moved: boolean } | null>(null)
  const onResize = useCallback(
    (r: CssRect, commit: boolean) => {
      const rect = cssRectToPdf(geom, r)
      if (commit) {
        setDraftOp(null)
        useViewer.getState().updateOp(po.id, (cur) => resizeOp(cur, rect))
      } else setDraftOp(resizeOp(po.op, rect))
    },
    [geom, po],
  )
  const op = draftOp ?? po.op
  const bounds = opBounds(op)
  if (!bounds) return null
  const movable = interactive && canMove(po.op)
  const resizable = interactive && canResize(po.op) && selected
  const pad = op.type === 'ink' || op.type === 'line' || op.type === 'arrow' ? ('width' in op ? op.width * geom.scale : 2) + 2 : 0
  const css = pdfRectToCss(geom, bounds)
  const box: CssRect = { left: css.left - pad, top: css.top - pad, width: css.width + pad * 2, height: css.height + pad * 2 }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button !== 0) return
    e.stopPropagation()
    const s = useViewer.getState()
    if (!selected) s.select({ kind: 'op', id: po.id })
    if (!movable) return
    if (s.editingOpId === po.id) return
    dragRef.current = { start: [e.clientX, e.clientY], moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.start[0]
    const dy = e.clientY - d.start[1]
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    const a = cssToPdf(geom, [0, 0])
    const b = cssToPdf(geom, [dx, dy])
    setDraftOp(translateOp(po.op, b[0] - a[0], b[1] - a[1]))
  }
  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    if (d?.moved && draftOp) useViewer.getState().updateOp(po.id, () => draftOp)
    setDraftOp(null)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    if (!interactive) return
    e.stopPropagation()
    if (op.type === 'text' || op.type === 'freetext' || op.type === 'note' || op.type === 'link') useViewer.getState().setEditingOpId(po.id)
  }

  return (
    <div
      className={clsx('v-op', movable && 'movable', selected && 'selected')}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      data-op-id={po.id}
    >
      <OpBody op={op} geom={geom} box={box} pad={pad} id={po.id} selected={selected} />
      {resizable && <Handles box={box} onResize={onResize} />}
    </div>
  )
}

function Handles({ box, onResize }: { box: CssRect; onResize: (r: CssRect, commit: boolean) => void }) {
  const start = useRef<{ x: number; y: number; box: CssRect; dir: string } | null>(null)
  const onDown = (dir: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    start.current = { x: e.clientX, y: e.clientY, box, dir }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const compute = (e: React.PointerEvent): CssRect | null => {
    const s = start.current
    if (!s) return null
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    let { left, top, width, height } = s.box
    if (s.dir.includes('w')) {
      left += dx
      width -= dx
    }
    if (s.dir.includes('e')) width += dx
    if (s.dir.includes('n')) {
      top += dy
      height -= dy
    }
    if (s.dir.includes('s')) height += dy
    if (width < 4) {
      if (s.dir.includes('w')) left = s.box.left + s.box.width - 4
      width = 4
    }
    if (height < 4) {
      if (s.dir.includes('n')) top = s.box.top + s.box.height - 4
      height = 4
    }
    return { left, top, width, height }
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = compute(e)
    if (r) onResize(r, false)
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = compute(e)
    start.current = null
    if (r) onResize(r, true)
  }
  return (
    <>
      {['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((d) => (
        <div key={d} className={clsx('v-handle', d)} onPointerDown={onDown(d)} onPointerMove={onMove} onPointerUp={onUp} />
      ))}
    </>
  )
}

function OpBody({ op, geom, box, pad, id, selected }: { op: EditOp; geom: PageGeom; box: CssRect; pad: number; id: string; selected: boolean }) {
  const s = geom.scale
  // Convert PDF point to coordinates relative to the box.
  const rel = (p: PointT): PointT => {
    const c = pdfToCss(geom, p)
    return [c[0] - box.left, c[1] - box.top]
  }
  const relRect = (r: RectT): CssRect => {
    const c = pdfRectToCss(geom, r)
    return { left: c.left - box.left, top: c.top - box.top, width: c.width, height: c.height }
  }

  switch (op.type) {
    case 'highlight':
      return (
        <svg className="v-highlight-multiply">
          {op.rects.map((r, i) => {
            const c = relRect(r)
            return <rect key={i} x={c.left} y={c.top} width={c.width} height={c.height} fill={op.color} fillOpacity={Math.min(0.9, op.opacity * 0.6)} rx={1} />
          })}
        </svg>
      )
    case 'underline':
    case 'strikeout':
      return (
        <svg>
          {op.rects.map((r, i) => {
            const c = relRect(r)
            const y = op.type === 'underline' ? c.top + c.height - Math.max(1, s) : c.top + c.height / 2
            return <line key={i} x1={c.left} x2={c.left + c.width} y1={y} y2={y} stroke={op.color} strokeOpacity={op.opacity} strokeWidth={Math.max(1, s * 1.2)} />
          })}
        </svg>
      )
    case 'squiggly':
      return (
        <svg>
          {op.rects.map((r, i) => {
            const c = relRect(r)
            const y = c.top + c.height - 1
            const amp = Math.max(1.5, s * 1.5)
            let d = `M ${c.left} ${y}`
            let up = true
            for (let x = c.left + amp; x <= c.left + c.width; x += amp) {
              d += ` L ${x} ${up ? y - amp : y}`
              up = !up
            }
            return <path key={i} d={d} fill="none" stroke={op.color} strokeOpacity={op.opacity} strokeWidth={Math.max(1, s)} />
          })}
        </svg>
      )
    case 'ink':
      return (
        <svg>
          {op.paths.map((path, i) => (
            <polyline key={i} points={path.map((p) => rel(p).join(',')).join(' ')} fill="none" stroke={op.color} strokeWidth={Math.max(0.75, op.width * s)} strokeOpacity={op.opacity} strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      )
    case 'rect':
    case 'ellipse': {
      const c = relRect(op.rect)
      const sw = Math.max(0.75, op.width * s)
      return (
        <svg>
          {op.type === 'rect' ? (
            <rect x={c.left + sw / 2} y={c.top + sw / 2} width={Math.max(0, c.width - sw)} height={Math.max(0, c.height - sw)} stroke={op.stroke} fill={op.fill ?? 'none'} strokeWidth={sw} opacity={op.opacity} />
          ) : (
            <ellipse cx={c.left + c.width / 2} cy={c.top + c.height / 2} rx={Math.max(0, c.width / 2 - sw / 2)} ry={Math.max(0, c.height / 2 - sw / 2)} stroke={op.stroke} fill={op.fill ?? 'none'} strokeWidth={sw} opacity={op.opacity} />
          )}
        </svg>
      )
    }
    case 'line':
    case 'arrow': {
      const a = rel(op.from)
      const b = rel(op.to)
      const sw = Math.max(0.75, op.width * s)
      const mid = `arrow-${id}`
      return (
        <svg>
          {op.type === 'arrow' && (
            <defs>
              <marker id={mid} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L8,4 L0,8 z" fill={op.stroke} />
              </marker>
            </defs>
          )}
          <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={op.stroke} strokeWidth={sw} strokeLinecap="round" markerEnd={op.type === 'arrow' ? `url(#${mid})` : undefined} />
        </svg>
      )
    }
    case 'note':
      return <NoteBody op={op} id={id} selected={selected} pad={pad} />
    case 'freetext':
    case 'text':
      return <TextBody op={op} id={id} scale={s} />
    case 'replace_text': {
      return (
        <div className="absolute inset-0 overflow-hidden whitespace-pre bg-white text-black" style={{ fontSize: (op.font_size ?? 11) * s, fontFamily: fontFamily(op.font), color: op.color ?? '#000', lineHeight: `${box.height}px`, outline: '1px dashed rgba(53,92,255,0.5)' }}>
          {op.text}
        </div>
      )
    }
    case 'image':
    case 'signature':
      return <img src={downloadUrl(op.image_file_id, true)} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-contain" style={op.type === 'image' && op.rotate ? { transform: `rotate(${op.rotate}deg)` } : undefined} />
    case 'stamp':
      return <StampBody op={op} />
    case 'link':
      return <LinkBody op={op} id={id} selected={selected} />
    case 'redact':
      return (
        <>
          {op.rects.map((r, i) => (
            <div key={i} className="v-redact-pending" style={rectStyle(relRect(r))} />
          ))}
        </>
      )
    case 'erase':
      return <div className="absolute inset-0 bg-white" style={{ outline: '1px dashed rgba(220,38,38,0.6)' }} />
    default:
      return null
  }
}

/**
 * Preview of a rubber stamp. Mirrors the backend's draw_stamp layout (border widths, padding, font
 * sizes as fractions of the box) in an SVG whose viewBox is the stamp's size in PDF points.
 */
function StampBody({ op }: { op: Extract<EditOp, { type: 'stamp' }> }) {
  const w = Math.max(1, op.rect[2] - op.rect[0])
  const h = Math.max(1, op.rect[3] - op.rect[1])
  const bw = Math.max(1, Math.min(w, h) * 0.045)
  const pad = bw * 4.5
  const availW = Math.max(4, w - 2 * pad)
  const availH = Math.max(4, h - 2 * pad)
  const label = op.text.trim().toUpperCase()
  const sub = op.subtext?.trim() ?? ''
  // Helvetica-Bold averages ~0.68em per upper-case glyph and ~0.58em for mixed text.
  const size = Math.min(availH * (sub ? 0.58 : 0.8), availW / Math.max(label.length * 0.68, 0.01))
  const subSize = sub ? Math.min(availH * 0.24, size * 0.45, availW / Math.max(sub.length * 0.58, 0.01)) : 0
  const cap = 0.72
  const gap = subSize * 0.75
  const block = size * cap + (sub ? gap + subSize * cap : 0)
  const base = h / 2 - block / 2 + size * cap
  const r = Math.min(w, h)
  const inset = bw * 2.4
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" style={{ transform: op.rotate ? `rotate(${op.rotate}deg)` : undefined, opacity: op.opacity }}>
      <rect x={bw / 2} y={bw / 2} width={w - bw} height={h - bw} rx={r * 0.18} fill="none" stroke={op.color} strokeWidth={bw} />
      {w > inset * 2 && h > inset * 2 && <rect x={inset} y={inset} width={w - inset * 2} height={h - inset * 2} rx={r * 0.14} fill="none" stroke={op.color} strokeWidth={bw * 0.45} />}
      <text x={w / 2} y={base} textAnchor="middle" fill={op.color} fontSize={size} fontWeight={700} fontFamily="Helvetica, Arial, sans-serif">
        {label}
      </text>
      {sub && (
        <text x={w / 2} y={base + gap + subSize * cap} textAnchor="middle" fill={op.color} fontSize={subSize} fontWeight={700} fontFamily="Helvetica, Arial, sans-serif">
          {sub}
        </text>
      )}
    </svg>
  )
}

function NoteBody({ op, id, selected, pad }: { op: Extract<EditOp, { type: 'note' }>; id: string; selected: boolean; pad: number }) {
  const editing = useViewer((s) => s.editingOpId === id)
  const [text, setText] = useState(op.contents)
  const [prevContents, setPrevContents] = useState(op.contents)
  if (prevContents !== op.contents) {
    setPrevContents(op.contents)
    setText(op.contents)
  }
  const open = selected || editing
  return (
    <>
      <div className="absolute grid place-items-center rounded-sm bg-yellow-300 text-yellow-900 shadow" style={{ left: pad, top: pad, width: 20, height: 20 }} title={op.contents}>
        <StickyNote size={14} />
      </div>
      {open && (
        <div className="v-fade-in absolute left-6 top-0 z-10 w-56 rounded-lg border border-yellow-300 bg-yellow-50 p-2 text-xs shadow-xl dark:border-yellow-700 dark:bg-yellow-950" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              if (text !== op.contents) useViewer.getState().updateOp(id, { contents: text })
              useViewer.getState().setEditingOpId(null)
            }}
            placeholder="Type a comment…"
            className="h-20 w-full resize-none rounded border border-yellow-200 bg-white p-1 text-xs text-neutral-900 outline-none focus:border-yellow-400 dark:border-yellow-800 dark:bg-neutral-900 dark:text-neutral-100"
          />
          <div className="mt-1 flex justify-between text-[10px] text-neutral-500">
            <span>{op.author}</span>
            <button type="button" className="text-red-600 hover:underline" onClick={() => useViewer.getState().removeOp(id)}>
              Delete
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function TextBody({ op, id, scale }: { op: Extract<EditOp, { type: 'text' | 'freetext' }>; id: string; scale: number }) {
  const editing = useViewer((s) => s.editingOpId === id)
  const [value, setValue] = useState(op.text)
  const [prevText, setPrevText] = useState(op.text)
  if (prevText !== op.text) {
    setPrevText(op.text)
    setValue(op.text)
  }
  const common: CSSProperties = {
    fontSize: op.font_size * scale,
    fontFamily: fontFamily(op.font),
    fontStyle: op.font === 'heit' ? 'italic' : undefined,
    fontWeight: op.font === 'tibo' ? 700 : undefined,
    color: op.color,
    textAlign: op.align,
    lineHeight: 1.2,
    padding: 1 * scale,
  }
  if (editing) {
    return (
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
          e.stopPropagation()
        }}
        onBlur={() => {
          const s = useViewer.getState()
          if (!value.trim()) s.removeOp(id)
          else if (value !== op.text) s.updateOp(id, { text: value })
          s.setEditingOpId(null)
        }}
        placeholder="Type…"
        className="absolute inset-0 h-full w-full resize-none overflow-hidden bg-white/90 outline-none ring-2 ring-brand-500"
        style={common}
      />
    )
  }
  return (
    <div className={clsx('absolute inset-0 overflow-hidden whitespace-pre-wrap break-words', op.type === 'freetext' && 'bg-white/70', !op.text && 'text-neutral-400')} style={common}>
      {op.text || 'Double-click to edit'}
    </div>
  )
}

function LinkBody({ op, id, selected }: { op: Extract<EditOp, { type: 'link' }>; id: string; selected: boolean }) {
  const editing = useViewer((s) => s.editingOpId === id)
  const empty = !op.uri && !op.target_page
  const [uri, setUri] = useState(op.uri ?? '')
  const [target, setTarget] = useState(op.target_page ? String(op.target_page) : '')
  const pageCount = useViewer((s) => s.info?.page_count ?? 1)
  const open = editing || (selected && empty)
  const commit = () => {
    const s = useViewer.getState()
    const tp = Number(target)
    s.updateOp(id, (cur) => {
      const c = cur as Extract<EditOp, { type: 'link' }>
      const next: Extract<EditOp, { type: 'link' }> = { type: 'link', page: c.page, rect: c.rect }
      if (c.remove_xref != null) next.remove_xref = c.remove_xref
      if (uri.trim()) next.uri = /^[a-z]+:/i.test(uri.trim()) ? uri.trim() : `https://${uri.trim()}`
      else if (tp >= 1 && tp <= pageCount) next.target_page = Math.floor(tp)
      return next
    })
    s.setEditingOpId(null)
    s.select(null)
  }
  return (
    <>
      <div className="absolute inset-0 border-2 border-dashed border-blue-500 bg-blue-500/10" title={op.uri ?? (op.target_page ? `Page ${op.target_page}` : 'Link')}>
        {!empty && (
          <span className="absolute -top-5 left-0 flex items-center gap-1 rounded bg-blue-600 px-1 text-[10px] text-white">
            <ExternalLink size={10} /> {op.uri ?? `Page ${op.target_page}`}
          </span>
        )}
      </div>
      {open && (
        <div data-selection-popover className="v-fade-in absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-neutral-200 bg-white p-2 text-xs shadow-xl dark:border-neutral-700 dark:bg-neutral-900" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">URL</label>
          <input
            autoFocus
            value={uri}
            onChange={(e) => setUri(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              e.stopPropagation()
            }}
            placeholder="https://example.com"
            className="mb-1.5 w-full rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs outline-none focus:border-brand-500 dark:border-neutral-600 dark:bg-neutral-800"
          />
          <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400">or go to page</label>
          <div className="flex items-center gap-1">
            <input type="number" min={1} max={pageCount} value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.stopPropagation()} className="w-20 rounded border border-neutral-300 bg-white px-1.5 py-1 text-xs outline-none focus:border-brand-500 dark:border-neutral-600 dark:bg-neutral-800" />
            <span className="text-neutral-500">of {pageCount}</span>
            <span className="flex-1" />
            <button type="button" aria-label="Delete link" className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" onClick={() => useViewer.getState().removeOp(id)}>
              <Trash2 size={13} />
            </button>
            <button type="button" aria-label="Done" className="rounded bg-brand-600 p-1 text-white hover:bg-brand-700" onClick={commit}>
              <Check size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
