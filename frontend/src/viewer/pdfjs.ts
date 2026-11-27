/** pdf.js loader and small render helpers. */
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjsLib }
export type { PDFDocumentProxy, PDFPageProxy, RenderTask }

export const AnnotationMode = pdfjsLib.AnnotationMode

export class PasswordRequiredError extends Error {
  constructor() {
    super('Password required')
  }
}

export async function loadDocument(data: ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(data), password })
  try {
    return await task.promise
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name === 'PasswordException') throw new PasswordRequiredError()
    throw e
  }
}

const pageCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<PDFPageProxy>>>()

export function getPage(doc: PDFDocumentProxy, pageNumber: number): Promise<PDFPageProxy> {
  let m = pageCache.get(doc)
  if (!m) {
    m = new Map()
    pageCache.set(doc, m)
  }
  let p = m.get(pageNumber)
  if (!p) {
    p = doc.getPage(pageNumber)
    m.set(pageNumber, p)
  }
  return p
}

export interface TextItemBox {
  str: string
  rect: [number, number, number, number]
  hasEOL: boolean
}

/**
 * Get text items for a page with their boxes in displayed-page points
 * (top-left origin), suitable for client-side search.
 */
export async function getTextItems(page: PDFPageProxy): Promise<TextItemBox[]> {
  const content = await page.getTextContent()
  const vp = page.getViewport({ scale: 1, rotation: page.rotate })
  const out: TextItemBox[] = []
  for (const item of content.items) {
    if (!('str' in item)) continue
    const [, , , , e, f] = item.transform
    const a = vp.convertToViewportPoint(e, f) as [number, number]
    const b = vp.convertToViewportPoint(e + item.width, f + item.height) as [number, number]
    out.push({
      str: item.str,
      rect: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
      hasEOL: item.hasEOL,
    })
  }
  return out
}

/** Render a page to a canvas (HiDPI aware). Resolves false if cancelled. */
export function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  rotation: number,
  annotationMode: number,
): { task: RenderTask; done: Promise<boolean> } {
  let dpr = Math.min(window.devicePixelRatio || 1, 3)
  let vp = page.getViewport({ scale: scale * dpr, rotation })
  // Stay under typical browser canvas limits (~16k px per side, ~32M px area).
  const MAX_SIDE = 16000
  const MAX_AREA = 32_000_000
  const shrink = Math.min(1, MAX_SIDE / Math.max(vp.width, vp.height), Math.sqrt(MAX_AREA / (vp.width * vp.height)))
  if (shrink < 1) {
    dpr *= shrink
    vp = page.getViewport({ scale: scale * dpr, rotation })
  }
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  const task = page.render({ canvas, viewport: vp, annotationMode })
  const done = task.promise.then(
    () => true,
    () => false,
  )
  return { task, done }
}
