import type { FileOut } from '../lib/api'

/** An input file on a tool page: either still uploading or stored on the server. */
export interface InputFile {
  /** Stable client-side id (for React keys and dnd-kit). */
  localId: string
  name: string
  size: number
  content_type: string
  status: 'uploading' | 'ready' | 'error'
  /** 0..1 upload progress. */
  progress: number
  file_id?: string
  page_count: number | null
  error?: string
  /** Object URL for local image previews (revoked on removal). */
  previewUrl?: string
  /** pdf-pair tools only: 0 = original, 1 = revised. */
  slot?: number
}

/** Option form values keyed by option key. File options hold the uploaded file_id. */
export type OptionValues = Record<string, string | number | boolean | undefined>

export function inputFromFileOut(f: FileOut): InputFile {
  return {
    localId: `srv-${f.file_id}`,
    name: f.name,
    size: f.size,
    content_type: f.content_type,
    status: 'ready',
    progress: 1,
    file_id: f.file_id,
    page_count: f.page_count,
  }
}

export function isPdfType(contentType: string, name = ''): boolean {
  return contentType === 'application/pdf' || /\.pdf$/i.test(name)
}

export function isImageType(contentType: string, name = ''): boolean {
  return contentType.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|svg)$/i.test(name)
}

let counter = 0
export function nextLocalId(): string {
  counter += 1
  return `loc-${Date.now().toString(36)}-${counter}`
}
