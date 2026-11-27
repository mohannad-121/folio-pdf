import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Clock, X } from 'lucide-react'
import clsx from 'clsx'
import { ApiError, formatBytes, getFile, type FileOut } from '../lib/api'
import { tween } from '../lib/motion'
import ToolFileThumb from '../components/ToolFileThumb'
import { Badge, EmptyState } from '../components/ui'
import { selectFresh, useRecentFiles, type RecentFile } from './store'

interface Props {
  /** Return false (with a reason) when the file can't be used by the current tool. */
  canUse: (f: RecentFile) => string | true
  onPick: (f: FileOut) => void
}

/** Right-rail list of recently uploaded / produced files (persisted in localStorage). */
export default function RecentFiles({ canUse, onPick }: Props) {
  // Select the stable array and derive the filtered view with useMemo:
  // filtering inside the selector returns a new array every call, which
  // makes useSyncExternalStore re-render forever.
  const allFiles = useRecentFiles((s) => s.files)
  const files = useMemo(() => selectFresh(allFiles), [allFiles])
  const remove = useRecentFiles((s) => s.remove)
  const clear = useRecentFiles((s) => s.clear)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const reduce = useReducedMotion()

  const pick = async (f: RecentFile) => {
    const ok = canUse(f)
    if (ok !== true) {
      setNotice(ok)
      return
    }
    setBusy(f.file_id)
    setNotice(null)
    try {
      const fresh = await getFile(f.file_id)
      onPick(fresh)
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        remove(f.file_id)
        setNotice(`"${f.name}" has expired on the server and was removed.`)
      } else {
        setNotice(e instanceof Error ? e.message : 'Could not load file')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="h-fit rounded-2xl border border-border bg-surface p-4 shadow-soft lg:sticky lg:top-20" aria-label="Recent files">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Clock size={14} className="text-muted-2" /> Recent files
        </h2>
        {files.length > 0 && (
          <button type="button" onClick={clear} className="rounded-md px-1.5 py-0.5 text-xs text-muted transition hover:bg-surface-2 hover:text-fg">
            Clear
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {notice && (
          <motion.p key="notice" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30" role="status">
            {notice}
          </motion.p>
        )}
      </AnimatePresence>
      {files.length === 0 ? (
        <EmptyState compact icon={<Clock />} title="Nothing yet" description="Files you upload or produce show up here for 24 hours, so you can reuse them across tools." />
      ) : (
        <ul className="-mx-1 space-y-0.5">
          <AnimatePresence initial={false}>
            {files.map((f) => (
              <motion.li key={f.file_id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -8 }} transition={tween} className="group flex items-center gap-2 rounded-lg px-1 py-1 transition-colors hover:bg-surface-2">
                <button
                  type="button"
                  onClick={() => pick(f)}
                  disabled={busy === f.file_id}
                  className={clsx('flex min-w-0 flex-1 items-center gap-2 rounded-md text-left', busy === f.file_id && 'opacity-60')}
                  title={`Use "${f.name}" with this tool`}
                >
                  <ToolFileThumb name={f.name} contentType={f.content_type} fileId={f.file_id} className="h-10 w-8" scale={0.15} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{f.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted tabular">
                      {formatBytes(f.size)}
                      {f.page_count != null && ` · ${f.page_count} p`} · {relTime(f.ts)}
                      {f.origin === 'output' && (
                        <Badge tone="brand" className="ml-0.5">
                          result
                        </Badge>
                      )}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => remove(f.file_id)} className="rounded-md p-1 text-muted-2 opacity-0 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-red-600 focus:opacity-100" aria-label={`Forget ${f.name}`}>
                  <X size={14} />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </aside>
  )
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.round(h / 24)} d ago`
}
