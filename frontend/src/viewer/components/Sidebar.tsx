import clsx from 'clsx'
import { FilePlus2, FormInput, Images, List, MessageSquare, RotateCcw, RotateCw, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { renderUrl } from '../../lib/api'
import { opBounds, opColor, opLabel, opSummary } from '../ops'
import { useViewer } from '../store'
import type { SidebarTab } from '../types'
import { useFormValues } from '../hooks/useFormValues'
import SearchPanel from './SearchPanel'

const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: 'thumbnails', label: 'Pages', icon: <Images size={16} /> },
  { id: 'outline', label: 'Outline', icon: <List size={16} /> },
  { id: 'annotations', label: 'Comments', icon: <MessageSquare size={16} /> },
  { id: 'search', label: 'Search', icon: <Search size={16} /> },
  { id: 'forms', label: 'Fields', icon: <FormInput size={16} /> },
]

export default function Sidebar() {
  const tab = useViewer((s) => s.sidebarTab)
  const setSidebar = useViewer((s) => s.setSidebar)
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-center border-b border-neutral-200 dark:border-neutral-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            data-tip={t.label}
            data-tip-side="bottom"
            aria-label={t.label}
            onClick={() => setSidebar(true, t.id)}
            className={clsx('v-tip relative flex h-10 flex-1 items-center justify-center border-b-2 transition', tab === t.id ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-white')}
          >
            {t.icon}
          </button>
        ))}
        <button type="button" aria-label="Close sidebar" onClick={() => setSidebar(false)} className="grid h-10 w-8 place-items-center text-neutral-400 hover:text-neutral-700 dark:hover:text-white">
          <X size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'thumbnails' && <ThumbnailsPanel />}
        {tab === 'outline' && <OutlinePanel />}
        {tab === 'annotations' && <AnnotationsPanel />}
        {tab === 'search' && <SearchPanel />}
        {tab === 'forms' && <FormsPanel />}
      </div>
    </aside>
  )
}

// ---- Thumbnails ------------------------------------------------------------------

