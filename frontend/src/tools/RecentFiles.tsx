import { useState } from 'react'
import { Clock, X } from 'lucide-react'
import clsx from 'clsx'
import { ApiError, formatBytes, getFile, type FileOut } from '../lib/api'
import ToolFileThumb from '../components/ToolFileThumb'
import { selectFresh, useRecentFiles, type RecentFile } from './store'

interface Props {
  /** Return false (with a reason) when the file can't be used by the current tool. */
  canUse: (f: RecentFile) => string | true
  onPick: (f: FileOut) => void
}

/** Right-rail list of recently uploaded / produced files (persisted in localStorage). */
export default function RecentFiles({ canUse, onPick }: Props) {
  const files = useRecentFiles((s) => selectFresh(s.files))
  const remove = useRecentFiles((s) => s.remove)
  const clear = useRecentFiles((s) => s.clear)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

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
    <aside className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900" aria-label="Recent files">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Clock size={14} className="text-neutral-400" /> Recent files
        </h2>
        {files.length > 0 && (
          <button type="button" onClick={clear} className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            Clear
          </button>
        )}
      </div>
      {notice && (
        <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          {notice}
        </p>
      )}
      {files.length === 0 ? (
        <p className="text-xs text-neutral-500">Files you upload or produce show up here for 24 hours, so you can reuse them across tools.</p>
      ) : (
        <ul className="-mx-1 space-y-0.5">
          {files.map((f) => (
            <li key={f.file_id} className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
              <button
                type="button"
                onClick={() => pick(f)}
                disabled={busy === f.file_id}
                className={clsx('flex min-w-0 flex-1 items-center gap-2 text-left', busy === f.file_id && 'opacity-60')}
                title={`Use "${f.name}" with this tool`}
              >
                <ToolFileThumb name={f.name} contentType={f.content_type} fileId={f.file_id} className="h-10 w-8" scale={0.15} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{f.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {formatBytes(f.size)}
                    {f.page_count != null && ` · ${f.page_count} p`} · {relTime(f.ts)}
                    {f.origin === 'output' && <span className="ml-1 rounded bg-brand-50 px-1 text-[10px] text-brand-700 dark:bg-brand-900/40 dark:text-brand-200">result</span>}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => remove(f.file_id)}
                className="rounded p-1 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:text-red-600 focus:opacity-100"
                aria-label={`Forget ${f.name}`}
              >
                <X size={14} />
              </button>
            </li>
          ))}
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
