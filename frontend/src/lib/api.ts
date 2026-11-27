/**
 * API client. This is the ONLY place that knows about HTTP; the desktop wrapper
 * (Tauri/Electron) can swap `API_BASE` to point at a sidecar backend.
 */

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

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? body)
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
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
  // XHR so we get upload progress.
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}/api/files`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as FileOut[])
      } else {
        let detail = xhr.statusText
        try {
          detail = JSON.parse(xhr.responseText).detail ?? detail
        } catch {
          /* ignore */
        }
        reject(new ApiError(xhr.status, detail))
      }
    }
    xhr.onerror = () => reject(new ApiError(0, 'Network error'))
    xhr.send(form)
  })
}

export async function getFile(fileId: string): Promise<FileOut> {
  return handle(await fetch(`${API_BASE}/api/files/${fileId}`))
}

export async function getPdfInfo(fileId: string, password?: string): Promise<PdfInfo> {
  const q = password ? `?password=${encodeURIComponent(password)}` : ''
  return handle(await fetch(`${API_BASE}/api/files/${fileId}/pdf-info${q}`))
}

export async function getThumbnails(fileId: string, width = 160): Promise<string[]> {
  return handle(await fetch(`${API_BASE}/api/files/${fileId}/thumbnails?width=${width}`))
}

export async function searchPdf(fileId: string, q: string) {
  return handle<{ query: string; count: number; hits: { page: number; x0: number; y0: number; x1: number; y1: number }[] }>(
    await fetch(`${API_BASE}/api/files/${fileId}/search?q=${encodeURIComponent(q)}`),
  )
}

export async function deleteFile(fileId: string): Promise<void> {
  await handle<void>(await fetch(`${API_BASE}/api/files/${fileId}`, { method: 'DELETE' }))
}

/** POST JSON to a tool endpoint. Returns either a ToolResult or a JobOut. */
export async function postJson<T = ToolResult | JobOut>(path: string, body: unknown): Promise<T> {
  return handle(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export async function getJob(jobId: string): Promise<JobOut> {
  return handle(await fetch(`${API_BASE}/api/jobs/${jobId}`))
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
  if (job.state === 'error') throw new ApiError(500, job.error ?? 'Job failed')
  onProgress?.(1, 'Done')
  return job.result!
}

export async function health() {
  return handle<{ status: string; libreoffice: boolean; tesseract: boolean; pymupdf: string }>(
    await fetch(`${API_BASE}/api/health`),
  )
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}