function ThumbnailsPanel() {
  const info = useViewer((s) => s.info)
  const fileId = useViewer((s) => s.fileId)
  const password = useViewer((s) => s.password)
  const currentPage = useViewer((s) => s.currentPage)
  const ops = useViewer((s) => s.ops)
  const [menu, setMenu] = useState<{ page: number; x: number; y: number } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [currentPage])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])

  const pageState = useMemo(() => {
    const m = new Map<number, { deleted: boolean; rotate: number }>()
    for (const p of ops) {
      if (!('page' in p.op)) continue
      const cur = m.get(p.op.page) ?? { deleted: false, rotate: 0 }
      if (p.op.type === 'delete_page') cur.deleted = true
      if (p.op.type === 'rotate_page') cur.rotate += p.op.angle
      m.set(p.op.page, cur)
    }
    return m
  }, [ops])

  if (!info || !fileId) return null
  const s = useViewer.getState()
  return (
    <div ref={listRef} className="grid grid-cols-2 gap-3 p-3">
      {info.pages.map((p, i) => {
        const n = i + 1
        const st = pageState.get(n)
        const aspect = p.height / Math.max(1, p.width)
        return (
          <button
            key={n}
            type="button"
            data-thumb={n}
            onClick={() => s.scrollToPage(n)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ page: n, x: e.clientX, y: e.clientY })
            }}
            className={clsx('group relative flex flex-col items-center gap-1 rounded-md p-1.5 text-xs transition', currentPage === n ? 'bg-brand-50 ring-2 ring-brand-500 dark:bg-brand-900/30' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800')}
          >
            <div className="relative w-full overflow-hidden rounded bg-white shadow" style={{ aspectRatio: `1 / ${aspect}` }}>
              <img src={renderUrl(fileId, n, 0.25, password)} alt={`Page ${n}`} loading="lazy" decoding="async" className={clsx('h-full w-full object-contain transition-transform', st?.deleted && 'opacity-40 grayscale')} style={st?.rotate ? { transform: `rotate(${st.rotate}deg)` } : undefined} />
              {st?.deleted && <span className="absolute inset-x-0 bottom-1 mx-auto w-max rounded bg-red-600 px-1 text-[10px] text-white">deleted</span>}
              {!!st?.rotate && !st.deleted && <span className="absolute right-1 top-1 rounded bg-neutral-900/80 px-1 text-[10px] text-white">{((st.rotate % 360) + 360) % 360}°</span>}
            </div>
            <span className={clsx('tabular-nums', currentPage === n ? 'font-semibold text-brand-700 dark:text-brand-200' : 'text-neutral-500')}>{n}</span>
          </button>
        )
      })}
      {menu && (
        <div className="fixed z-50 w-48 rounded-lg border border-neutral-200 bg-white py-1 text-sm shadow-xl dark:border-neutral-700 dark:bg-neutral-900" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 180) }} onClick={(e) => e.stopPropagation()}>
          <div className="px-3 py-1 text-xs font-medium text-neutral-500">Page {menu.page}</div>
          <MenuItem icon={<RotateCcw size={14} />} label="Rotate left" onClick={() => (s.addOp({ type: 'rotate_page', page: menu.page, angle: -90 }, false), setMenu(null))} />
          <MenuItem icon={<RotateCw size={14} />} label="Rotate right" onClick={() => (s.addOp({ type: 'rotate_page', page: menu.page, angle: 90 }, false), setMenu(null))} />
          <MenuItem icon={<FilePlus2 size={14} />} label="Insert blank page after" onClick={() => (s.addOp({ type: 'insert_blank_page', page: menu.page, after_page: menu.page }, false), setMenu(null))} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete page" danger disabled={info.page_count <= 1} onClick={() => (s.addOp({ type: 'delete_page', page: menu.page }, false), setMenu(null))} />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={clsx('flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800', danger && 'text-red-600 dark:text-red-400')}>
      {icon} {label}
    </button>
  )
}

// ---- Outline -------------------------------------------------------------------------

