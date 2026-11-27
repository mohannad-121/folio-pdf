import { File, FileArchive, FileCode, FileImage, FileSpreadsheet, FileText, Presentation, FileType } from 'lucide-react'

/** Resolve a lucide icon for a file by its content type / extension. */
export function fileIconFor(contentType: string, name: string) {
  const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  if (contentType === 'application/pdf' || ext === '.pdf') return FileText
  if (contentType.startsWith('image/')) return FileImage
  if (ext === '.zip' || contentType.includes('zip')) return FileArchive
  if (['.xlsx', '.xls', '.ods', '.csv'].includes(ext) || contentType.includes('sheet') || contentType.includes('excel')) return FileSpreadsheet
  if (['.pptx', '.ppt', '.odp'].includes(ext) || contentType.includes('presentation')) return Presentation
  if (['.docx', '.doc', '.odt', '.rtf'].includes(ext) || contentType.includes('word')) return FileType
  if (['.html', '.htm', '.json', '.xml', '.md', '.txt', '.fdf'].includes(ext) || contentType.startsWith('text/')) return FileCode
  return File
}
