import type { ToolInput } from '../lib/tools'

/** react-dropzone `accept` map (mime -> extensions) for a tool input kind. `undefined` = anything. */
export type AcceptMap = Record<string, string[]>

const OFFICE: AcceptMap = {
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/rtf': ['.rtf'],
  'text/rtf': ['.rtf'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'text/csv': ['.csv'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.oasis.opendocument.presentation': ['.odp'],
}

export function acceptFor(input: ToolInput): AcceptMap | undefined {
  switch (input.kind) {
    case 'pdf':
    case 'pdf-pair':
      return { 'application/pdf': ['.pdf'] }
    case 'images':
      return { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif'] }
    case 'office':
      return OFFICE
    case 'html':
      return { 'text/html': ['.html', '.htm'] }
    case 'any':
      return undefined
  }
}

/** Human-readable hint for the dropzone. */
export function acceptLabel(input: ToolInput): string {
  switch (input.kind) {
    case 'pdf':
      return input.multiple ? 'PDF files' : 'a PDF file'
    case 'pdf-pair':
      return 'two PDF files'
    case 'images':
      return 'JPG, PNG, WebP, TIFF, HEIC images'
    case 'office':
      return 'Word, Excel or PowerPoint documents'
    case 'html':
      return 'an HTML file'
    case 'any':
      return input.multiple ? 'PDFs, images or documents' : 'any file'
  }
}

/** Whether a tool input accepts more than one file. */
export function allowsMultiple(input: ToolInput): boolean {
  return input.kind === 'pdf-pair' || input.kind === 'images' || ('multiple' in input && !!input.multiple)
}

/** Maximum file count (Infinity when unbounded). */
export function maxFiles(input: ToolInput): number {
  if (input.kind === 'pdf-pair') return 2
  return allowsMultiple(input) ? Infinity : 1
}

/** Whether an already-stored file (by content type / name) fits the input kind. */
export function fileMatches(input: ToolInput, contentType: string, name: string): boolean {
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  const map = acceptFor(input)
  if (!map) return true
  for (const [mime, exts] of Object.entries(map)) {
    if (mime.endsWith('/*') ? contentType.startsWith(mime.slice(0, -1)) : contentType === mime) return true
    if (exts.includes(ext)) return true
  }
  return false
}
