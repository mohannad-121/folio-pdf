/** Viewer-specific API helpers (edit / forms / sign / organize / security). */
import { ApiError, downloadUrl, getJson, postJson, runTool, type ToolResult } from '../lib/api'
import type { Annotation, EditOp, FormField, NewFormField, PageImage, PageTextSpans, PdfLink, RectT } from './types'

export async function fetchPdfBytes(fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(downloadUrl(fileId, true), { credentials: 'include' })
  if (!res.ok) throw new ApiError(res.status, `Could not download file (${res.status})`)
  return res.arrayBuffer()
}

export function getAnnotations(fileId: string) {
  return getJson<Annotation[]>(`/api/edit/annotations/${fileId}`)
}

export function getTextSpans(fileId: string, page: number) {
  return getJson<PageTextSpans>(`/api/edit/text-spans/${fileId}/${page}`)
}

export function getImages(fileId: string, page: number) {
  return getJson<PageImage[]>(`/api/edit/images/${fileId}/${page}`)
}

export function getLinks(fileId: string) {
  return getJson<PdfLink[]>(`/api/edit/links/${fileId}`)
}

export function applyEdits(fileId: string, ops: EditOp[], flatten: boolean, onProgress?: (f: number, m: string) => void) {
  return runTool('/api/edit/apply', { file_id: fileId, ops, flatten }, onProgress)
}

export function getFormFields(fileId: string) {
  return getJson<{ fields: FormField[]; has_forms: boolean }>(`/api/forms/fields/${fileId}`)
}

export function addFormFields(fileId: string, fields: NewFormField[]) {
  return runTool('/api/forms/add-fields', { file_id: fileId, fields })
}

export interface SignatureImageRequest {
  kind: 'draw' | 'type'
  paths?: [number, number][][]
  text?: string
  font?: 'cursive' | 'serif' | 'sans'
  color: string
  width: number
}

export function createSignatureImage(req: SignatureImageRequest): Promise<ToolResult> {
  return runTool('/api/sign/signature-image', req)
}

export function reorderPages(fileId: string, pages: { source_page: number; rotation: number }[]) {
  return runTool('/api/organize/reorder', { file_id: fileId, pages })
}

export interface RedactQuery {
  terms: string[]
  emails: boolean
  phones: boolean
  ssn: boolean
  credit_cards: boolean
  regex: string
}

export interface RedactMatch {
  page: number
  rect: RectT
  text?: string
}

/** Preview search-and-redact matches. The response shape is normalised to {page, rect}. */
export async function redactPreview(fileId: string, q: RedactQuery): Promise<RedactMatch[]> {
  const params = new URLSearchParams()
  for (const t of q.terms) params.append('terms', t)
  if (q.emails) params.set('emails', 'true')
  if (q.phones) params.set('phones', 'true')
  if (q.ssn) params.set('ssn', 'true')
  if (q.credit_cards) params.set('credit_cards', 'true')
  if (q.regex) params.set('regex', q.regex)
  const raw = await getJson<unknown>(`/api/security/redact/preview/${fileId}?${params}`)
  return normaliseMatches(raw)
}

function normaliseMatches(raw: unknown): RedactMatch[] {
  const out: RedactMatch[] = []
  const list: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).matches as unknown[] | undefined) ??
        ((raw as Record<string, unknown>).hits as unknown[] | undefined) ??
        []
      : []
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    const o = m as Record<string, unknown>
    const page = Number(o.page)
    let rect: RectT | null = null
    if (Array.isArray(o.rect) && o.rect.length === 4) rect = o.rect.map(Number) as RectT
    else if ('x0' in o) rect = [Number(o.x0), Number(o.y0), Number(o.x1), Number(o.y1)]
    else if (Array.isArray(o.rects)) {
      for (const r of o.rects as unknown[]) {
        if (Array.isArray(r) && r.length === 4) out.push({ page, rect: r.map(Number) as RectT, text: typeof o.text === 'string' ? o.text : undefined })
      }
      continue
    }
    if (rect && Number.isFinite(page)) out.push({ page, rect, text: typeof o.text === 'string' ? o.text : undefined })
  }
  return out
}

export function getPageText(fileId: string, pages: string, password?: string) {
  const q = new URLSearchParams({ pages })
  if (password) q.set('password', password)
  return getJson<{ page: number; text: string }[]>(`/api/files/${fileId}/text?${q}`)
}

export { postJson }
