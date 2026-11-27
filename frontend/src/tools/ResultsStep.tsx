import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CircleCheck, CircleExclamationPoint, Download, ExternalLink, Eye, FileArchive, RotateCcw } from 'lucide-react'
import clsx from 'clsx'
import { downloadUrl, formatBytes, renderUrl, type FileOut, type ToolResult } from '../lib/api'
import { TOOLS, type ToolDef } from '../lib/tools'
import ToolIcon from '../components/ToolIcon'
import ToolFileThumb from '../components/ToolFileThumb'
import DataView from './DataView'
import { isImageType, isPdfType, type InputFile } from './types'

interface Props {
  tool: ToolDef
  result: ToolResult
  inputs: InputFile[]
  onStartOver: () => void
  onContinue: (toolId: string, fileId: string) => void
}

/** Step 3: outputs, data, warnings and "continue with" chaining. */
export default function ResultsStep({ tool, result, inputs, onStartOver, onContinue }: Props) {
  const outputs = result.outputs ?? []
  const zip = outputs.length > 1 ? outputs.find((o) => /\.zip$/i.test(o.name) || o.content_type.includes('zip')) : undefined
  const others = zip ? outputs.filter((o) => o !== zip) : outputs
  const pdfOutputs = outputs.filter((o) => isPdfType(o.content_type, o.name))
  const [continueId, setContinueId] = useState(pdfOutputs[0]?.file_id ?? '')
  const chainTools = useMemo(() => TOOLS.filter((t) => t.id !== tool.id && (t.input.kind === 'pdf' || t.input.kind === 'any')).sort((a, b) => Number(!!b.featured) - Number(!!a.featured)), [tool.id])
  const hasData = result.data && Object.keys(result.data).length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
        <CircleCheck size={20} />
        <h2 className="text-lg font-semibold">
          {outputs.length ? `Done — ${outputs.length} file${outputs.length === 1 ? '' : 's'} ready` : 'Done'}
        </h2>
      </div>

      {zip && (
        <a
          href={downloadUrl(zip)}
          download={zip.name}
          className="flex items-center gap-3 rounded-xl bg-brand-600 px-5 py-4 text-white shadow-sm transition hover:bg-brand-700"
        >
          <FileArchive size={24} />
          <span className="flex-1">
            <span className="block font-semibold">Download all (ZIP)</span>
            <span className="block text-sm text-brand-100">
              {zip.name} · {formatBytes(zip.size)}
            </span>
          </span>
          <Download size={20} />
        </a>
      )}

      {result.warnings?.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" role="status">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex gap-2">
              <CircleExclamationPoint size={16} className="mt-0.5 shrink-0" /> <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {tool.id === 'compress' && <CompressSummary data={result.data} inputs={inputs} outputs={others} />}

      {others.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {others.map((o) => (
            <OutputCard key={o.file_id} file={o} />
          ))}
        </ul>
      )}

      {hasData && (
        <section className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="mb-3 text-sm font-semibold">{tool.id === 'compare' ? 'Differences' : 'Details'}</h3>
          {tool.id === 'compare' ? <CompareView data={result.data} /> : tool.id === 'compress' ? <DataView data={result.data} omit={COMPRESS_KEYS} /> : <DataView data={result.data} />}
        </section>
      )}

      {pdfOutputs.length > 0 && (
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold">
            Continue with
            {pdfOutputs.length > 1 && (
              <select
                value={continueId}
                onChange={(e) => setContinueId(e.target.value)}
                aria-label="Output file to continue with"
                className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs font-normal dark:border-neutral-700 dark:bg-neutral-900"
              >
                {pdfOutputs.map((o) => (
                  <option key={o.file_id} value={o.file_id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {chainTools.slice(0, 12).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onContinue(t.id, continueId || pdfOutputs[0].file_id)}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm transition hover:border-brand-300 hover:bg-brand-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-brand-700 dark:hover:bg-brand-900/30"
              >
                <ToolIcon name={t.icon} size={14} className="text-brand-600 dark:text-brand-300" />
                {t.name}
              </button>
            ))}
          </div>
        </section>
      )}

      <div>
        <button
          type="button"
          onClick={onStartOver}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <RotateCcw size={16} /> Start over
        </button>
      </div>
    </div>
  )
}

function OutputCard({ file }: { file: FileOut }) {
  const [preview, setPreview] = useState(false)
  const isPdf = isPdfType(file.content_type, file.name)
  const isImage = isImageType(file.content_type, file.name)
  const previewSrc = isPdf ? renderUrl(file.file_id, 1, 1) : isImage ? downloadUrl(file, true) : undefined
  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex gap-3">
        <ToolFileThumb name={file.name} contentType={file.content_type} fileId={file.file_id} className="h-20 w-16" scale={0.35} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" title={file.name}>
            {file.name}
          </div>
          <div className="mt-0.5 text-xs text-neutral-500">
            {formatBytes(file.size)}
            {file.page_count != null && ` · ${file.page_count} page${file.page_count === 1 ? '' : 's'}`}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <a
              href={downloadUrl(file)}
              download={file.name}
              className="inline-flex items-center gap-1 rounded-md bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700"
            >
              <Download size={12} /> Download
            </a>
            {isPdf && (
              <Link
                to={`/view/${file.file_id}`}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                <ExternalLink size={12} /> Open in viewer
              </Link>
            )}
            {previewSrc && (
              <button
                type="button"
                onClick={() => setPreview((p) => !p)}
                aria-expanded={preview}
                className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                <Eye size={12} /> {preview ? 'Hide preview' : 'Preview'}
              </button>
            )}
          </div>
        </div>
      </div>
      {preview && previewSrc && (
        <div className="mt-3 overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800">
          <img src={previewSrc} alt={`Preview of ${file.name}`} className="mx-auto max-h-[480px] w-auto" />
        </div>
      )}
    </li>
  )
}

// ---- Compress ---------------------------------------------------------------

const COMPRESS_KEYS = ['original_size', 'compressed_size', 'input_size', 'output_size', 'before', 'after', 'size_before', 'size_after', 'saved', 'saved_bytes', 'saved_percent', 'ratio']

function pickNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = data[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

function CompressSummary({ data, inputs, outputs }: { data: Record<string, unknown>; inputs: InputFile[]; outputs: FileOut[] }) {
  const before = pickNumber(data, ['original_size', 'input_size', 'before', 'size_before']) ?? inputs.reduce((s, f) => s + f.size, 0)
  const after = pickNumber(data, ['compressed_size', 'output_size', 'after', 'size_after']) ?? outputs.reduce((s, f) => s + f.size, 0)
  if (!before || !after) return null
  const savedPct = Math.round(((before - after) / before) * 100)
  const grew = savedPct < 0
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="text-neutral-500">Before</span> <span className="font-semibold tabular-nums">{formatBytes(before)}</span>
        </div>
        <ArrowRight size={16} className="text-neutral-400" />
        <div className="text-sm">
          <span className="text-neutral-500">After</span> <span className="font-semibold tabular-nums">{formatBytes(after)}</span>
        </div>
        <span
          className={clsx(
            'ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold',
            grew ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
          )}
        >
          {grew ? `${Math.abs(savedPct)}% larger` : `Saved ${savedPct}%`}
        </span>
      </div>
      <div className="mt-3 space-y-1" aria-hidden="true">
        <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800" />
        <div className={clsx('h-2 rounded-full', grew ? 'bg-amber-500' : 'bg-brand-600')} style={{ width: `${Math.min(100, (after / before) * 100)}%` }} />
      </div>
    </div>
  )
}

// ---- Compare ----------------------------------------------------------------

interface Change {
  page?: number
  type?: string
  kind?: string
  text?: string
  old?: string
  new?: string
  [k: string]: unknown
}

function CompareView({ data }: { data: Record<string, unknown> }) {
  const listKey = ['changes', 'diffs', 'differences', 'text_changes'].find((k) => Array.isArray(data[k]))
  const changes = listKey ? (data[listKey] as Change[]) : null
  if (!changes) return <DataView data={data} />

  const byPage = new Map<string, Change[]>()
  for (const c of changes) {
    const key = c.page != null ? `Page ${c.page}` : 'Document'
    byPage.set(key, [...(byPage.get(key) ?? []), c])
  }
  const rest = Object.fromEntries(Object.entries(data).filter(([k]) => k !== listKey))

  return (
    <div className="space-y-4">
      {changes.length === 0 ? (
        <p className="text-sm text-neutral-500">No differences found.</p>
      ) : (
        [...byPage.entries()].map(([page, items]) => (
          <section key={page}>
            <h4 className="mb-1.5 text-xs font-semibold text-neutral-600 uppercase dark:text-neutral-300">
              {page} <span className="font-normal text-neutral-400">({items.length})</span>
            </h4>
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
              {items.map((c, i) => {
                const kind = String(c.type ?? c.kind ?? 'changed').toLowerCase()
                const tone = kind.includes('add') || kind.includes('insert') ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : kind.includes('remov') || kind.includes('delet') ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                return (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    <span className={clsx('h-fit shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium', tone)}>{kind}</span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      {c.old != null && <div className="line-through decoration-red-400 text-neutral-500 whitespace-pre-wrap">{String(c.old)}</div>}
                      {c.new != null && <div className="whitespace-pre-wrap">{String(c.new)}</div>}
                      {c.text != null && <div className="whitespace-pre-wrap">{String(c.text)}</div>}
                      {c.old == null && c.new == null && c.text == null && <DataView data={{ ...c, page: undefined, type: undefined, kind: undefined }} depth={2} />}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}
      {Object.keys(rest).length > 0 && <DataView data={rest} />}
    </div>
  )
}
