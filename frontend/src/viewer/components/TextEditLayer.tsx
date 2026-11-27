/** "Edit existing text" layer: hoverable line boxes; click a line to retype it. */
import { useEffect, useMemo, useState } from 'react'
import { getTextSpans } from '../api'
import { pdfRectToCss, type PageGeom } from '../coords'
import { useViewer } from '../store'
import type { TextLine } from '../types'
import { fontFamily, guessFont } from '../fonts'

export default function TextEditLayer({ page, geom }: { page: number; geom: PageGeom }) {
  const fileId = useViewer((s) => s.fileId)
  const spans = useViewer((s) => s.textSpans[page])
  const ops = useViewer((s) => s.ops)
  const [editing, setEditing] = useState<{ line: TextLine; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!fileId || spans) return
    let cancelled = false
    getTextSpans(fileId, page)
      .then((d) => {
        if (!cancelled) useViewer.getState().setTextSpans(page, d)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [fileId, page, spans])

  const lines = useMemo(() => {
    if (!spans) return []
    const out: TextLine[] = []
    for (const b of spans.blocks) for (const l of b.lines) if (l.spans.some((s) => s.text.trim())) out.push(l)
    return out
  }, [spans])

  // Lines already replaced by a pending op are hidden (the op renders instead).
  const replacedKeys = useMemo(() => {
    const set = new Set<string>()
    for (const p of ops) if (p.op.type === 'replace_text' && p.op.page === page) set.add(p.op.rect.map((n) => n.toFixed(1)).join(','))
    return set
  }, [ops, page])

  const commit = () => {
    if (!editing) return
    const { line, value } = editing
    setEditing(null)
    const original = line.spans.map((s) => s.text).join('')
    if (value === original) return
    const first = line.spans[0]
    useViewer.getState().addOp(
      {
        type: 'replace_text',
        page,
        rect: line.bbox,
        text: value,
        font_size: first?.size,
        color: first?.color,
        font: guessFont(first),
      },
      false,
    )
  }

  if (error) return <div className="absolute left-2 top-8 z-10 rounded bg-red-600/90 px-2 py-1 text-xs text-white">Text spans unavailable: {error}</div>

  return (
    <div className="absolute inset-0 z-[2]">
      {lines.map((line, i) => {
        const key = line.bbox.map((n) => n.toFixed(1)).join(',')
        if (replacedKeys.has(key)) return null
        const css = pdfRectToCss(geom, line.bbox)
        const isEditing = editing?.line === line
        const first = line.spans[0]
        if (isEditing) {
          return (
            <textarea
              key={i}
              autoFocus
              value={editing.value}
              onChange={(e) => setEditing({ line, value: e.target.value })}
              onBlur={commit}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  commit()
                }
                if (e.key === 'Escape') setEditing(null)
              }}
              onFocus={(e) => e.target.select()}
              className="absolute z-10 resize-none overflow-hidden whitespace-pre bg-white text-black outline-none ring-2 ring-brand-500"
              style={{
                left: css.left - 2,
                top: css.top - 2,
                width: Math.max(css.width + 40, 80),
                height: css.height + 4,
                fontSize: (first?.size ?? 11) * geom.scale,
                fontFamily: fontFamily(guessFont(first)),
                fontWeight: first?.bold ? 700 : 400,
                fontStyle: first?.italic ? 'italic' : 'normal',
                lineHeight: `${css.height}px`,
                padding: '2px',
                color: first?.color ?? '#000',
              }}
            />
          )
        }
        return (
          <div
            key={i}
            className="v-line-box"
            style={{ left: css.left - 1, top: css.top - 1, width: css.width + 2, height: css.height + 2 }}
            title="Click to edit this line"
            onClick={(e) => {
              e.stopPropagation()
              setEditing({ line, value: line.spans.map((s) => s.text).join('') })
            }}
          />
        )
      })}
      {!spans && !error && <div className="absolute left-2 top-8 z-10 rounded bg-neutral-900/70 px-2 py-1 text-xs text-white">Loading text…</div>}
    </div>
  )
}
