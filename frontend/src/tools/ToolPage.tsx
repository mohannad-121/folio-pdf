import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowRight, CircleExclamationPoint, LoaderCircle, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { ApiError, getFile, getPdfInfo, runTool, uploadFiles, type FileOut, type ToolResult } from '../lib/api'
import { CATEGORY_LABELS, TOOLS, TOOLS_BY_ID, type ToolDef } from '../lib/tools'
import ToolIcon from '../components/ToolIcon'
import NotFound from '../pages/NotFound'
import UploadStep from './UploadStep'
import OptionsForm from './OptionsForm'
import ResultsStep from './ResultsStep'
import RecentFiles from './RecentFiles'
import { allowsMultiple, fileMatches, maxFiles } from './accept'
import { isVisible } from './visibility'
import { useRecentFiles, type RecentFile } from './store'
import { inputFromFileOut, isPdfType, nextLocalId, type InputFile, type OptionValues } from './types'

const README_URL = 'https://github.com/mohannad-121/folio-pdf#readme'

export default function ToolPage() {
  const { toolId } = useParams()
  const tool = toolId ? TOOLS_BY_ID[toolId] : undefined
  if (!tool) return <NotFound />
  // Key by tool id so switching tools resets all state.
  return <ToolPageInner key={tool.id} tool={tool} />
}

type Phase = 'input' | 'running' | 'done'

function defaultValues(tool: ToolDef): OptionValues {
  const v: OptionValues = {}
  for (const f of tool.options ?? []) {
    if ('default' in f && f.default !== undefined) v[f.key] = f.default
    else if (f.type === 'checkbox') v[f.key] = false
    else if (f.type === 'select') v[f.key] = f.options[0]?.value
  }
  return v
}

