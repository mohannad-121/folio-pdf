import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CircleExclamationPoint, GripVertical, X } from 'lucide-react'
import clsx from 'clsx'
import { formatBytes } from '../lib/api'
import ToolFileThumb from '../components/ToolFileThumb'
import type { InputFile } from './types'

interface Props {
  files: InputFile[]
  onRemove: (localId: string) => void
  onReorder?: (files: InputFile[]) => void
  /** Show drag handles + enable sorting. */
  sortable?: boolean
}

/** List of input files with upload progress, thumbnails and (optionally) drag-to-reorder. */
export default function FileList({ files, onRemove, onReorder, sortable = false }: Props) {
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const canSort = sortable && files.length > 1 && !!onReorder

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id || !onReorder) return
    const from = files.findIndex((f) => f.localId === active.id)
    const to = files.findIndex((f) => f.localId === over.id)
    if (from < 0 || to < 0) return
    onReorder(arrayMove(files, from, to))
  }

  const list = (
    <ul className="divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      {files.map((f, i) => (
        <Row key={f.localId} file={f} index={i} onRemove={onRemove} sortable={canSort} />
      ))}
    </ul>
  )

  if (!canSort) return list
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={files.map((f) => f.localId)} strategy={verticalListSortingStrategy}>
        {list}
      </SortableContext>
    </DndContext>
  )
}

function Row({ file, index, onRemove, sortable }: { file: InputFile; index: number; onRemove: (id: string) => void; sortable: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.localId, disabled: !sortable })
  const style = {
    transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={clsx('relative flex items-center gap-3 px-3 py-2.5', isDragging && 'z-10 bg-brand-50 shadow-md dark:bg-brand-900/30')}
    >
      {sortable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 active:cursor-grabbing dark:hover:bg-neutral-800"
          aria-label={`Reorder ${file.name}`}
        >
          <GripVertical size={16} />
        </button>
      )}
      {sortable && <span className="w-5 text-right text-xs tabular-nums text-neutral-400">{index + 1}</span>}
      <ToolFileThumb name={file.name} contentType={file.content_type} fileId={file.status === 'ready' ? file.file_id : undefined} previewUrl={file.previewUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
          <span>{formatBytes(file.size)}</span>
          {file.page_count != null && (
            <span>
              {file.page_count} page{file.page_count === 1 ? '' : 's'}
            </span>
          )}
          {file.status === 'uploading' && <span className="text-brand-600 dark:text-brand-300">Uploading {Math.round(file.progress * 100)}%</span>}
          {file.status === 'error' && (
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              <CircleExclamationPoint size={12} /> {file.error ?? 'Upload failed'}
            </span>
          )}
        </div>
        {file.status === 'uploading' && (
          <div
            className="mt-1.5 h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(file.progress * 100)}
            aria-label={`Uploading ${file.name}`}
          >
            <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${Math.max(3, file.progress * 100)}%` }} />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(file.localId)}
        className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800"
        aria-label={`Remove ${file.name}`}
      >
        <X size={16} />
      </button>
    </li>
  )
}
