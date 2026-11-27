/** Right-hand panel: properties of the selected object (or tool defaults). */
import clsx from 'clsx'
import { AlignCenter, AlignLeft, AlignRight, Trash2, Upload } from 'lucide-react'
import { useRef } from 'react'
import { uploadFiles } from '../../lib/api'
import { opLabel } from '../ops'
import { INK_COLORS, MARKUP_COLORS, useViewer } from '../store'
import type { Align, EditOp, FontName } from '../types'
import { FONT_OPTIONS } from '../fonts'
import { ColorSwatches, Field, btnCls, btnDangerCls, inputCls } from './ui'

export default function PropertiesPanel() {
  const selection = useViewer((s) => s.selection)
  const ops = useViewer((s) => s.ops)
  const annotations = useViewer((s) => s.annotations)
  const links = useViewer((s) => s.links)
  const images = useViewer((s) => s.images)
  const fields = useViewer((s) => s.fields)

  let body: React.ReactNode
  let title = 'Properties'
  if (selection?.kind === 'op') {
    const po = ops.find((p) => p.id === selection.id)
    if (po) {
      title = opLabel(po.op)
      body = <OpProps id={po.id} op={po.op} />
    }
  } else if (selection?.kind === 'annot') {
    const a = annotations.find((x) => x.xref === selection.xref)
    if (a) {
      title = `${a.type} annotation`
      body = <AnnotProps xref={a.xref} page={a.page} contents={a.contents} color={a.color} opacity={a.opacity} author={a.author} />
    }
  } else if (selection?.kind === 'link') {
    const l = links.find((x) => x.xref === selection.xref)
    if (l) {
      title = 'Link'
      body = <ExistingLinkProps xref={l.xref} page={l.page} rect={l.rect} uri={l.uri ?? ''} targetPage={l.target_page ?? null} />
    }
  } else if (selection?.kind === 'image') {
    const im = (images[selection.page] ?? []).find((x) => x.xref === selection.xref)
    if (im) {
      title = 'Image'
      body = <ImageProps xref={im.xref} page={selection.page} width={im.width} height={im.height} />
    }
  } else if (selection?.kind === 'field') {
    const f = fields.find((x) => x.name === selection.name)
    if (f) {
      title = 'Form field'
      body = (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-neutral-500">Name</dt>
          <dd className="truncate font-medium">{f.name}</dd>
          <dt className="text-neutral-500">Type</dt>
          <dd>{f.type}</dd>
          <dt className="text-neutral-500">Page</dt>
          <dd>{f.page}</dd>
          {f.required && (
            <>
              <dt className="text-neutral-500">Required</dt>
              <dd>yes</dd>
            </>
          )}
        </dl>
      )
    }
  }
  if (!body) body = <EmptyProps />

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950">
      <div className="border-b border-neutral-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:border-neutral-800">{title}</div>
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">{body}</div>
    </aside>
  )
}

function EmptyProps() {
  const mode = useViewer((s) => s.mode)
  const dirty = useViewer((s) => s.ops.length)
  return (
    <div className="text-xs text-neutral-500">
      <p>Select an object on the page to edit its properties.</p>
      <p className="mt-2">
        Mode: <span className="font-medium text-neutral-700 dark:text-neutral-300">{mode}</span>
      </p>
      {dirty > 0 && <p className="mt-2">{dirty} pending change{dirty === 1 ? '' : 's'} — press Save to apply them.</p>}
      <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
        Tip: double-click a text box to edit it, press Delete to remove the selected object, Ctrl+Z to undo.
      </p>
    </div>
  )
}

