import { createElement, useState } from 'react'
import clsx from 'clsx'
import { downloadUrl, renderUrl } from '../lib/api'
import { fileIconFor } from './ToolFileIcon'

interface Props {
  name: string
  contentType: string
  /** Server file id (needed for PDF page renders / inline image previews). */
  fileId?: string
  /** Local object URL for not-yet-uploaded images. */
  previewUrl?: string
  /** Render scale for the PDF first-page thumbnail. */
  scale?: number
  className?: string
}

/** Small thumbnail: PDF first page, image preview, or a type icon. */
export default function ToolFileThumb({ name, contentType, fileId, previewUrl, scale = 0.25, className }: Props) {
  const [failed, setFailed] = useState(false)
  const isPdf = contentType === 'application/pdf' || /\.pdf$/i.test(name)
  const isImage = contentType.startsWith('image/')
  let src: string | undefined
  if (!failed) {
    if (isPdf && fileId) src = renderUrl(fileId, 1, scale)
    else if (isImage) src = previewUrl ?? (fileId ? downloadUrl(fileId, true) : undefined)
  }
  const icon = createElement(fileIconFor(contentType, name), { size: 20 })

  return (
    <div
      className={clsx(
        'grid shrink-0 place-items-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800',
        className ?? 'h-14 w-11',
      )}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} /> : icon}
    </div>
  )
}
