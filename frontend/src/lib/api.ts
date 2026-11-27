/**
 * API client. This is the ONLY place that knows about HTTP; the desktop wrapper
 * (Tauri/Electron) can swap `API_BASE` to point at a sidecar backend.
 *
 * Every request carries the Supabase access token (`Authorization: Bearer <jwt>`) when the user
 * is signed in. A 403 `mfa_required` opens the authenticator-code dialog and retries once; a 401
 * `invalid_token` refreshes the session and retries once.
 */
import { getAccessToken, refreshAccessToken } from './supabase'
import { requestMfa } from './mfa'

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export interface FileOut {
  file_id: string
  name: string
  size: number
  content_type: string
  download_url: string
  page_count: number | null
}

export interface ToolResult {
  outputs: FileOut[]
  data: Record<string, unknown>
  warnings: string[]
}

export type JobState = 'queued' | 'running' | 'done' | 'error'

export interface JobOut {
  job_id: string
  state: JobState
  progress: number
  message: string
  result: ToolResult | null
  error: string | null
}

export interface PdfPageInfo {
  index: number
  width: number
  height: number
  rotation: number
}

export interface PdfInfo {
  file: FileOut
  page_count: number
  encrypted: boolean
  metadata: Record<string, string | null>
  pages: PdfPageInfo[]
  outline: { level: number; title: string; page: number }[]
  has_forms: boolean
  has_text: boolean
}

/** Gating / error codes the backend puts in `detail.code`. */
export type ApiErrorCode = 'upgrade_required' | 'file_too_large' | 'daily_limit' | 'login_required' | 'mfa_required' | 'invalid_token' | (string & {})

export class ApiError extends Error {
  status: number
  /** Machine-readable code from an object `detail` (e.g. "upgrade_required"). */
  code?: ApiErrorCode
  /** The whole object `detail` (e.g. { required_plan, max_mb, reset_at, … }). */
  data?: Record<string, unknown>
  constructor(status: number, message: string, code?: string, data?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.data = data
  }
}

/** Build an ApiError from a parsed error body (`{detail: string | object | array}`). */
export function apiErrorFrom(status: number, body: unknown, fallback: string): ApiError {
  const detail = body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : body
  if (typeof detail === 'string' && detail) return new ApiError(status, detail)
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>
    const message = typeof d.message === 'string' && d.message ? d.message : typeof d.code === 'string' ? d.code.replace(/_/g, ' ') : JSON.stringify(d)
    return new ApiError(status, message, typeof d.code === 'string' ? d.code : undefined, d)
  }
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{loc, msg, type}]
    const msgs = detail.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : JSON.stringify(x)))
    return new ApiError(status, msgs.join('; ') || fallback)
  }
  return new ApiError(status, fallback)
}

/** True when the response is JSON (an SPA fallback returns HTML for unknown /api routes). */
function isJsonResponse(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('json')
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* not JSON */
    }
    throw apiErrorFrom(res.status, body, res.statusText || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  if (!isJsonResponse(res) && /^\s*</.test(text)) {
    // An HTML page where JSON was expected: the endpoint does not exist on this server.
    throw new ApiError(404, 'This server does not provide that endpoint.', 'not_implemented')
  }
  return JSON.parse(text) as T
}

async function errorCode(res: Response): Promise<string | undefined> {
  if (!(res.headers.get('content-type') ?? '').includes('json')) return undefined
  try {
    const body = (await res.clone().json()) as { detail?: { code?: unknown } }
    return typeof body?.detail?.code === 'string' ? body.detail.code : undefined
  } catch {
    return undefined
  }
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers)
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
  return { credentials: 'include', ...init, headers }
}

/** Fetch an API path with the user's bearer token, handling MFA step-up and token refresh. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${API_BASE}${path}`
  let res = await fetch(url, withAuth(init, await getAccessToken()))
  if (res.status === 401 && (await errorCode(res)) === 'invalid_token') {
    const fresh = await refreshAccessToken()
    if (fresh) res = await fetch(url, withAuth(init, fresh))
  }
  if (res.status === 403 && (await errorCode(res)) === 'mfa_required') {
    if (await requestMfa()) res = await fetch(url, withAuth(init, await getAccessToken()))
  }
  return res
}

/** GET JSON from an API path (e.g. "/api/plans"). */
export async function getJson<T>(path: string): Promise<T> {
  return handle<T>(await apiFetch(path, { headers: { Accept: 'application/json' } }))
}

