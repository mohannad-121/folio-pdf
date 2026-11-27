/** Organize mode: page grid with drag-and-drop reorder, rotate, delete, duplicate, insert blank. */
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import clsx from 'clsx'
import { Check, CheckSquare, Copy, FilePlus2, RotateCcw, RotateCw, Square, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { renderUrl } from '../../lib/api'
import { applyEdits, reorderPages } from '../api'
import { newId } from '../ops'
import { pageOrderOf, useViewer } from '../store'
import type { EditOp } from '../types'
import { btnCls, btnPrimaryCls, IconButton, Spinner } from './ui'

interface Item {
  key: string
  source: number | null // 1-based source page, or null for a blank page
  rotation: number
}

export default function OrganizeGrid() {
  const info = useViewer((s) => s.info)
  const fileId = useViewer((s) => s.fileId)
  const password = useViewer((s) => s.password)
  const navigate = useNavigate()
  // Start from the order the pages were dragged into in the sidebar (if any).
  const [items, setItems] = useState<Item[]>(() => (info ? pageOrderOf(useViewer.getState().ops, info.page_count).map((p) => ({ key: newId(), source: p, rotation: 0 })) : []))
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const original = useMemo(() => (info ? info.pages.map((_, i) => i + 1) : []), [info])
  const changed = items.length !== original.length || items.some((it, i) => it.source !== original[i] || it.rotation !== 0)

  if (!info || !fileId) return null

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setItems((list) => arrayMove(list, list.findIndex((i) => i.key === active.id), list.findIndex((i) => i.key === over.id)))
  }

  const targets = (key?: string) => (key && !selected.has(key) ? new Set([key]) : selected.size ? selected : key ? new Set([key]) : new Set<string>())
  const rotate = (delta: number, key?: string) => {
    const t = targets(key)
    setItems((list) => list.map((i) => (t.has(i.key) ? { ...i, rotation: (((i.rotation + delta) % 360) + 360) % 360 } : i)))
  }
  const remove = (key?: string) => {
    const t = targets(key)
    setItems((list) => (list.length - t.size >= 1 ? list.filter((i) => !t.has(i.key)) : list))
    setSelected(new Set())
  }
  const duplicate = (key?: string) => {
    const t = targets(key)
    setItems((list) => list.flatMap((i) => (t.has(i.key) ? [i, { ...i, key: newId() }] : [i])))
  }
  const insertBlank = (afterKey?: string) => {
    setItems((list) => {
      const idx = afterKey ? list.findIndex((i) => i.key === afterKey) : list.length - 1
      const next = list.slice()
      next.splice(idx + 1, 0, { key: newId(), source: null, rotation: 0 })
      return next
    })
  }
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })

  const apply = async () => {
    const s = useViewer.getState()
    if (s.ops.length || s.newFields.length) {
      if (!window.confirm('You have unsaved edits that will be discarded when reorganising pages. Continue?')) return
    }
    setBusy(true)
    try {
      const real = items.filter((i) => i.source != null)
      let res = await reorderPages(fileId, real.map((i) => ({ source_page: i.source!, rotation: i.rotation })))
      let outId = res.outputs[0]?.file_id
      if (!outId) throw new Error('No output file returned')
      // Blank pages: insert afterwards (positions refer to the reordered document).
      const blanks: EditOp[] = []
      let realIndex = 0
      items.forEach((it) => {
        if (it.source == null) blanks.push({ type: 'insert_blank_page', page: Math.max(1, realIndex), after_page: realIndex })
        else realIndex++
      })
      if (blanks.length) {
        // Insert from the back so earlier indices stay valid.
        res = await applyEdits(outId, blanks.reverse(), false)
        outId = res.outputs[0]?.file_id ?? outId
      }
      for (const w of res.warnings ?? []) s.notify('warning', w)
      s.clearEdits()
      s.notify('success', 'Pages reorganised')
      navigate(`/view/${outId}${window.location.search}`)
    } catch (e) {
      s.notify('error', `Reorganise failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-neutral-200/80 dark:bg-neutral-900">
      <div className="flex h-10 items-center gap-1 border-b border-neutral-200 bg-white px-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
        <button type="button" className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.key)))}>
          {selected.size === items.length ? <CheckSquare size={14} /> : <Square size={14} />}
          {selected.size ? `${selected.size} selected` : 'Select all'}
        </button>
        <span className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
        <IconButton label="Rotate left" disabled={!selected.size} onClick={() => rotate(-90)}>
          <RotateCcw size={15} />
        </IconButton>
        <IconButton label="Rotate right" disabled={!selected.size} onClick={() => rotate(90)}>
          <RotateCw size={15} />
        </IconButton>
        <IconButton label="Duplicate" disabled={!selected.size} onClick={() => duplicate()}>
          <Copy size={15} />
        </IconButton>
        <IconButton label="Delete" danger disabled={!selected.size || selected.size >= items.length} onClick={() => remove()}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton label="Insert blank page at end" onClick={() => insertBlank()}>
          <FilePlus2 size={15} />
        </IconButton>
        <span className="flex-1" />
        <button type="button" className={btnCls} disabled={!changed} onClick={() => (setItems(info.pages.map((_, i) => ({ key: newId(), source: i + 1, rotation: 0 }))), setSelected(new Set()))}>
          <Undo2 size={14} /> Reset
        </button>
        <button type="button" className={btnPrimaryCls} disabled={!changed || busy} onClick={() => void apply()}>
          {busy ? <Spinner className="border-white/40 border-t-white" /> : <Check size={14} />} Apply
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.key)} strategy={rectSortingStrategy}>
            <div className="v-thumb-grid">
              {items.map((it, idx) => (
                <PageCard
                  key={it.key}
                  item={it}
                  index={idx}
                  selected={selected.has(it.key)}
                  src={it.source != null ? renderUrl(fileId, it.source, 0.3, password) : null}
                  aspect={it.source != null ? info.pages[it.source - 1].height / Math.max(1, info.pages[it.source - 1].width) : 11 / 8.5}
                  onToggle={() => toggle(it.key)}
                  onRotate={(d) => rotate(d, it.key)}
                  onDelete={() => remove(it.key)}
                  onDuplicate={() => duplicate(it.key)}
                  onInsertBlank={() => insertBlank(it.key)}
                  canDelete={items.length > 1}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  )
}

function PageCard({
  item,
  index,
  selected,
  src,
  aspect,
  onToggle,
  onRotate,
  onDelete,
  onDuplicate,
  onInsertBlank,
  canDelete,
}: {
  item: Item
  index: number
  selected: boolean
  src: string | null
  aspect: number
  onToggle: () => void
  onRotate: (d: number) => void
  onDelete: () => void
  onDuplicate: () => void
  onInsertBlank: () => void
  canDelete: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.key })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const swapped = item.rotation % 180 !== 0
  return (
    <div ref={setNodeRef} style={style} className={clsx('group relative flex flex-col items-center gap-1 rounded-lg border bg-white p-2 shadow-sm transition dark:bg-neutral-800', selected ? 'border-brand-500 ring-2 ring-brand-500/40' : 'border-neutral-200 dark:border-neutral-700', isDragging && 'z-10 opacity-80 shadow-xl')}>
      <button type="button" aria-label={selected ? 'Deselect' : 'Select'} onClick={onToggle} className={clsx('absolute left-2 top-2 z-10 grid h-5 w-5 place-items-center rounded border bg-white text-brand-600 dark:bg-neutral-900', selected ? 'border-brand-500' : 'border-neutral-300 opacity-0 group-hover:opacity-100')}>
        {selected && <Check size={12} />}
      </button>
      <div {...attributes} {...listeners} className="flex w-full cursor-grab items-center justify-center overflow-hidden rounded bg-neutral-100 active:cursor-grabbing dark:bg-neutral-700" style={{ aspectRatio: `1 / ${Math.max(0.5, aspect)}` }}>
        {src ? (
          <img src={src} alt={`Page ${item.source}`} draggable={false} loading="lazy" className="max-h-full max-w-full object-contain shadow" style={{ transform: `rotate(${item.rotation}deg)${swapped ? ` scale(${1 / Math.max(aspect, 1 / aspect)})` : ''}` }} />
        ) : (
          <div className="grid h-full w-full place-items-center bg-white text-xs text-neutral-400 dark:bg-neutral-200">Blank page</div>
        )}
      </div>
      <div className="flex w-full items-center justify-between text-xs">
        <span className="tabular-nums text-neutral-500">
          {index + 1}
          {item.source != null && item.source !== index + 1 && <span className="text-neutral-400"> (was {item.source})</span>}
        </span>
        {item.rotation !== 0 && <span className="rounded bg-neutral-100 px-1 text-[10px] text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">{item.rotation}°</span>}
      </div>
      <div className="flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
        <IconButton label="Rotate left" onClick={() => onRotate(-90)} className="h-7 w-7">
          <RotateCcw size={14} />
        </IconButton>
        <IconButton label="Rotate right" onClick={() => onRotate(90)} className="h-7 w-7">
          <RotateCw size={14} />
        </IconButton>
        <IconButton label="Duplicate" onClick={onDuplicate} className="h-7 w-7">
          <Copy size={14} />
        </IconButton>
        <IconButton label="Insert blank after" onClick={onInsertBlank} className="h-7 w-7">
          <FilePlus2 size={14} />
        </IconButton>
        <IconButton label="Delete" danger disabled={!canDelete} onClick={onDelete} className="h-7 w-7">
          <Trash2 size={14} />
        </IconButton>
      </div>
    </div>
  )
}
