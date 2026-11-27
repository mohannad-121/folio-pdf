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

/** Small thumbnail: PDF first page, image preview, or a type icon. Shimmers until the image loads. */
export default function ToolFileThumb({ name, contentType, fileId, previewUrl, scale = 0.25, className }: Props) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
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
        'relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-surface-2 text-muted-2 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.4)] dark:shadow-none',
        className ?? 'h-14 w-11',
      )}
      aria-hidden="true"
    >
      {src ? (
        <>
          {!loaded && <span className="skeleton absolute inset-0" />}
          <img
            src={src}
            alt=""
            className={clsx('h-full w-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
            loading="lazy"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      ) : (
        icon
      )}
    </div>
  )
}