/** Send JSON with any method. `body` is omitted when undefined. */
export async function sendJson<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return handle<T>(
    await apiFetch(path, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

export function downloadUrl(f: FileOut | string, inline = false): string {
  const id = typeof f === 'string' ? f : f.file_id
  return `${API_BASE}/api/files/${id}/download${inline ? '?inline=1' : ''}`
}

export function renderUrl(fileId: string, page: number, scale = 1.5, password?: string): string {
  const q = new URLSearchParams({ scale: String(scale) })
  if (password) q.set('password', password)
  return `${API_BASE}/api/files/${fileId}/pages/${page}/render?${q}`
}

export async function uploadFiles(files: File[], onProgress?: (frac: number) => void): Promise<FileOut[]> {
  const token = await getAccessToken()
  // XHR so we get upload progress.
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/files`)
    xhr.withCredentials = true
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as FileOut[])
      } else {
        let body: unknown = null
        try {
          body = JSON.parse(xhr.responseText)
        } catch {
          /* not JSON */
        }
        reject(apiErrorFrom(xhr.status, body, xhr.statusText || 'Upload failed'))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(form)
  })
}

export async function getFile(fileId: string): Promise<FileOut> {
  return handle(await apiFetch(`/api/files/${fileId}`))
}

export async function getPdfInfo(fileId: string, password?: string): Promise<PdfInfo> {
  const q = password ? `?password=${encodeURIComponent(password)}` : ''
  return handle(await apiFetch(`/api/files/${fileId}/pdf-info${q}`))
}

export async function getThumbnails(fileId: string, width = 160): Promise<string[]> {
  return handle(await apiFetch(`/api/files/${fileId}/thumbnails?width=${width}`))
}

export async function searchPdf(fileId: string, q: string) {
  return handle<{ query: string; count: number; hits: { page: number; x0: number; y0: number; x1: number; y1: number }[] }>(
    await apiFetch(`/api/files/${fileId}/search?q=${encodeURIComponent(q)}`),
  )
}

export async function deleteFile(fileId: string): Promise<void> {
  await handle<void>(await apiFetch(`/api/files/${fileId}`, { method: 'DELETE' }))
}

/** POST JSON to a tool endpoint. Returns either a ToolResult or a JobOut. */
export async function postJson<T = ToolResult | JobOut>(path: string, body: unknown): Promise<T> {
  return sendJson<T>('POST', path, body)
}

export async function getJob(jobId: string): Promise<JobOut> {
  return handle(await apiFetch(`/api/jobs/${jobId}`))
}

export function isJob(x: unknown): x is JobOut {
  return !!x && typeof x === 'object' && 'job_id' in (x as object) && 'state' in (x as object)
}

/**
 * Run a tool: POST, and if the server returned a job, poll it until done.
 * Resolves with the final ToolResult.
 */
export async function runTool(
  path: string,
  body: unknown,
  onProgress?: (frac: number, message: string) => void,
): Promise<ToolResult> {
  const res = await postJson(path, body)
  if (!isJob(res)) return res
  let job = res
  while (job.state === 'queued' || job.state === 'running') {
    onProgress?.(job.progress, job.message)
    await new Promise((r) => setTimeout(r, 500))
    job = await getJob(job.job_id)
  }
  if (job.state === 'error') {
    // Jobs may fail with a structured gating error (serialised as JSON in `error`).
    const raw = job.error ?? 'Job failed'
    if (raw.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const status = parsed.code === 'daily_limit' ? 429 : parsed.code === 'file_too_large' ? 413 : parsed.code === 'upgrade_required' ? 402 : 500
        throw apiErrorFrom(status, { detail: parsed }, raw)
      } catch (e) {
        if (e instanceof ApiError) throw e
      }
    }
    throw new ApiError(500, raw)
  }
  onProgress?.(1, 'Done')
  return job.result!
}

export async function health() {
  return handle<{ status: string; libreoffice: boolean; tesseract: boolean; pymupdf: string }>(
    await apiFetch('/api/health'),
  )
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
