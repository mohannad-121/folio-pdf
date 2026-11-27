import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, Check, ChevronRight, CircleExclamationPoint, Copy, Sparkles, TriangleExclamationPoint } from 'lucide-react'
import clsx from 'clsx'
import { ApiError, getFile, getPdfInfo, runTool, uploadFiles, type FileOut, type ToolResult } from '../lib/api'
import { CATEGORY_LABELS, TOOLS, TOOLS_BY_ID, type ToolDef } from '../lib/tools'
import { CATEGORY_META, categoryAccent } from '../lib/theme'
import { fade, instant, spring, step, tween } from '../lib/motion'
import ToolIcon from '../components/ToolIcon'
import NotFound from '../pages/NotFound'
import { useRecentTools } from '../components/recentTools'
import { Badge, Button, ProgressBar, toast } from '../components/ui'
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
  const reduce = useReducedMotion()
  const acc = categoryAccent(tool.category)

  const [files, setFiles] = useState<InputFile[]>([])
  const [values, setValues] = useState<OptionValues>(() => defaultValues(tool))
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  const [phase, setPhase] = useState<Phase>('input')
  const [progress, setProgress] = useState<{ frac: number | null; message: string }>({ frac: null, message: '' })
  const [result, setResult] = useState<ToolResult | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined)
  const [error, setError] = useState<Error | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Latest files for event handlers (kept in sync after each render).
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  // Remember this tool for the command palette's "Recent" group.
  useEffect(() => {
    useRecentTools.getState().touch(tool.id)
  }, [tool.id])

  const multiple = allowsMultiple(tool.input)
  const limit = maxFiles(tool.input)
  const isPair = tool.input.kind === 'pdf-pair'
  const isHtml = tool.input.kind === 'html'

  const patch = useCallback((localId: string, p: Partial<InputFile>) => {
    setFiles((fs) => fs.map((f) => (f.localId === localId ? { ...f, ...p } : f)))
  }, [])

  const goToViewer = useCallback((fileId: string) => navigate(`/view/${fileId}?tool=${tool.id}`), [navigate, tool.id])

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
            const msg = e instanceof Error ? e.message : 'Upload failed'
            patch(entry.localId, { status: 'error', error: msg })
            toast.error('Upload failed', `${entry.name}: ${msg}`)
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
    const started = performance.now()
    try {
      const res = await runTool(tool.endpoint, buildBody(), (frac, message) => setProgress({ frac, message }))
      const took = performance.now() - started
      setResult(res)
      setElapsedMs(took)
      res.outputs?.forEach((o) => addRecent(o, 'output'))
      setPhase('done')
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      setError(err)
      setPhase('input')
      toast.error(`${tool.name} failed`, err.message)
    }
  }

  const startOver = () => {
    files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl))
    setFiles([])
    setValues(defaultValues(tool))
    setInvalid({})
    setResult(null)
    setElapsedMs(undefined)
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
    <div className="mx-auto max-w-7xl px-4 py-8" style={acc.style as CSSProperties}>
      {/* Hero header */}
      <header className="card-wash-strong relative mb-8 overflow-hidden rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8">
        <div className="pointer-events-none absolute -top-24 -right-24 size-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_26%,transparent),transparent)]" aria-hidden="true" />
        <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_left,black,transparent_60%)] opacity-70" aria-hidden="true" />
        <nav aria-label="Breadcrumb" className="relative mb-4 flex items-center gap-1 text-xs text-muted">
          <Link to="/" className="rounded transition hover:text-fg">
            All tools
          </Link>
          <ChevronRight size={12} aria-hidden="true" />
          <Link to={`/#cat-${tool.category}`} className={clsx('rounded font-medium transition hover:underline', acc.text)}>
            {CATEGORY_LABELS[tool.category]}
          </Link>
        </nav>
        <div className="relative flex items-start gap-4 sm:gap-5">
          <motion.span initial={reduce ? false : { scale: 0.8, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={spring} className={clsx('grid size-14 shrink-0 place-items-center rounded-2xl shadow-[0_12px_28px_-10px_var(--accent)] sm:size-16', acc.tile)}>
            <ToolIcon name={tool.icon} size={30} />
          </motion.span>
          <div className="min-w-0">
            <div className={clsx('text-eyebrow mb-1', acc.text)}>{CATEGORY_META[tool.category].eyebrow}</div>
            <h1 className="text-title text-[1.75rem] sm:text-4xl">{tool.name}</h1>
            <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted text-pretty">{tool.description}</p>
            {tool.opensViewer && (
              <Badge tone="accent" size="md" className="mt-3">
                <Sparkles size={12} /> Opens in the editor after upload
              </Badge>
            )}
          </div>
        </div>
        {related.length > 0 && (
          <div className="relative mt-5 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-muted">Related:</span>
            {related.slice(0, 8).map((t) => (
              <Link key={t.id} to={`/tools/${t.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs transition hover:-translate-y-px hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--color-border))] hover:shadow-glow">
                <ToolIcon name={t.icon} size={12} className={acc.text} />
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <Stepper phase={phase} hasFiles={files.length > 0} hasOptions={!!tool.options?.length} viewer={!!tool.opensViewer} />

          <AnimatePresence initial={false}>
            {notice && (
              <motion.p key="notice" variants={reduce ? undefined : fade} initial="initial" animate="animate" exit="exit" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" role="status">
                <TriangleExclamationPoint size={16} className="mt-0.5 shrink-0" /> {notice}
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            {phase === 'done' && result ? (
              <motion.div key="done" variants={reduce ? undefined : step} initial="initial" animate="animate" exit="exit">
                <ResultsStep tool={tool} result={result} inputs={ready} elapsedMs={elapsedMs} onStartOver={startOver} onContinue={(id, fileId) => navigate(`/tools/${id}?file=${encodeURIComponent(fileId)}`)} />
              </motion.div>
            ) : phase === 'running' ? (
              <motion.div key="running" variants={reduce ? undefined : step} initial="initial" animate="animate" exit="exit">
                <Processing tool={tool} frac={progress.frac} message={progress.message} />
              </motion.div>
            ) : (
              <motion.form
                key="input"
                variants={reduce ? undefined : step}
                initial="initial"
                animate="animate"
                exit="exit"
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

                <AnimatePresence initial={false}>{error && <ErrorPanel key="error" error={error} reduce={!!reduce} />}</AnimatePresence>

                <AnimatePresence initial={false}>
                  {showOptions && !tool.opensViewer && (
                    <motion.section
                      key="options"
                      initial={reduce ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reduce ? undefined : { opacity: 0, y: 8 }}
                      transition={tween}
                      className="rounded-2xl border border-border bg-surface p-5 shadow-card sm:p-6"
                      aria-labelledby="step-options"
                    >
                      {tool.options?.length ? (
                        <>
                          <div className="mb-5 flex items-center justify-between gap-3">
                            <h2 id="step-options" className="text-title text-lg">
                              Options
                            </h2>
                            {pageCount != null && (
                              <Badge tone="neutral" className="tabular">
                                {pageCount} page{pageCount === 1 ? '' : 's'}
                              </Badge>
                            )}
                          </div>
                          <OptionsForm tool={tool} values={values} onChange={(k, v) => setValues((o) => ({ ...o, [k]: v }))} pageCount={pageCount} onValidity={onValidity} onExtraUpload={(f) => addRecent(f, 'upload')} />
                        </>
                      ) : (
                        <h2 id="step-options" className="flex items-center gap-2 text-sm text-muted">
                          <Check size={16} className="text-emerald-500" /> No options for this tool — you're ready to go.
                        </h2>
                      )}
                      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
                        <Button type="submit" variant="accent" size="lg" disabled={!canRun} className={clsx('group min-w-48', acc.gradient)} rightIcon={<ArrowRight className="transition-transform duration-200 group-hover:translate-x-1" />}>
                          {runLabel}
                        </Button>
                        <AnimatePresence mode="wait" initial={false}>
                          {blocker && (
                            <motion.span key={blocker} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="text-sm text-muted">
                              {blocker}
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.section>
                  )}
                </AnimatePresence>
              </motion.form>
            )}
          </AnimatePresence>
        </div>

        <RecentFiles canUse={canUseRecent} onPick={(f) => addStored([f])} />
      </div>
    </div>
  )
}

function Stepper({ phase, hasFiles, hasOptions, viewer }: { phase: Phase; hasFiles: boolean; hasOptions: boolean; viewer: boolean }) {
  const reduce = useReducedMotion()
  const steps = viewer ? ['Upload', 'Edit in viewer'] : ['Upload', hasOptions ? 'Options' : 'Run', 'Result']
  const current = phase === 'done' ? 2 : phase === 'running' ? 1 : hasFiles ? 1 : 0
  const progress = steps.length > 1 ? Math.min(1, current / (steps.length - 1)) : 1
  return (
    <ol className="relative grid text-sm" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Progress">
      {/* Track + animated fill between the first and last step circle. */}
      <div className="absolute top-3.5 right-[calc(100%/var(--n)/2)] left-[calc(100%/var(--n)/2)] h-0.5 -translate-y-1/2 rounded-full bg-border" style={{ '--n': steps.length } as CSSProperties} aria-hidden="true">
        <motion.div className="h-full rounded-full bg-[var(--accent)]" initial={false} animate={{ width: `${progress * 100}%` }} transition={reduce ? instant : { type: 'spring', stiffness: 180, damping: 26 }} />
      </div>
      {steps.map((s, i) => {
        const done = i < current
        const active = i === current
        return (
          <li key={s} className="relative flex flex-col items-center gap-2" aria-current={active ? 'step' : undefined}>
            <motion.span
              animate={active && !reduce ? { scale: [1, 1.08, 1] } : { scale: 1 }}
              transition={active ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : instant}
              className={clsx(
                'relative grid size-7 place-items-center rounded-full text-xs font-semibold ring-4 ring-canvas transition-colors duration-300',
                done ? 'bg-emerald-500 text-white' : active ? 'bg-[var(--accent)] text-white shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_22%,transparent)]' : 'bg-surface-3 text-muted',
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                {done ? (
                  <motion.span key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={spring}>
                    <Check size={14} strokeWidth={3} />
                  </motion.span>
                ) : (
                  <motion.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    {i + 1}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.span>
            <span className={clsx('text-center text-xs sm:text-sm', active ? 'font-medium text-fg' : 'text-muted')}>{s}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Processing({ tool, frac, message }: { tool: ToolDef; frac: number | null; message: string }) {
  const pct = frac === null ? null : Math.round(frac * 100)
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-8 text-center shadow-soft sm:p-12" role="status" aria-live="polite">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_circle_at_50%_0%,color-mix(in_oklab,var(--accent)_12%,transparent),transparent)]" aria-hidden="true" />
      <div className="relative mx-auto grid size-20 place-items-center">
        <span className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0%,var(--accent)_70%,transparent_100%)] [animation-duration:1.4s] [mask:radial-gradient(farthest-side,transparent_calc(100%-5px),black_calc(100%-4px))]" aria-hidden="true" />
        <span className={clsx('grid size-14 place-items-center rounded-full', categoryAccent(tool.category).tile)}>
          <ToolIcon name={tool.icon} size={26} />
        </span>
      </div>
      <h2 className="relative mt-5 text-lg font-semibold tracking-tight">
        Running {tool.name}
        <span className="inline-block w-4 text-left" aria-hidden="true">
          <Dots />
        </span>
      </h2>
      <p className="relative mt-1 text-sm text-muted">{message || 'This may take a moment for large files.'}</p>
      <div className="relative mx-auto mt-6 max-w-md">
        <ProgressBar value={frac} size="md" label={`${tool.name} progress`} />
        <div className="mt-2 flex justify-between text-xs text-muted-2 tabular">
          <span>{pct === null ? 'Working…' : `${pct}%`}</span>
          <span>Keep this tab open</span>
        </div>
      </div>
    </div>
  )
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5 align-baseline">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="inline-block size-1 rounded-full bg-current" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }} />
      ))}
    </span>
  )
}

function ErrorPanel({ error, reduce }: { error: Error; reduce: boolean }) {
  const status = error instanceof ApiError ? error.status : 0
  const msg = error.message
  const missingBinary = status === 501 || /libreoffice|tesseract|not installed|not available/i.test(msg)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${status ? `HTTP ${status}: ` : ''}${msg}`)
      toast.success('Copied error details')
    } catch {
      toast.error('Could not copy')
    }
  }
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? undefined : { opacity: 0, height: 0 }}
      transition={spring}
      className="overflow-hidden rounded-2xl border border-red-200 bg-linear-to-br from-red-50 to-surface p-5 text-sm text-red-900 shadow-soft dark:border-red-500/30 dark:from-red-500/10 dark:to-surface dark:text-red-100"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400">
          <CircleExclamationPoint size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="font-semibold">{missingBinary ? 'This tool needs an extra program on the server' : 'Something went wrong'}</div>
            {status > 0 && (
              <Badge tone="danger" className="tabular">
                HTTP {status}
              </Badge>
            )}
          </div>
          <p className="mt-1 wrap-break-word text-red-800 dark:text-red-200">{msg}</p>
          {missingBinary && (
            <div className="mt-3 rounded-xl border border-red-200/70 bg-surface/70 p-3 text-xs text-fg dark:border-red-500/20">
              <p className="text-muted">Conversions use LibreOffice and OCR uses Tesseract. The easiest fix is running Folio with Docker — both are included:</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-neutral-900 px-3 py-2 font-mono text-[11px] text-neutral-100">docker compose up -d</pre>
              <p className="mt-2 text-muted">
                Or install the missing binary on the server and restart the backend.{' '}
                <a href={README_URL} target="_blank" rel="noreferrer" className="font-medium text-fg underline underline-offset-2">
                  See the README
                </a>
                .
              </p>
            </div>
          )}
          {status === 0 && !missingBinary && <p className="mt-1 text-red-700 dark:text-red-300">Is the backend running? Check that the API is reachable at /api.</p>}
        </div>
        <Button variant="ghost" size="xs" onClick={copy} aria-label="Copy error details" className="shrink-0 text-red-700 hover:bg-red-500/10 dark:text-red-300">
          <Copy /> Copy
        </Button>
      </div>
    </motion.div>
  )
}