function OpProps({ id, op }: { id: string; op: EditOp }) {
  const update = (patch: Partial<EditOp>) => useViewer.getState().updateOp(id, patch)
  const remove = () => useViewer.getState().removeOp(id)
  const info = useViewer((s) => s.info)

  const color = 'color' in op && typeof op.color === 'string' ? op.color : 'stroke' in op ? op.stroke : null
  const colorKey = 'color' in op ? 'color' : 'stroke' in op ? 'stroke' : null
  const isMarkup = ['highlight', 'underline', 'strikeout', 'squiggly'].includes(op.type)

  return (
    <>
      {'page' in op && <div className="text-xs text-neutral-500">Page {op.page}</div>}
      {color && colorKey && (
        <Field label={colorKey === 'stroke' ? 'Stroke color' : 'Color'}>
          <ColorSwatches colors={isMarkup ? MARKUP_COLORS : INK_COLORS} value={color} onChange={(c) => update({ [colorKey]: c } as Partial<EditOp>)} />
        </Field>
      )}
      {(op.type === 'rect' || op.type === 'ellipse') && (
        <Field label="Fill">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={op.fill != null} onChange={(e) => update({ fill: e.target.checked ? '#ffd400' : null } as Partial<EditOp>)} className="accent-brand-600" />
            {op.fill != null && <ColorSwatches colors={INK_COLORS} value={op.fill} onChange={(c) => update({ fill: c } as Partial<EditOp>)} />}
          </div>
        </Field>
      )}
      {'opacity' in op && typeof op.opacity === 'number' && (
        <Field label={`Opacity ${Math.round(op.opacity * 100)}%`}>
          <input type="range" min={0.1} max={1} step={0.05} value={op.opacity} onChange={(e) => update({ opacity: Number(e.target.value) } as Partial<EditOp>)} className="accent-brand-600" />
        </Field>
      )}
      {'width' in op && typeof op.width === 'number' && (
        <Field label={`Stroke width ${op.width}pt`}>
          <input type="range" min={0.5} max={12} step={0.5} value={op.width} onChange={(e) => update({ width: Number(e.target.value) } as Partial<EditOp>)} className="accent-brand-600" />
        </Field>
      )}
      {(op.type === 'text' || op.type === 'freetext' || op.type === 'replace_text') && (
        <>
          <Field label="Text">
            <textarea value={op.text} onChange={(e) => update({ text: e.target.value } as Partial<EditOp>)} rows={3} className={inputCls} />
          </Field>
          <Field label="Font">
            <select value={op.font ?? 'helv'} onChange={(e) => update({ font: e.target.value as FontName } as Partial<EditOp>)} className={inputCls}>
              {FONT_OPTIONS.map((f) => (
                <option key={f.v} value={f.v}>
                  {f.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Font size" inline>
            <input type="number" min={4} max={144} value={op.font_size ?? 11} onChange={(e) => update({ font_size: Number(e.target.value) } as Partial<EditOp>)} className={clsx(inputCls, 'w-20')} />
          </Field>
          {op.type !== 'replace_text' && (
            <Field label="Alignment">
              <div className="flex gap-1">
                {(
                  [
                    ['left', <AlignLeft size={14} key="l" />],
                    ['center', <AlignCenter size={14} key="c" />],
                    ['right', <AlignRight size={14} key="r" />],
                  ] as [Align, React.ReactNode][]
                ).map(([a, icon]) => (
                  <button key={a} type="button" aria-label={a} onClick={() => update({ align: a } as Partial<EditOp>)} className={clsx('grid h-7 w-8 place-items-center rounded border', op.align === a ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : 'border-neutral-300 dark:border-neutral-600')}>
                    {icon}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {op.type !== 'replace_text' && (
            <div className="text-[11px] text-neutral-500">{op.type === 'text' ? 'Baked into the page content (not editable afterwards).' : 'Stored as a FreeText annotation.'}</div>
          )}
        </>
      )}
      {op.type === 'note' && (
        <>
          <Field label="Contents">
            <textarea value={op.contents} onChange={(e) => update({ contents: e.target.value } as Partial<EditOp>)} rows={4} className={inputCls} />
          </Field>
          <Field label="Author" inline>
            <input value={op.author} onChange={(e) => update({ author: e.target.value } as Partial<EditOp>)} className={clsx(inputCls, 'w-32')} />
          </Field>
        </>
      )}
      {op.type === 'link' && (
        <>
          <Field label="URL">
            <input value={op.uri ?? ''} onChange={(e) => update({ uri: e.target.value || undefined, target_page: e.target.value ? undefined : op.target_page } as Partial<EditOp>)} placeholder="https://" className={inputCls} />
          </Field>
          <Field label="Target page" inline>
            <input type="number" min={1} max={info?.page_count ?? 1} value={op.target_page ?? ''} onChange={(e) => update({ target_page: e.target.value ? Number(e.target.value) : undefined, uri: e.target.value ? undefined : op.uri } as Partial<EditOp>)} className={clsx(inputCls, 'w-20')} />
          </Field>
          {op.remove_xref != null && <div className="text-[11px] text-neutral-500">Replaces existing link #{op.remove_xref}.</div>}
        </>
      )}
      {op.type === 'image' && (
        <Field label="Rotation" inline>
          <select value={op.rotate} onChange={(e) => update({ rotate: Number(e.target.value) } as Partial<EditOp>)} className={clsx(inputCls, 'w-24')}>
            {[0, 90, 180, 270].map((r) => (
              <option key={r} value={r}>
                {r}°
              </option>
            ))}
          </select>
        </Field>
      )}
      {op.type === 'redact' && (
        <>
          <Field label="Fill color">
            <ColorSwatches colors={['#000000', '#ffffff', '#dc2626', '#525252']} value={op.fill} onChange={(c) => update({ fill: c } as Partial<EditOp>)} />
          </Field>
          <Field label="Overlay text (optional)">
            <input value={op.text ?? ''} onChange={(e) => update({ text: e.target.value || undefined } as Partial<EditOp>)} className={inputCls} placeholder="REDACTED" />
          </Field>
        </>
      )}
      {'rect' in op && Array.isArray(op.rect) && (
        <div className="text-[11px] tabular-nums text-neutral-400">
          Rect: {op.rect.map((n) => Math.round(n)).join(', ')} pt
        </div>
      )}
      <button type="button" onClick={remove} className={clsx(btnDangerCls, 'w-full')}>
        <Trash2 size={14} /> Remove
      </button>
    </>
  )
}

function AnnotProps({ xref, page, contents, color, opacity, author }: { xref: number; page: number; contents: string; color: string | null; opacity: number; author: string }) {
  const ops = useViewer((s) => s.ops)
  const pending = ops.find((p) => p.op.type === 'update_annot' && p.op.xref === xref)?.op as Extract<EditOp, { type: 'update_annot' }> | undefined
  const deleted = ops.some((p) => p.op.type === 'delete_annot' && p.op.xref === xref)
  const cur = { contents: pending?.contents ?? contents, color: pending?.color ?? color ?? '#ffd400', opacity: pending?.opacity ?? opacity ?? 1 }
  const upd = (patch: { contents?: string; color?: string; opacity?: number }) => useViewer.getState().upsertAnnotUpdate(xref, page, patch)
  return (
    <>
      <div className="text-xs text-neutral-500">
        Page {page} · xref {xref}
        {author && <> · by {author}</>}
      </div>
      {deleted ? (
        <div className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Will be deleted on save.</div>
      ) : (
        <>
          <Field label="Contents">
            <textarea value={cur.contents} onChange={(e) => upd({ contents: e.target.value })} rows={3} className={inputCls} />
          </Field>
          <Field label="Color">
            <ColorSwatches colors={MARKUP_COLORS} value={cur.color} onChange={(c) => upd({ color: c })} />
          </Field>
          <Field label={`Opacity ${Math.round(cur.opacity * 100)}%`}>
            <input type="range" min={0.1} max={1} step={0.05} value={cur.opacity} onChange={(e) => upd({ opacity: Number(e.target.value) })} className="accent-brand-600" />
          </Field>
          <button type="button" className={clsx(btnDangerCls, 'w-full')} onClick={() => useViewer.getState().addOp({ type: 'delete_annot', page, xref }, false)}>
            <Trash2 size={14} /> Delete annotation
          </button>
        </>
      )}
    </>
  )
}

function ExistingLinkProps({ xref, page, rect, uri, targetPage }: { xref: number; page: number; rect: [number, number, number, number]; uri: string; targetPage: number | null }) {
  const ops = useViewer((s) => s.ops)
  const replaced = ops.find((p) => p.op.type === 'link' && p.op.remove_xref === xref)
  const deleted = ops.some((p) => p.op.type === 'delete_link' && p.op.xref === xref)
  const info = useViewer((s) => s.info)
  if (deleted) return <div className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Will be deleted on save.</div>
  if (replaced) return <div className="text-xs text-neutral-500">Being replaced — edit the new link on the page.</div>
  return (
    <>
      <div className="text-xs text-neutral-500">Page {page}</div>
      <Field label="URL">
        <input value={uri} readOnly className={clsx(inputCls, 'bg-neutral-50 dark:bg-neutral-900')} />
      </Field>
      {targetPage != null && (
        <Field label="Target page" inline>
          <span>{targetPage}</span>
        </Field>
      )}
      <button
        type="button"
        className={clsx(btnCls, 'w-full')}
        onClick={() => {
          const s = useViewer.getState()
          const id = s.addOp({ type: 'link', page, rect, uri: uri || undefined, target_page: targetPage ?? undefined, remove_xref: xref })
          s.setEditingOpId(id)
          s.setMode('link')
        }}
      >
        Edit link…
      </button>
      <button type="button" className={clsx(btnDangerCls, 'w-full')} onClick={() => useViewer.getState().addOp({ type: 'delete_link', page, xref }, false)}>
        <Trash2 size={14} /> Remove link
      </button>
      <div className="text-[11px] text-neutral-400">
        Page {info?.page_count ? `${page} of ${info.page_count}` : page}
      </div>
    </>
  )
}

function ImageProps({ xref, page, width, height }: { xref: number; page: number; width: number; height: number }) {
  const ops = useViewer((s) => s.ops)
  const fileRef = useRef<HTMLInputElement>(null)
  const deleted = ops.some((p) => p.op.type === 'delete_image' && p.op.xref === xref)
  const replaced = ops.some((p) => p.op.type === 'replace_image' && p.op.xref === xref)
  const onReplace = async (f: File | undefined) => {
    if (!f) return
    const s = useViewer.getState()
    try {
      const [out] = await uploadFiles([f])
      s.addOp({ type: 'replace_image', page, xref, image_file_id: out.file_id }, false)
      s.notify('success', 'Image will be replaced on save')
    } catch (e) {
      s.notify('error', (e as Error).message)
    }
  }
  return (
    <>
      <div className="text-xs text-neutral-500">
        Page {page} · {width}×{height}px · xref {xref}
      </div>
      {deleted && <div className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Will be deleted on save.</div>}
      {replaced && <div className="rounded-md bg-violet-50 p-2 text-xs text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Will be replaced on save.</div>}
      {!deleted && (
        <>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onReplace(e.target.files?.[0])} />
          <button type="button" className={clsx(btnCls, 'w-full')} onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Replace image…
          </button>
          <button type="button" className={clsx(btnDangerCls, 'w-full')} onClick={() => useViewer.getState().addOp({ type: 'delete_image', page, xref }, false)}>
            <Trash2 size={14} /> Delete image
          </button>
        </>
      )}
    </>
  )
}
