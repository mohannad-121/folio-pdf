import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CircleExclamationPoint, Download, EllipsisVertical, ExternalLink, GripVertical, Trash, X } from 'lucide-react'
import clsx from 'clsx'
import { downloadUrl, formatBytes } from '../lib/api'
import { pop, tween } from '../lib/motion'
import ToolFileThumb from '../components/ToolFileThumb'
import { Badge, ProgressBar } from '../components/ui'
import { isPdfType, type InputFile } from './types'

interface Props {
  files: InputFile[]
  onRemove: (localId: string) => void
  onReorder?: (files: InputFile[]) => void
  /** Show drag handles + enable sorting. */
  sortable?: boolean
}

/** List of input files with upload progress, thumbnails, kebab actions and (optionally) drag-to-reorder. */
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
    <ul className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      <AnimatePresence initial={false}>
        {files.map((f, i) => (
          <Row key={f.localId} file={f} index={i} onRemove={onRemove} sortable={canSort} first={i === 0} />
        ))}
      </AnimatePresence>
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

function Row({ file, index, onRemove, sortable, first }: { file: InputFile; index: number; onRemove: (id: string) => void; sortable: boolean; first: boolean }) {
  const reduce = useReducedMotion()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: file.localId, disabled: !sortable })
  const isPdf = isPdfType(file.content_type, file.name)
  const ready = file.status === 'ready' && !!file.file_id

  return (
    <motion.li
      ref={setNodeRef}
      layout={!sortable && !reduce}
      initial={reduce ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduce ? undefined : { opacity: 0, x: -12, height: 0, transition: { duration: 0.15 } }}
      transition={tween}
      style={{ x: transform ? Math.round(transform.x) : 0, y: transform ? Math.round(transform.y) : 0, transition }}
      className={clsx(
        'relative flex items-center gap-3 px-3 py-2.5',
        !first && 'border-t border-border',
        isDragging && 'z-10 bg-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_8%,var(--color-surface))] shadow-lift',
      )}
    >
      {sortable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="-ml-1 cursor-grab touch-none rounded-md p-1 text-muted-2 transition hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
          aria-label={`Reorder ${file.name}`}
        >
          <GripVertical size={16} />
        </button>
      )}
      {sortable && <span className="w-5 text-right text-xs text-muted-2 tabular">{index + 1}</span>}
      <ToolFileThumb name={file.name} contentType={file.content_type} fileId={ready ? file.file_id : undefined} previewUrl={file.previewUrl} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" title={file.name}>
          {file.name}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span className="tabular">{formatBytes(file.size)}</span>
          {file.page_count != null && (
            <span className="tabular">
              {file.page_count} page{file.page_count === 1 ? '' : 's'}
            </span>
          )}
          {file.status === 'uploading' && (
            <span className="text-[var(--accent,var(--color-brand-600))] tabular">Uploading {Math.round(file.progress * 100)}%</span>
          )}
          {file.status === 'ready' && <Badge tone="success">Ready</Badge>}
          {file.status === 'error' && (
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
              <CircleExclamationPoint size={12} /> {file.error ?? 'Upload failed'}
            </span>
          )}
        </div>
        {file.status === 'uploading' && <ProgressBar value={file.progress} size="xs" className="mt-1.5" label={`Uploading ${file.name}`} />}
      </div>
      <RowMenu file={file} isPdf={isPdf && ready} onRemove={() => onRemove(file.localId)} />
    </motion.li>
  )
}

function RowMenu({ file, isPdf, onRemove }: { file: InputFile; isPdf: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const ready = file.status === 'ready' && !!file.file_id

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!ready) {
    return (
      <button type="button" onClick={onRemove} className="rounded-md p-1.5 text-muted-2 transition hover:bg-surface-2 hover:text-red-600" aria-label={`Remove ${file.name}`}>
        <X size={16} />
      </button>
    )
  }

  const item = 'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition hover:bg-surface-2'
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={`Actions for ${file.name}`} className={clsx('rounded-md p-1.5 text-muted-2 transition hover:bg-surface-2 hover:text-fg', open && 'bg-surface-2 text-fg')}>
        <EllipsisVertical size={16} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div role="menu" variants={reduce ? undefined : pop} initial="initial" animate="animate" exit="exit" className="absolute top-full right-0 z-20 mt-1 w-44 origin-top-right rounded-xl border border-border bg-surface p-1 shadow-lift">
            {isPdf && (
              <Link role="menuitem" to={`/view/${file.file_id}`} className={item} onClick={() => setOpen(false)}>
                <ExternalLink size={14} className="text-muted" /> Open in viewer
              </Link>
            )}
            <a role="menuitem" href={downloadUrl(file.file_id as string)} download={file.name} className={item} onClick={() => setOpen(false)}>
              <Download size={14} className="text-muted" /> Download
            </a>
            <button
              type="button"
              role="menuitem"
              className={clsx(item, 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10')}
              onClick={() => {
                setOpen(false)
                onRemove()
              }}
            >
              <Trash size={14} /> Remove
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