function ToolPageInner({ tool }: { tool: ToolDef }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const addRecent = useRecentFiles((s) => s.add)

  const [files, setFiles] = useState<InputFile[]>([])
  const [values, setValues] = useState<OptionValues>(() => defaultValues(tool))
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<Phase>('input')
  const [progress, setProgress] = useState<{ frac: number | null; message: string }>({ frac: null, message: '' })
  const [result, setResult] = useState<ToolResult | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Latest files for event handlers (kept in sync after each render).
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  const multiple = allowsMultiple(tool.input)
  const limit = maxFiles(tool.input)
  const isPair = tool.input.kind === 'pdf-pair'
  const isHtml = tool.input.kind === 'html'

  const patch = useCallback((localId: string, p: Partial<InputFile>) => {
    setFiles((fs) => fs.map((f) => (f.localId === localId ? { ...f, ...p } : f)))
  }, [])

  const goToViewer = useCallback(
    (fileId: string) => navigate(`/view/${fileId}?tool=${tool.id}`),
    [navigate, tool.id],
  )

  /** Insert server-side files (from recent list / query / route state). */
  const addStored = useCallback(
    (outs: FileOut[], slot?: number) => {
      if (tool.opensViewer && outs[0]) {
        goToViewer(outs[0].file_id)
        return
      }
      setFiles((fs) => {
        let next = [...fs]
        for (const o of outs) {
          const entry: InputFile = { ...inputFromFileOut(o), localId: nextLocalId(), slot }
          if (isPair) {
            const s = slot ?? (next.some((f) => f.slot === 0) ? 1 : 0)
            entry.slot = s
            next = next.filter((f) => f.slot !== s)
          } else if (!multiple) {
            next = []
          }
          if (next.length >= limit) break
          next.push(entry)
        }
        return isPair ? next.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)) : next
      })
    },
    [goToViewer, isPair, limit, multiple, tool.opensViewer],
  )

  /** Add local files: create entries, upload each with its own progress. */
  const addLocal = useCallback(
    (picked: File[], slot?: number) => {
      setNotice(null)
      const current = filesRef.current
      let room = isPair ? 1 : multiple ? Math.max(0, limit - current.length) : 1
      if (!isPair && multiple && picked.length > room) setNotice(`Only ${room} more file${room === 1 ? '' : 's'} can be added.`)
      const entries: InputFile[] = []
      for (const f of picked) {
        if (room <= 0) break
        room -= 1
        entries.push({
          localId: nextLocalId(),
          name: f.name,
          size: f.size,
          content_type: f.type || 'application/octet-stream',
          status: 'uploading',
          progress: 0,
          page_count: null,
          previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined,
          slot: isPair ? slot ?? (current.some((x) => x.slot === 0) ? 1 : 0) : undefined,
        })
      }
      if (!entries.length) return

      setFiles((fs) => {
        let next = fs
        if (isPair) next = fs.filter((f) => f.slot !== entries[0].slot)
        else if (!multiple) next = []
        const merged = [...next, ...entries]
        return isPair ? merged.sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)) : merged
      })

      entries.forEach((entry, i) => {
        const file = picked[i]
        uploadFiles([file], (frac) => patch(entry.localId, { progress: frac }))
          .then(([out]) => {
            patch(entry.localId, {
              status: 'ready',
              progress: 1,
              file_id: out.file_id,
              page_count: out.page_count,
              content_type: out.content_type || entry.content_type,
              name: out.name || entry.name,
              size: out.size,
            })
            addRecent(out, 'upload')
            if (tool.opensViewer) goToViewer(out.file_id)
          })
          .catch((e: unknown) => {
            patch(entry.localId, { status: 'error', error: e instanceof Error ? e.message : 'Upload failed' })
          })
      })
    },
    [addRecent, goToViewer, isPair, limit, multiple, patch, tool.opensViewer],
  )

  const removeFile = useCallback((localId: string) => {
    setFiles((fs) => {
      const f = fs.find((x) => x.localId === localId)
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl)
      return fs.filter((x) => x.localId !== localId)
    })
  }, [])

  // Hand-over: ?file=<id> query and/or route state { files: FileOut[] }.
  const handedOver = useRef(false)
  useEffect(() => {
    if (handedOver.current) return
    const stateFiles = (location.state as { files?: FileOut[] } | null)?.files
    const qid = searchParams.get('file')
    if (!stateFiles?.length && !qid) return
    handedOver.current = true
    const load = async () => {
      const outs: FileOut[] = [...(stateFiles ?? [])]
      if (qid) {
        try {
          const f = await getFile(qid)
          if (isPdfType(f.content_type, f.name) && f.page_count == null) {
            try {
              f.page_count = (await getPdfInfo(qid)).page_count
            } catch {
              /* not fatal */
            }
          }
          outs.push(f)
        } catch (e) {
          setNotice(e instanceof ApiError && e.status === 404 ? 'That file has expired or does not exist on the server.' : 'Could not load the handed-over file.')
        }
      }
      if (outs.length) addStored(outs)
      if (qid) setSearchParams({}, { replace: true })
    }
    void load()
  }, [addStored, location.state, searchParams, setSearchParams])

  // Paste files anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (phase !== 'input') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const fs = Array.from(e.clipboardData?.files ?? []).filter((f) => fileMatches(tool.input, f.type, f.name))
      if (fs.length) {
        e.preventDefault()
        addLocal(fs)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addLocal, phase, tool.input])

  // Revoke preview URLs on unmount.
  useEffect(() => () => filesRef.current.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl)), [])

  const ready = files.filter((f) => f.status === 'ready' && f.file_id)
  const uploading = files.some((f) => f.status === 'uploading')
  const firstPdf = ready.find((f) => isPdfType(f.content_type, f.name))
  const pageCount = firstPdf?.page_count ?? null
  const urlValue = typeof values.url === 'string' ? values.url.trim() : ''
  const hasInvalid = Object.values(invalid).some(Boolean)

  const blocker = useMemo<string | null>(() => {
    if (uploading) return 'Waiting for uploads to finish…'
    if (files.some((f) => f.status === 'error')) return 'Remove the failed upload to continue.'
    if (isPair && ready.length < 2) return 'Add both PDFs to compare.'
    if (isHtml && ready.length === 0 && !urlValue) return 'Upload an HTML file or enter a URL.'
    if (!isHtml && ready.length === 0) return null
    if (hasInvalid) return 'Fix the highlighted option.'
    return null
  }, [files, hasInvalid, isHtml, isPair, ready.length, uploading, urlValue])
  const canRun = !blocker && (ready.length > 0 || (isHtml && !!urlValue))
  const showOptions = files.length > 0 || isHtml

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {}
    const ids = ready.map((f) => f.file_id as string)
    if (isPair || multiple) body.file_ids = ids
    else if (ids[0]) body.file_id = ids[0]
    for (const f of tool.options ?? []) {
      if (!isVisible(tool.id, f.key, values)) continue
      const v = values[f.key]
      if (f.type === 'checkbox') body[f.key] = v === true
      else if (f.type === 'number') {
        if (typeof v === 'number' && Number.isFinite(v)) body[f.key] = v
      } else if (typeof v === 'string' && v !== '') body[f.key] = v
    }
    return body
  }

  const run = async () => {
    if (!canRun) return
    setError(null)
    setPhase('running')
    setProgress({ frac: null, message: 'Starting…' })
    try {
      const res = await runTool(tool.endpoint, buildBody(), (frac, message) => setProgress({ frac, message }))
      setResult(res)
      res.outputs?.forEach((o) => addRecent(o, 'output'))
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
      setPhase('input')
    }
  }

  const startOver = () => {
    files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl))
    setFiles([])
    setValues(defaultValues(tool))
    setInvalid({})
    setResult(null)
    setError(null)
    setPhase('input')
  }

  const canUseRecent = (f: RecentFile): string | true => {
    if (phase !== 'input') return 'Start over to pick another file.'
    if (!fileMatches(tool.input, f.content_type, f.name)) return `${tool.name} does not accept this file type.`
    if (!isPair && multiple && files.length >= limit) return 'File limit reached.'
    return true
  }

  const related = TOOLS.filter((t) => t.category === tool.category && t.id !== tool.id)
  const runLabel = multiple && ready.length > 1 ? `Process ${ready.length} files` : tool.name
  const onValidity = useCallback((key: string, ok: boolean) => setInvalid((m) => (m[key] === !ok ? m : { ...m, [key]: !ok })), [])

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-8">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-200">
            <ToolIcon name={tool.icon} size={28} />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-medium text-brand-600 uppercase dark:text-brand-300">{CATEGORY_LABELS[tool.category]}</div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{tool.name}</h1>
            <p className="mt-1 text-neutral-500">{tool.description}</p>
            {tool.opensViewer && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <Sparkles size={12} /> Opens in the editor after upload
              </p>
            )}
          </div>
        </div>
        {related.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-neutral-500">Related tools:</span>
            {related.map((t) => (
              <Link
                key={t.id}
                to={`/tools/${t.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs transition hover:border-brand-300 hover:bg-brand-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-brand-700 dark:hover:bg-brand-900/30"
              >
                <ToolIcon name={t.icon} size={12} className="text-brand-600 dark:text-brand-300" />
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0 space-y-6">
          <Stepper phase={phase} hasFiles={files.length > 0} hasOptions={!!tool.options?.length} viewer={!!tool.opensViewer} />

          {notice && (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" role="status">
              {notice}
            </p>
          )}

          {phase === 'done' && result ? (
            <ResultsStep tool={tool} result={result} inputs={ready} onStartOver={startOver} onContinue={(id, fileId) => navigate(`/tools/${id}?file=${encodeURIComponent(fileId)}`)} />
          ) : phase === 'running' ? (
            <Processing tool={tool} frac={progress.frac} message={progress.message} />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run()
              }}
              className="space-y-6"
            >
              <section aria-labelledby="step-upload">
                <h2 id="step-upload" className="sr-only">
                  Upload
                </h2>
                <UploadStep tool={tool} files={files} onAdd={addLocal} onRemove={removeFile} onReorder={setFiles} />
              </section>

              {error && <ErrorPanel error={error} />}

              {showOptions && !tool.opensViewer && (
                <section className="rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900" aria-labelledby="step-options">
                  {tool.options?.length ? (
                    <>
                      <h2 id="step-options" className="mb-4 text-base font-semibold">
                        Options
                      </h2>
                      <OptionsForm tool={tool} values={values} onChange={(k, v) => setValues((o) => ({ ...o, [k]: v }))} pageCount={pageCount} onValidity={onValidity} onExtraUpload={(f) => addRecent(f, 'upload')} />
                    </>
                  ) : (
                    <h2 id="step-options" className="text-sm text-neutral-500">
                      No options for this tool — you're ready to go.
                    </h2>
                  )}
                  <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-neutral-200 pt-5 dark:border-neutral-800">
                    <button
                      type="submit"
                      disabled={!canRun}
                      className={clsx(
                        'inline-flex items-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition',
                        canRun ? 'bg-brand-600 hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-300' : 'cursor-not-allowed bg-neutral-300 dark:bg-neutral-700',
                      )}
                    >
                      {runLabel} <ArrowRight size={18} />
                    </button>
                    {blocker && <span className="text-sm text-neutral-500">{blocker}</span>}
                  </div>
                </section>
              )}
            </form>
          )}
        </div>

        <RecentFiles canUse={canUseRecent} onPick={(f) => addStored([f])} />
      </div>
    </div>
  )
}

function Stepper({ phase, hasFiles, hasOptions, viewer }: { phase: Phase; hasFiles: boolean; hasOptions: boolean; viewer: boolean }) {
  const steps = viewer ? ['Upload', 'Edit in viewer'] : ['Upload', hasOptions ? 'Options' : 'Run', 'Download']
  const current = phase === 'done' ? 2 : phase === 'running' ? 1 : hasFiles ? 1 : 0
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Progress">
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={clsx(
              'grid h-6 w-6 place-items-center rounded-full text-xs font-semibold',
              i < current ? 'bg-emerald-500 text-white' : i === current ? 'bg-brand-600 text-white' : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800',
            )}
            aria-current={i === current ? 'step' : undefined}
          >
            {i + 1}
          </span>
          <span className={clsx(i === current ? 'font-medium' : 'text-neutral-500')}>{s}</span>
          {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-neutral-300 dark:bg-neutral-700" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

function Processing({ tool, frac, message }: { tool: ToolDef; frac: number | null; message: string }) {
  const pct = frac === null ? null : Math.round(frac * 100)
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900" role="status" aria-live="polite">
      <LoaderCircle className="mx-auto animate-spin text-brand-600" size={32} />
      <h2 className="mt-4 text-lg font-semibold">Running {tool.name}…</h2>
      <p className="mt-1 text-sm text-neutral-500">{message || 'This may take a moment for large files.'}</p>
      <div
        className="mx-auto mt-5 h-2 max-w-md overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={pct === null ? 'Working' : `${pct}%`}
      >
        {pct === null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-600" />
        ) : (
          <div className="h-full rounded-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.max(3, pct)}%` }} />
        )}
      </div>
      {pct !== null && <div className="mt-2 text-xs text-neutral-500 tabular-nums">{pct}%</div>}
    </div>
  )
}

function ErrorPanel({ error }: { error: Error }) {
  const status = error instanceof ApiError ? error.status : 0
  const msg = error.message
  const missingBinary = status === 501 || /libreoffice|tesseract|not installed|not available/i.test(msg)
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200" role="alert">
      <div className="flex items-start gap-2">
        <CircleExclamationPoint size={18} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{missingBinary ? 'This tool needs an extra program on the server' : 'Something went wrong'}</div>
          <p className="mt-1 wrap-break-word">{msg}</p>
          {missingBinary && (
            <p className="mt-2 text-red-700 dark:text-red-300">
              Conversions use LibreOffice and OCR uses Tesseract. Run Folio with Docker (both are included), or install the missing binary on the server.{' '}
              <a href={README_URL} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                See the README
              </a>
              .
            </p>
          )}
          {status === 0 && !missingBinary && <p className="mt-1 text-red-700 dark:text-red-300">Is the backend running?</p>}
        </div>
      </div>
    </div>
  )
}
