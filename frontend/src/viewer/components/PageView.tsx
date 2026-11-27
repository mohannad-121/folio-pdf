import clsx from 'clsx'
import { memo, useEffect, useRef, type CSSProperties } from 'react'
import { cssSize, type PageGeom } from '../coords'
import { AnnotationMode, getPage, pdfjsLib, renderPage, type RenderTask } from '../pdfjs'
import { useViewer } from '../store'
import FormsLayer from './FormsLayer'
import OverlayLayer from './OverlayLayer'
import TextEditLayer from './TextEditLayer'

interface Props {
  page: number // 1-based
  geom: PageGeom
  left: number
  top: number
  visible: boolean
}

function PageViewInner({ page, geom, left, top, visible }: Props) {
  const doc = useViewer((s) => s.doc)
  const mode = useViewer((s) => s.mode)
  const hasFields = useViewer((s) => s.fields.length > 0)
  const pageOpsInfo = useViewer((s) => {
    let deleted = false
    let rotate = 0
    for (const p of s.ops) {
      if (!('page' in p.op) || p.op.page !== page) continue
      if (p.op.type === 'delete_page') deleted = true
      if (p.op.type === 'rotate_page') rotate += p.op.angle
    }
    return deleted ? 'deleted' : rotate ? `rot${((rotate % 360) + 360) % 360}` : ''
  })
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const { w, h } = cssSize(geom)
  const formsMode = mode === 'forms' && hasFields

  useEffect(() => {
    const canvas = canvasRef.current
    const textEl = textRef.current
    if (!doc || !visible || !canvas || !textEl) return
    let cancelled = false
    let task: RenderTask | null = null
    const timer = setTimeout(async () => {
      try {
        const pdfPage = await getPage(doc, page)
        if (cancelled) return
        const rotation = (pdfPage.rotate + geom.rotation) % 360
        const off = document.createElement('canvas')
        const r = renderPage(pdfPage, off, geom.scale, rotation, formsMode ? AnnotationMode.ENABLE_FORMS : AnnotationMode.ENABLE)
        task = r.task
        const ok = await r.done
        if (!ok || cancelled) return
        canvas.width = off.width
        canvas.height = off.height
        canvas.getContext('2d')?.drawImage(off, 0, 0)
        // text layer
        textEl.replaceChildren()
        textEl.style.setProperty('--total-scale-factor', String(geom.scale))
        const vp = pdfPage.getViewport({ scale: geom.scale, rotation })
        const tl = new pdfjsLib.TextLayer({ textContentSource: pdfPage.streamTextContent(), container: textEl, viewport: vp })
        await tl.render()
        if (cancelled) return
        const end = document.createElement('div')
        end.className = 'endOfContent'
        textEl.appendChild(end)
      } catch (e) {
        if (!cancelled) console.warn('page render failed', page, e)
      }
    }, 40)
    return () => {
      cancelled = true
      clearTimeout(timer)
      task?.cancel()
    }
  }, [doc, page, geom.scale, geom.rotation, visible, formsMode])

  const style: CSSProperties = { left, top, width: w, height: h }

  return (
    <div className={clsx('v-page', `mode-${mode}`, pageOpsInfo === 'deleted' && 'opacity-50')} style={style} data-page={page}>
      <canvas ref={canvasRef} aria-label={`Page ${page}`} />
      <div ref={textRef} className="textLayer" />
      {visible && mode === 'edit-text' && <TextEditLayer page={page} geom={geom} />}
      {visible && formsMode && <FormsLayer page={page} geom={geom} />}
      {visible && <OverlayLayer page={page} geom={geom} cssW={w} cssH={h} />}
      {pageOpsInfo && (
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-neutral-900/80 px-2 py-0.5 text-[11px] font-medium text-white">
          {pageOpsInfo === 'deleted' ? 'Deleted on save' : `Rotated ${pageOpsInfo.slice(3)}° on save`}
        </div>
      )}
    </div>
  )
}

const PageView = memo(PageViewInner)
export default PageView
