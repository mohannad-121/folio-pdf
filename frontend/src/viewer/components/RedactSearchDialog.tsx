/** Search & redact: terms / patterns → preview matches → convert to redact ops. */
import { useState } from 'react'
import { redactPreview, type RedactMatch } from '../api'
import { useViewer } from '../store'
import type { RectT } from '../types'
import { btnCls, btnDangerCls, Dialog, Field, inputCls, Spinner } from './ui'

export default function RedactSearchDialog({ onClose }: { onClose: () => void }) {
  const fileId = useViewer((s) => s.fileId)
  const [terms, setTerms] = useState('')
  const [regex, setRegex] = useState('')
  const [flags, setFlags] = useState({ emails: false, phones: false, ssn: false, credit_cards: false })
  const [matches, setMatches] = useState<RedactMatch[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = async () => {
    if (!fileId) return
    setBusy(true)
    setError(null)
    try {
      const list = await redactPreview(fileId, {
        terms: terms
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
        regex: regex.trim(),
        ...flags,
      })
      setMatches(list)
      useViewer.getState().setRedactMatches(list.map((m) => ({ page: m.page, rect: m.rect })))
      if (list.length) useViewer.getState().scrollToPage(list[0].page, list[0].rect)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const redactAll = () => {
    if (!matches?.length) return
    const s = useViewer.getState()
    const byPage = new Map<number, RectT[]>()
    for (const m of matches) byPage.set(m.page, [...(byPage.get(m.page) ?? []), m.rect])
    for (const [page, rects] of byPage) s.addOp({ type: 'redact', page, rects, fill: '#000000' }, false)
    s.setRedactMatches([])
    s.setMode('redact')
    s.notify('success', `${matches.length} redaction${matches.length === 1 ? '' : 's'} queued — press Save to apply permanently`)
    onClose()
  }

  const close = () => {
    useViewer.getState().setRedactMatches([])
    onClose()
  }

  const chk = (k: keyof typeof flags, label: string) => (
    <label key={k} className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} className="accent-brand-600" />
      {label}
    </label>
  )

  return (
    <Dialog
      title="Search & redact"
      onClose={close}
      footer={
        <>
          <button type="button" className={btnCls} onClick={close}>
            Close
          </button>
          <button type="button" className={btnCls} disabled={busy} onClick={() => void preview()}>
            {busy ? <Spinner /> : null} Preview matches
          </button>
          <button type="button" className={btnDangerCls} disabled={!matches?.length} onClick={redactAll}>
            Redact all ({matches?.length ?? 0})
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Words or phrases (comma or newline separated)">
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className={inputCls} placeholder="John Doe, Acme Corp" />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          {chk('emails', 'Email addresses')}
          {chk('phones', 'Phone numbers')}
          {chk('ssn', 'Social security numbers')}
          {chk('credit_cards', 'Credit card numbers')}
        </div>
        <Field label="Regular expression (optional)">
          <input value={regex} onChange={(e) => setRegex(e.target.value)} className={inputCls + ' font-mono'} placeholder="\\b[A-Z]{2}\\d{6}\\b" />
        </Field>
        {error && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        {matches && (
          <div className="rounded-md border border-neutral-200 text-xs dark:border-neutral-700">
            <div className="border-b border-neutral-200 px-3 py-1.5 font-medium dark:border-neutral-700">
              {matches.length} match{matches.length === 1 ? '' : 'es'} — highlighted on the pages
            </div>
            <ul className="max-h-40 overflow-auto">
              {matches.slice(0, 200).map((m, i) => (
                <li key={i}>
                  <button type="button" className="flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => useViewer.getState().scrollToPage(m.page, m.rect)}>
                    <span className="tabular-nums text-neutral-400">p.{m.page}</span>
                    <span className="truncate">{m.text ?? m.rect.map((n) => Math.round(n)).join(', ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-neutral-500">Redaction permanently removes the underlying content when you save. You will be asked to confirm.</p>
      </div>
    </Dialog>
  )
}
