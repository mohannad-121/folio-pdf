import { useDropzone, type Accept } from 'react-dropzone'
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

/** Click-or-drop file picker. Rejected files (wrong type) are reported inline. */
export default function UploadDropzone({ onFiles, accept, multiple = true, disabled, size = 'lg', title, hint, className, label }: Props) {
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

  return (
    <div
      {...getRootProps({
        className: clsx(
          'group cursor-pointer rounded-xl border-2 border-dashed text-center transition outline-none',
          'focus-visible:ring-2 focus-visible:ring-brand-300',
          size === 'lg' ? 'px-6 py-12 sm:py-16' : 'px-4 py-5',
          disabled && 'cursor-not-allowed opacity-60',
          isDragActive && !isDragReject && 'border-brand-500 bg-brand-50 dark:bg-brand-900/30',
          isDragReject && 'border-red-400 bg-red-50 dark:bg-red-950/30',
          !isDragActive && 'border-neutral-300 bg-white hover:border-brand-400 hover:bg-brand-50/50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-brand-600 dark:hover:bg-neutral-800/60',
          className,
        ),
      })}
    >
      <input {...getInputProps({ 'aria-label': label ?? 'Choose files' })} />
      <div className="flex flex-col items-center gap-2">
        <span
          className={clsx(
            'grid place-items-center rounded-full bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-900/40 dark:text-brand-200',
            size === 'lg' ? 'h-14 w-14' : 'h-9 w-9',
          )}
        >
          <Upload size={size === 'lg' ? 26 : 16} />
        </span>
        <div className={clsx(size === 'lg' ? 'text-lg font-medium' : 'text-sm font-medium')}>
          {title ?? (isDragActive ? 'Drop to upload' : 'Drop files here or click to browse')}
        </div>
        {hint && <div className="text-sm text-neutral-500">{hint}</div>}
        {rejected > 0 && (
          <div className="mt-1 text-sm text-red-600 dark:text-red-400" role="alert">
            {rejected} file{rejected === 1 ? ' was' : 's were'} skipped: unsupported type.
          </div>
        )}
      </div>
    </div>
  )
}
