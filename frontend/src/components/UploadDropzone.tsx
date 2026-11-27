import { useDropzone, type Accept } from 'react-dropzone'
import { motion, useReducedMotion } from 'motion/react'
import { Upload } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'

interface Props {
  onFiles: (files: File[]) => void
  accept?: Accept
  multiple?: boolean
  disabled?: boolean
  /** Big (default) or compact variant (used for the per-option file picker and "Add more"). */
  size?: 'lg' | 'sm'
  title?: ReactNode
  hint?: ReactNode
  className?: string
  /** Accessible label for the hidden file input. */
  label?: string
}

/**
 * Click-or-drop file picker. Large variant shows a page-stack illustration; the
 * border turns into an accent gradient while dragging. Rejected files are reported inline.
 * Uses `--accent` (set by the tool page) for its colors.
 */
export default function UploadDropzone({ onFiles, accept, multiple = true, disabled, size = 'lg', title, hint, className, label }: Props) {
  const reduce = useReducedMotion()
  const { getRootProps, getInputProps, isDragActive, isDragReject, fileRejections } = useDropzone({
    onDrop: (accepted) => {
      if (accepted.length) onFiles(accepted)
    },
    accept,
    multiple,
    disabled,
    useFsAccessApi: false,
  })

  const rejected = fileRejections.length
  const dragging = isDragActive && !isDragReject
  const lg = size === 'lg'

  return (
    <motion.div
      animate={dragging && !reduce ? { scale: [1, 1.012, 1] } : { scale: 1 }}
      transition={dragging ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.15 }}
      {...(getRootProps({
        className: clsx(
          'group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed text-center transition-[border-color,background-color,box-shadow] duration-200 outline-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent,var(--color-brand-500))]',
          lg ? 'px-6 py-12 sm:py-16' : 'px-4 py-5',
          disabled && 'cursor-not-allowed opacity-60',
          dragging && 'border-transparent shadow-glow [background:linear-gradient(var(--color-surface),var(--color-surface))_padding-box,linear-gradient(135deg,var(--accent,var(--color-brand-500)),color-mix(in_oklab,var(--accent,var(--color-brand-500))_40%,var(--color-cat-review-500)))_border-box]',
          isDragReject && 'border-red-400 bg-red-50 dark:bg-red-950/30',
          !isDragActive && 'border-border-strong bg-surface hover:border-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_60%,var(--color-border-strong))] hover:bg-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_4%,var(--color-surface))]',
          className,
        ),
      }) as object)}
    >
      {/* Soft spotlight behind the icon while dragging. */}
      <span className={clsx('pointer-events-none absolute inset-0 bg-[radial-gradient(400px_circle_at_50%_30%,color-mix(in_oklab,var(--accent,var(--color-brand-500))_12%,transparent),transparent)] transition-opacity duration-300', dragging ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
      <input {...getInputProps({ 'aria-label': label ?? 'Choose files' })} />
      <div className="relative flex flex-col items-center gap-2">
        {lg ? (
          <PageStack dragging={dragging} reject={isDragReject} />
        ) : (
          <span className="grid size-9 place-items-center rounded-full bg-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_12%,transparent)] text-[var(--accent,var(--color-brand-500))] transition-transform duration-200 group-hover:-translate-y-0.5">
            <Upload size={16} />
          </span>
        )}
        <div className={clsx(lg ? 'mt-2 text-lg font-semibold tracking-tight' : 'text-sm font-medium')}>
          {title ?? (isDragReject ? 'This file type is not supported' : isDragActive ? 'Drop to upload' : 'Drop files here or click to browse')}
        </div>
        {hint && <div className="max-w-md text-sm text-muted text-pretty">{hint}</div>}
        {rejected > 0 && (
          <div className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {rejected} file{rejected === 1 ? ' was' : 's were'} skipped: unsupported type.
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** Inline illustration: a stack of three pages with an upload arrow. */
function PageStack({ dragging, reject }: { dragging: boolean; reject: boolean }) {
  const tone = reject ? 'var(--color-red-500)' : 'var(--accent, var(--color-brand-500))'
  return (
    <div className="relative h-24 w-28" aria-hidden="true">
      <svg viewBox="0 0 120 100" className="h-full w-full overflow-visible">
        <g className={clsx('origin-bottom transition-transform duration-300 ease-[var(--ease-spring)]', dragging ? '-rotate-6 -translate-x-1' : 'group-hover:-rotate-3')} style={{ transformOrigin: '60px 100px' }}>
          <rect x="22" y="18" width="56" height="72" rx="6" fill="var(--color-surface-2)" stroke="var(--color-border-strong)" strokeWidth="2" />
        </g>
        <g className={clsx('transition-transform duration-300 ease-[var(--ease-spring)]', dragging ? 'rotate-6 translate-x-1' : 'group-hover:rotate-3')} style={{ transformOrigin: '60px 100px' }}>
          <rect x="42" y="18" width="56" height="72" rx="6" fill="var(--color-surface-2)" stroke="var(--color-border-strong)" strokeWidth="2" />
        </g>
        <g className={clsx('transition-transform duration-300 ease-[var(--ease-spring)]', dragging ? '-translate-y-2' : 'group-hover:-translate-y-1')}>
          <rect x="32" y="10" width="56" height="76" rx="6" fill="var(--color-surface)" stroke={tone} strokeWidth="2.5" />
          <rect x="42" y="26" width="30" height="4" rx="2" fill={tone} opacity="0.6" />
          <rect x="42" y="36" width="36" height="4" rx="2" fill={tone} opacity="0.35" />
          <rect x="42" y="46" width="24" height="4" rx="2" fill={tone} opacity="0.35" />
        </g>
      </svg>
      <motion.span
        className="absolute -right-1 -bottom-1 grid size-9 place-items-center rounded-full text-white shadow-[0_6px_16px_-4px_var(--accent,var(--color-brand-500))]"
        style={{ background: tone }}
        animate={dragging ? { y: [0, -4, 0] } : { y: 0 }}
        transition={dragging ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
      >
        <Upload size={16} className="transition-transform duration-200 group-hover:-translate-y-0.5" />
      </motion.span>
    </div>
  )
}
