import { createElement, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, CircleExclamationPoint, Copy, Download, ExternalLink, Eye, FileArchive, RotateCcw, Timer } from 'lucide-react'
import clsx from 'clsx'
import { downloadUrl, formatBytes, renderUrl, type FileOut, type ToolResult } from '../lib/api'
import { TOOLS, type ToolDef } from '../lib/tools'
import { categoryAccent } from '../lib/theme'
import { spring, staggerContainer, staggerItem, tween } from '../lib/motion'
import ToolIcon from '../components/ToolIcon'
import ToolFileThumb from '../components/ToolFileThumb'
import { fileIconFor } from '../components/ToolFileIcon'
import { Badge, Button, buttonBase, buttonSizes, buttonVariants, toast } from '../components/ui'
import DataView from './DataView'
import { isImageType, isPdfType, type InputFile } from './types'

interface Props {
  tool: ToolDef
  result: ToolResult
  inputs: InputFile[]
  /** Wall-clock time the run took, in ms. */
  elapsedMs?: number
  onStartOver: () => void
  onContinue: (toolId: string, fileId: string) => void
}

function fmtElapsed(ms?: number): string | null {
  if (ms == null) return null
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`
}

/** Step 3: outputs, data, warnings and "continue with" chaining. */
export default function ResultsStep({ tool, result, inputs, elapsedMs, onStartOver, onContinue }: Props) {
  const reduce = useReducedMotion()
  const outputs = result.outputs ?? []
  const zip = outputs.length > 1 ? outputs.find((o) => /\.zip$/i.test(o.name) || o.content_type.includes('zip')) : undefined
  const others = zip ? outputs.filter((o) => o !== zip) : outputs
  const pdfOutputs = outputs.filter((o) => isPdfType(o.content_type, o.name))
  const [continueId, setContinueId] = useState(pdfOutputs[0]?.file_id ?? '')
  const chainTools = useMemo(() => TOOLS.filter((t) => t.id !== tool.id && (t.input.kind === 'pdf' || t.input.kind === 'any')).sort((a, b) => Number(!!b.featured) - Number(!!a.featured)), [tool.id])
  const hasData = result.data && Object.keys(result.data).length > 0
  const elapsed = fmtElapsed(elapsedMs)
  const acc = categoryAccent(tool.category)

  return (
    <motion.div variants={reduce ? undefined : staggerContainer(0.06)} initial={reduce ? false : 'initial'} animate="animate" className="space-y-6">
      {/* Celebratory header */}
      <motion.div variants={reduce ? undefined : staggerItem} className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-linear-to-br from-emerald-50 to-surface p-5 shadow-soft dark:border-emerald-500/25 dark:from-emerald-500/10 dark:to-surface">
        <span className="pointer-events-none absolute -top-16 -right-16 size-48 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-emerald-500)_22%,transparent),transparent)]" aria-hidden="true" />
        <div className="relative flex items-center gap-4">
          <CheckBurst animate={!reduce} />
          <div className="min-w-0 flex-1">
            <h2 className="text-title text-xl sm:text-2xl">{outputs.length ? `Done — ${outputs.length} file${outputs.length === 1 ? '' : 's'} ready` : 'Done'}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
              {elapsed && (
                <span className="inline-flex items-center gap-1 tabular">
                  <Timer size={13} aria-hidden="true" /> Done in {elapsed}
                </span>
              )}
              {inputs.length > 0 && (
                <span className="tabular">
                  {inputs.length} input{inputs.length === 1 ? '' : 's'}
                </span>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" leftIcon={<RotateCcw />} onClick={onStartOver} className="hidden sm:inline-flex">
            Start over
          </Button>
        </div>
      </motion.div>

      {zip && (
        <motion.a
          variants={reduce ? undefined : staggerItem}
          href={downloadUrl(zip)}
          download={zip.name}
          onClick={() => toast.success('Download started', zip.name)}
          style={acc.style as CSSProperties}
          className={clsx('group flex items-center gap-4 rounded-2xl bg-linear-to-br p-5 text-white shadow-lift transition hover:brightness-110 hover:shadow-glow', acc.gradient)}
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25">
            <FileArchive size={24} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold">Download all (ZIP)</span>
            <span className="block truncate text-sm text-white/80 tabular">
              {zip.name} · {formatBytes(zip.size)}
            </span>
          </span>
          <Download size={20} className="shrink-0 transition-transform group-hover:translate-y-0.5" />
        </motion.a>
      )}

      {result.warnings?.length > 0 && (
        <motion.ul variants={reduce ? undefined : staggerItem} className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="status">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex gap-2">
              <CircleExclamationPoint size={16} className="mt-0.5 shrink-0" /> <span>{w}</span>
            </li>
          ))}
        </motion.ul>
      )}

      {tool.id === 'compress' && (
        <motion.div variants={reduce ? undefined : staggerItem}>
          <CompressSummary data={result.data} inputs={inputs} outputs={others} />
        </motion.div>
      )}

      {others.length > 0 && (
        <motion.ul variants={reduce ? undefined : staggerContainer(0.05)} className="grid gap-3 sm:grid-cols-2">
          {others.map((o) => (
            <OutputCard key={o.file_id} file={o} reduce={!!reduce} />
          ))}
        </motion.ul>
      )}

      {hasData && (
        <motion.section variants={reduce ? undefined : staggerItem} className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
          <h3 className="mb-3 text-sm font-semibold tracking-tight">{tool.id === 'compare' ? 'Differences' : 'Details'}</h3>
          {tool.id === 'compare' ? <CompareView data={result.data} /> : tool.id === 'compress' ? <DataView data={result.data} omit={COMPRESS_KEYS} /> : <DataView data={result.data} />}
        </motion.section>
      )}

      {pdfOutputs.length > 0 && (
        <motion.section variants={reduce ? undefined : staggerItem}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold tracking-tight">
            Continue with
            {pdfOutputs.length > 1 && (
              <select value={continueId} onChange={(e) => setContinueId(e.target.value)} aria-label="Output file to continue with" className="field h-8 w-auto py-1 text-xs font-normal">
                {pdfOutputs.map((o) => (
                  <option key={o.file_id} value={o.file_id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {chainTools.slice(0, 12).map((t) => {
              const a = categoryAccent(t.category)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onContinue(t.id, continueId || pdfOutputs[0].file_id)}
                  style={a.style as CSSProperties}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-sm shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--color-border))] hover:shadow-glow"
                >
                  <ToolIcon name={t.icon} size={14} className={a.text} />
                  {t.name}
                </button>
              )
            })}
          </div>
        </motion.section>
      )}

      <motion.div variants={reduce ? undefined : staggerItem} className="sm:hidden">
        <Button variant="secondary" leftIcon={<RotateCcw />} onClick={onStartOver}>
          Start over
        </Button>
      </motion.div>
    </motion.div>
  )
}

/** Animated check: circle scales in, then the tick draws itself. */
function CheckBurst({ animate }: { animate: boolean }) {
  return (
    <motion.span
      className="relative grid size-12 shrink-0 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_8px_24px_-8px_var(--color-emerald-500)]"
      initial={animate ? { scale: 0.4, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={spring}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={animate ? { pathLength: 0, opacity: 0 } : false} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.35, delay: 0.15, ease: 'easeOut' }} />
      </svg>
      {animate && <motion.span className="absolute inset-0 rounded-full border-2 border-emerald-400" initial={{ scale: 1, opacity: 0.8 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 0.7, delay: 0.1, ease: 'easeOut' }} />}
    </motion.span>
  )
}

const TYPE_TONES: Record<string, string> = {
  pdf: 'bg-red-500/12 text-red-600 dark:text-red-400',
  image: 'bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400',
  sheet: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  slides: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
  doc: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  code: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
  zip: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
  other: 'bg-surface-3 text-muted',
}

function typeKey(f: FileOut): keyof typeof TYPE_TONES {
  const ext = (f.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
  if (isPdfType(f.content_type, f.name)) return 'pdf'
  if (isImageType(f.content_type, f.name)) return 'image'
  if (['.xlsx', '.xls', '.csv', '.ods'].includes(ext)) return 'sheet'
  if (['.pptx', '.ppt', '.odp'].includes(ext)) return 'slides'
  if (['.docx', '.doc', '.odt', '.rtf'].includes(ext)) return 'doc'
  if (['.html', '.htm', '.json', '.xml', '.md', '.txt', '.fdf'].includes(ext)) return 'code'
  if (ext === '.zip') return 'zip'
  return 'other'
}

function OutputCard({ file, reduce }: { file: FileOut; reduce: boolean }) {
  const [preview, setPreview] = useState(false)
  const isPdf = isPdfType(file.content_type, file.name)
  const isImage = isImageType(file.content_type, file.name)
  const previewSrc = isPdf ? renderUrl(file.file_id, 1, 1) : isImage ? downloadUrl(file, true) : undefined
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? '').replace('.', '').toUpperCase()
  const tone = TYPE_TONES[typeKey(file)]

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(new URL(downloadUrl(file), window.location.origin).toString())
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  return (
    <motion.li variants={reduce ? undefined : staggerItem} layout={!reduce} className="group/card card-wash overflow-hidden rounded-2xl border border-border bg-surface p-3 shadow-card transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex gap-3">
        <div className="relative shrink-0">
          <ToolFileThumb name={file.name} contentType={file.content_type} fileId={file.file_id} className="h-20 w-16" scale={0.35} />
          <span className={clsx('absolute -right-1.5 -bottom-1.5 grid size-6 place-items-center rounded-md ring-2 ring-surface', tone)} aria-hidden="true">
            {createElement(fileIconFor(file.content_type, file.name), { size: 13 })}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 truncate font-medium" title={file.name}>
              {file.name}
            </div>
            {ext && <Badge tone="neutral">{ext}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-muted tabular">
            {formatBytes(file.size)}
            {file.page_count != null && ` · ${file.page_count} page${file.page_count === 1 ? '' : 's'}`}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <a href={downloadUrl(file)} download={file.name} onClick={() => toast.success('Download started', file.name)} className={clsx(buttonBase, buttonVariants.primary, buttonSizes.sm, 'btn-press')}>
              <Download /> Download
            </a>
            {isPdf && (
              <Link to={`/view/${file.file_id}`} className={clsx(buttonBase, buttonVariants.secondary, buttonSizes.sm, 'btn-press')}>
                <ExternalLink /> Open in viewer
              </Link>
            )}
            {previewSrc && (
              <Button variant="ghost" size="sm" leftIcon={<Eye />} onClick={() => setPreview((p) => !p)} aria-expanded={preview}>
                {preview ? 'Hide' : 'Preview'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={copyLink} aria-label="Copy download link" className="px-2">
              <Copy />
            </Button>
          </div>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {preview && previewSrc && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={tween} className="overflow-hidden">
            <div className="mt-3 overflow-hidden rounded-xl border border-border bg-surface-2 p-2">
              <img src={previewSrc} alt={`Preview of ${file.name}`} className="mx-auto max-h-[480px] w-auto rounded-md shadow-soft" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
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
  const reduce = useReducedMotion()
  const before = pickNumber(data, ['original_size', 'input_size', 'before', 'size_before']) ?? inputs.reduce((s, f) => s + f.size, 0)
  const after = pickNumber(data, ['compressed_size', 'output_size', 'after', 'size_after']) ?? outputs.reduce((s, f) => s + f.size, 0)
  if (!before || !after) return null
  const savedPct = Math.round(((before - after) / before) * 100)
  const grew = savedPct < 0
  const ratio = Math.min(100, (after / before) * 100)
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-soft">
      <div className="flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <span className="text-muted">Before</span> <span className="font-semibold tabular">{formatBytes(before)}</span>
        </div>
        <ArrowRight size={16} className="text-muted-2" />
        <div className="text-sm">
          <span className="text-muted">After</span> <span className="font-semibold tabular">{formatBytes(after)}</span>
        </div>
        <motion.span initial={reduce ? false : { scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...spring, delay: 0.35 }} className="ml-auto">
          <Badge tone={grew ? 'warning' : 'success'} size="md" className="tabular">
            {grew ? `${Math.abs(savedPct)}% larger` : `Saved ${savedPct}%`}
          </Badge>
        </motion.span>
      </div>
      <div className="mt-4 space-y-2" aria-hidden="true">
        <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
          <motion.div
            className={clsx('absolute inset-y-0 left-0 rounded-full', grew ? 'bg-amber-500' : 'bg-linear-to-r from-emerald-500 to-emerald-400')}
            initial={reduce ? false : { width: '100%' }}
            animate={{ width: `${Math.max(2, ratio)}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20, delay: 0.2 }}
          />
        </div>
        <div className="flex justify-between text-[11px] text-muted-2 tabular">
          <span>0</span>
          <span>{formatBytes(before)}</span>
        </div>
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
        <p className="text-sm text-muted">No differences found.</p>
      ) : (
        [...byPage.entries()].map(([page, items]) => (
          <section key={page}>
            <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
              {page} <span className="font-normal text-muted-2">({items.length})</span>
            </h4>
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {items.map((c, i) => {
                const kind = String(c.type ?? c.kind ?? 'changed').toLowerCase()
                const tone: 'success' | 'danger' | 'warning' = kind.includes('add') || kind.includes('insert') ? 'success' : kind.includes('remov') || kind.includes('delet') ? 'danger' : 'warning'
                return (
                  <li key={i} className="flex gap-3 px-3 py-2">
                    <Badge tone={tone} className="h-fit shrink-0">
                      {kind}
                    </Badge>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      {c.old != null && <div className="whitespace-pre-wrap text-muted line-through decoration-red-400">{String(c.old)}</div>}
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
