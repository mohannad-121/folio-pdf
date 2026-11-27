import { Plus } from 'lucide-react'
import type { ToolDef } from '../lib/tools'
import UploadDropzone from '../components/UploadDropzone'
import FileList from './FileList'
import { acceptFor, acceptLabel, allowsMultiple } from './accept'
import type { InputFile } from './types'

interface Props {
  tool: ToolDef
  files: InputFile[]
  /** `slot` is only used by pdf-pair tools (0 = original, 1 = revised). */
  onAdd: (files: File[], slot?: number) => void
  onRemove: (localId: string) => void
  onReorder: (files: InputFile[]) => void
}

const PAIR_LABELS = ['Original', 'Revised'] as const

/** Step 1: pick files. Renders the right dropzone layout for the tool's input kind. */
export default function UploadStep({ tool, files, onAdd, onRemove, onReorder }: Props) {
  const accept = acceptFor(tool.input)
  const multiple = allowsMultiple(tool.input)

  if (tool.input.kind === 'pdf-pair') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {PAIR_LABELS.map((label, slot) => {
          const f = files.find((x) => x.slot === slot)
          return (
            <section key={label} aria-label={`${label} PDF`}>
              <h3 className="mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-300">
                <span className="mr-2 inline-grid h-5 w-5 place-items-center rounded-full bg-brand-600 text-xs text-white">{slot + 1}</span>
                {label}
              </h3>
              {f ? (
                <FileList files={[f]} onRemove={onRemove} />
              ) : (
                <UploadDropzone
                  size="sm"
                  multiple={false}
                  accept={accept}
                  onFiles={(fs) => onAdd(fs.slice(0, 1), slot)}
                  title={`Choose the ${label.toLowerCase()} PDF`}
                  hint="Drop here or click"
                  label={`Upload ${label.toLowerCase()} PDF`}
                  className="py-8"
                />
              )}
            </section>
          )
        })}
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <UploadDropzone
        accept={accept}
        multiple={multiple}
        onFiles={onAdd}
        hint={
          <>
            Accepts {acceptLabel(tool.input)}. {multiple ? 'You can also paste files or drop more later.' : 'You can also paste a file.'}
          </>
        }
        label={`Upload ${acceptLabel(tool.input)}`}
      />
    )
  }

  return (
    <div className="space-y-3">
      <FileList files={files} onRemove={onRemove} onReorder={onReorder} sortable={multiple} />
      {multiple && files.length > 1 && <p className="text-xs text-neutral-500">Drag the handle to change the order. Files are processed top to bottom.</p>}
      {multiple ? (
        <UploadDropzone
          size="sm"
          accept={accept}
          multiple
          onFiles={onAdd}
          title={
            <span className="inline-flex items-center gap-1">
              <Plus size={14} /> Add more files
            </span>
          }
          label="Add more files"
        />
      ) : (
        <UploadDropzone size="sm" accept={accept} multiple={false} onFiles={onAdd} title="Replace with a different file" label="Replace file" />
      )}
    </div>
  )
}
