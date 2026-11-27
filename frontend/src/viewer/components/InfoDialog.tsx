/** Document properties dialog: shows metadata and emits a `set_metadata` op. */
import { useState } from 'react'
import { formatBytes } from '../../lib/api'
import { useViewer } from '../store'
import type { EditOp } from '../types'
import { btnCls, btnPrimaryCls, Dialog, Field, inputCls } from './ui'

export default function InfoDialog({ onClose }: { onClose: () => void }) {
  const info = useViewer((s) => s.info)
  const ops = useViewer((s) => s.ops)
  const pending = ops.find((p) => p.op.type === 'set_metadata')
  const meta = (pending?.op as Extract<EditOp, { type: 'set_metadata' }> | undefined) ?? {
    title: info?.metadata.title ?? '',
    author: info?.metadata.author ?? '',
    subject: info?.metadata.subject ?? '',
    keywords: info?.metadata.keywords ?? '',
  }
  const [form, setForm] = useState({ title: meta.title ?? '', author: meta.author ?? '', subject: meta.subject ?? '', keywords: meta.keywords ?? '' })
  const save = () => {
    const s = useViewer.getState()
    const op: EditOp = { type: 'set_metadata', ...form }
    if (pending) s.updateOp(pending.id, op)
    else s.addOp(op, false)
    onClose()
  }
  const f = info?.file
  return (
    <Dialog
      title="Document properties"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={btnCls} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimaryCls} onClick={save}>
            Apply on save
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label="Title">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Author">
          <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Subject">
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Keywords">
          <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-neutral-200 pt-3 text-xs dark:border-neutral-700">
        <dt className="text-neutral-500">File</dt>
        <dd className="truncate">{f?.name}</dd>
        <dt className="text-neutral-500">Size</dt>
        <dd>{f ? formatBytes(f.size) : '—'}</dd>
        <dt className="text-neutral-500">Pages</dt>
        <dd>{info?.page_count}</dd>
        <dt className="text-neutral-500">Page size</dt>
        <dd>{info?.pages[0] ? `${Math.round(info.pages[0].width)} × ${Math.round(info.pages[0].height)} pt` : '—'}</dd>
        <dt className="text-neutral-500">Forms</dt>
        <dd>{info?.has_forms ? 'yes' : 'no'}</dd>
        <dt className="text-neutral-500">Encrypted</dt>
        <dd>{info?.encrypted ? 'yes' : 'no'}</dd>
        {Object.entries(info?.metadata ?? {})
          .filter(([k, v]) => v && !['title', 'author', 'subject', 'keywords'].includes(k))
          .map(([k, v]) => (
            <Fragment2 key={k} k={k} v={v ?? ''} />
          ))}
      </dl>
    </Dialog>
  )
}

function Fragment2({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="capitalize text-neutral-500">{k.replace(/([A-Z])/g, ' $1')}</dt>
      <dd className="truncate">{v}</dd>
    </>
  )
}