function OutlinePanel() {
  const outline = useViewer((s) => s.info?.outline ?? [])
  if (!outline.length) return <Empty text="This document has no outline (bookmarks)." />
  return (
    <ul className="py-2 text-sm">
      {outline.map((o, i) => (
        <li key={i}>
          <button type="button" onClick={() => useViewer.getState().scrollToPage(o.page)} className="flex w-full items-start justify-between gap-2 px-3 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" style={{ paddingLeft: 12 + Math.max(0, o.level - 1) * 14 }}>
            <span className="truncate">{o.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-neutral-400">{o.page}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

// ---- Annotations -------------------------------------------------------------------

function AnnotationsPanel() {
  const annotations = useViewer((s) => s.annotations)
  const ops = useViewer((s) => s.ops)
  const selection = useViewer((s) => s.selection)
  const s = useViewer.getState()
  const deleted = useMemo(() => new Set(ops.filter((p) => p.op.type === 'delete_annot').map((p) => (p.op as { xref: number }).xref)), [ops])
  if (!annotations.length && !ops.length) return <Empty text="No annotations yet. Use the markup, draw, text or note tools to add some." />
  return (
    <div className="py-2 text-sm">
      {ops.length > 0 && (
        <>
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Pending ({ops.length})</div>
          {ops.map((p) => {
            const page = 'page' in p.op ? p.op.page : null
            const color = opColor(p.op)
            const bounds = opBounds(p.op)
            const active = selection?.kind === 'op' && selection.id === p.id
            return (
              <div key={p.id} className={clsx('group flex items-center gap-2 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800', active && 'bg-brand-50 dark:bg-brand-900/30')}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    if (page) s.scrollToPage(page, bounds ?? undefined)
                    s.select({ kind: 'op', id: p.id })
                  }}
                >
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-neutral-300 dark:border-neutral-600" style={{ background: color ?? 'transparent' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{opLabel(p.op)}</span>
                    {opSummary(p.op) && <span className="block truncate text-xs text-neutral-500">{opSummary(p.op)}</span>}
                  </span>
                  {page && <span className="text-xs tabular-nums text-neutral-400">p.{page}</span>}
                </button>
                <button type="button" aria-label="Remove" onClick={() => s.removeOp(p.id)} className="rounded p-1 text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                  <Trash2 size={13} />
                </button>
              </div>
            )
          })}
        </>
      )}
      {annotations.length > 0 && (
        <>
          <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">In document ({annotations.length})</div>
          {annotations.map((a) => {
            const active = selection?.kind === 'annot' && selection.xref === a.xref
            const isDeleted = deleted.has(a.xref)
            return (
              <div key={a.xref} className={clsx('group flex items-center gap-2 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800', active && 'bg-brand-50 dark:bg-brand-900/30', isDeleted && 'opacity-50 line-through')}>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => {
                    s.scrollToPage(a.page, a.rect)
                    s.setMode('select')
                    s.select({ kind: 'annot', xref: a.xref, page: a.page })
                  }}
                >
                  <span className="h-3 w-3 shrink-0 rounded-sm border border-neutral-300 dark:border-neutral-600" style={{ background: a.color ?? 'transparent' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {a.type}
                      {a.author && <span className="text-neutral-400"> · {a.author}</span>}
                    </span>
                    {a.contents && <span className="block truncate text-xs text-neutral-500">{a.contents}</span>}
                  </span>
                  <span className="text-xs tabular-nums text-neutral-400">p.{a.page}</span>
                </button>
                {!isDeleted && (
                  <button type="button" aria-label="Delete" onClick={() => s.addOp({ type: 'delete_annot', page: a.page, xref: a.xref }, false)} className="rounded p-1 text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

// ---- Forms ---------------------------------------------------------------------------

function FormsPanel() {
  const fields = useViewer((s) => s.fields)
  const newFields = useViewer((s) => s.newFields)
  const values = useFormValues()
  const hasForms = useViewer((s) => s.info?.has_forms)
  const s = useViewer.getState()
  if (!fields.length && !newFields.length) {
    return (
      <Empty text={hasForms ? 'Loading form fields…' : 'This document has no form fields.'}>
        <button type="button" className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700" onClick={() => s.setMode('forms')}>
          Add form fields
        </button>
      </Empty>
    )
  }
  return (
    <div className="py-2 text-sm">
      {fields.map((f) => (
        <button
          key={f.name}
          type="button"
          onClick={() => {
            s.setMode('forms')
            s.scrollToPage(f.page, f.rect)
            s.select({ kind: 'field', name: f.name })
          }}
          className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">{f.name}</span>
            <span className="block truncate text-xs text-neutral-500">
              {f.type}
              {values[f.name] !== '' && values[f.name] !== false && values[f.name] != null ? ` · ${String(values[f.name])}` : ''}
            </span>
          </span>
          <span className="text-xs tabular-nums text-neutral-400">p.{f.page}</span>
        </button>
      ))}
      {newFields.length > 0 && (
        <>
          <div className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">New fields ({newFields.length})</div>
          {newFields.map((f, i) => (
            <div key={i} className="group flex items-center gap-2 px-3 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => s.scrollToPage(f.page, f.rect)}>
                <span className="block truncate">{f.name}</span>
                <span className="block text-xs text-neutral-500">{f.type}</span>
              </button>
              <span className="text-xs tabular-nums text-neutral-400">p.{f.page}</span>
              <button type="button" aria-label="Remove" onClick={() => s.removeField(i)} className="rounded p-1 text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function Empty({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center p-6 text-center text-xs text-neutral-500">
      <p>{text}</p>
      {children}
    </div>
  )
}
