import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, FileUp, Info, Lock, X, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { downloadUrl, getPdfInfo, uploadFiles, ApiError } from '../lib/api'
import { handleGatingError } from '../lib/upgrade'
import { addFormFields, applyEdits, fetchPdfBytes, getAnnotations, getFormFields, getLinks, getImages } from './api'
import DocumentView from './components/DocumentView'
import InfoDialog from './components/InfoDialog'
import OrganizeGrid from './components/OrganizeGrid'
import PropertiesPanel from './components/PropertiesPanel'
import ReadAloud from './components/ReadAloud'
import RedactSearchDialog from './components/RedactSearchDialog'
import Sidebar from './components/Sidebar'
import SignatureDialog from './components/SignatureDialog'
import StatusBar from './components/StatusBar'
import Toolbar from './components/Toolbar'
import { btnCls, btnPrimaryCls, inputCls, Spinner } from './components/ui'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { serializeOps } from './ops'
import { loadDocument, PasswordRequiredError } from './pdfjs'
import { useDirtyCount, useViewer } from './store'
import type { Mode } from './types'
import './viewer.css'

const TOOL_MODES: Record<string, Mode> = {
  edit: 'select',
  view: 'select',
  sign: 'sign',
  stamp: 'stamp',
  redact: 'redact',
  organize: 'organize',
  'fill-form': 'forms',
}

export default function ViewerPage() {
  const { fileId } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const tool = params.get('tool')

  if (!fileId) return <OpenDropzone onOpen={(id) => navigate(`/view/${id}${tool ? `?tool=${tool}` : ''}`)} />
  return <Viewer key={fileId} fileId={fileId} tool={tool} />
}

function OpenDropzone({ onOpen }: { onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const onDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setBusy(true)
      setError(null)
      try {
        const [out] = await uploadFiles([files[0]], setProgress)
        onOpen(out.file_id)
      } catch (e) {
        setError((e as Error).message)
        setBusy(false)
      }
    },
    [onOpen],
  )
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop, accept: { 'application/pdf': ['.pdf'] }, multiple: false, noClick: true })
  return (
    <div {...getRootProps()} className={clsx('flex h-full flex-col items-center justify-center p-8 transition', isDragActive && 'bg-brand-50 dark:bg-brand-950/30')}>
      <input {...getInputProps()} />
      <div className={clsx('flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center', isDragActive ? 'border-brand-500' : 'border-neutral-300 dark:border-neutral-700')}>
        <span className="grid h-14 w-14 place-items-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200">
          <FileUp size={26} />
        </span>
        <h1 className="text-xl font-semibold">Drop a PDF to open</h1>
        <p className="text-sm text-neutral-500">View, annotate, edit text, fill forms, sign, redact and organize pages — all in your browser.</p>
        {busy ? (
          <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            <Spinner /> Uploading… {Math.round(progress * 100)}%
          </div>
        ) : (
          <button type="button" onClick={open} className={btnPrimaryCls}>
            Choose a file
          </button>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  )
}

function Viewer({ fileId, tool }: { fileId: string; tool: string | null }) {
  const navigate = useNavigate()
  const loading = useViewer((s) => s.loading)
  const loadError = useViewer((s) => s.loadError)
  const ready = useViewer((s) => s.fileId === fileId && !!s.doc)
  const mode = useViewer((s) => s.mode)
  const sidebarOpen = useViewer((s) => s.sidebarOpen)
  const propsOpen = useViewer((s) => s.propsOpen)
  const dialog = useViewer((s) => s.dialog)
  const dirty = useDirtyCount()
  const [needPassword, setNeedPassword] = useState<{ wrong: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const passwordRef = useRef<string | undefined>(undefined)
  const printFrame = useRef<HTMLIFrameElement>(null)

  // ---- load --------------------------------------------------------------------
  const load = useCallback(
    async (password?: string) => {
      const s = useViewer.getState()
      s.setLoading(true)
      try {
        const info = await getPdfInfo(fileId, password)
        if (info.encrypted && info.page_count === 0) {
          s.setLoading(false)
          setNeedPassword({ wrong: !!password })
          return
        }
        const bytes = await fetchPdfBytes(fileId)
        let doc
        try {
          doc = await loadDocument(bytes, password)
        } catch (e) {
          if (e instanceof PasswordRequiredError) {
            s.setLoading(false)
            setNeedPassword({ wrong: !!password })
            return
          }
          throw e
        }
        passwordRef.current = password
        s.openDocument({ fileId, info, doc, password })
        setNeedPassword(null)
        const initial = tool ? TOOL_MODES[tool] : undefined
        if (initial) s.setMode(initial)
        else if (s.mode === 'organize') s.setMode('select')
        if (initial === 'forms') s.setSidebar(true, 'forms')
        // Secondary data (non-blocking)
        getAnnotations(fileId).then(s.setAnnotations).catch(() => undefined)
        getLinks(fileId).then(s.setLinks).catch(() => undefined)
        if (info.has_forms || initial === 'forms') {
          getFormFields(fileId)
            .then((r) => s.setFields(r.fields))
            .catch(() => undefined)
        }
      } catch (e) {
        const msg = e instanceof ApiError && e.status === 404 ? 'File not found. It may have expired.' : (e as Error).message
        s.setLoading(false, msg)
      }
    },
    [fileId, tool],
  )

  useEffect(() => {
    // Deferred so React finishes committing before the async load mutates state.
    const t = setTimeout(() => void load(), 0)
    return () => {
      clearTimeout(t)
      useViewer.getState().closeDocument()
    }
  }, [load])

  // Images for visible pages when needed (edit-text / image mode).
  const currentPage = useViewer((s) => s.currentPage)
  useEffect(() => {
    if (!ready || (mode !== 'edit-text' && mode !== 'image')) return
    const s = useViewer.getState()
    const pages = [currentPage - 1, currentPage, currentPage + 1].filter((p) => p >= 1 && p <= (s.info?.page_count ?? 0))
    for (const p of pages) {
      if (s.images[p]) continue
      getImages(fileId, p)
        .then((imgs) => useViewer.getState().setImages(p, imgs))
        .catch(() => useViewer.getState().setImages(p, []))
    }
  }, [ready, mode, currentPage, fileId])

  // ---- unsaved changes guard ---------------------------------------------------
  useEffect(() => {
    if (!dirty) return
    const onBefore = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [dirty])

  // ---- actions -----------------------------------------------------------------
  const save = useCallback(async () => {
    const s = useViewer.getState()
    if (saving || !s.fileId) return
    if (!s.ops.length && !s.newFields.length) {
      s.notify('info', 'Nothing to save')
      return
    }
    const hasRedact = s.ops.some((p) => p.op.type === 'redact')
    if (hasRedact && !window.confirm('Redactions permanently remove the underlying content and cannot be undone after saving. Apply them now?')) return
    setSaving(true)
    try {
      let fid = s.fileId
      let warnings: string[] = []
      if (s.newFields.length) {
        const r = await addFormFields(fid, s.newFields)
        if (!r.outputs[0]) throw new Error('add-fields returned no output')
        fid = r.outputs[0].file_id
        warnings = warnings.concat(r.warnings ?? [])
      }
      if (s.ops.length) {
        const r = await applyEdits(fid, serializeOps(s.ops), s.flattenOnSave)
        if (!r.outputs[0]) throw new Error('apply returned no output')
        fid = r.outputs[0].file_id
        warnings = warnings.concat(r.warnings ?? [])
        const failed = r.data?.failed
        if (Array.isArray(failed) && failed.length) warnings.push(`${failed.length} operation(s) could not be applied`)
      }
      for (const w of warnings) s.notify('warning', w)
      s.clearEdits()
      s.notify('success', 'Saved')
      navigate(`/view/${fid}${window.location.search}`)
    } catch (e) {
      if (handleGatingError(e)) s.notify('info', 'Saving these edits needs a higher plan')
      else s.notify('error', `Save failed: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }, [navigate, saving])

  const download = useCallback(() => {
    const a = document.createElement('a')
    a.href = downloadUrl(fileId)
    a.download = ''
    a.click()
  }, [fileId])

  const print = useCallback(() => {
    const f = printFrame.current
    if (!f) return
    f.onload = () => {
      try {
        f.contentWindow?.focus()
        f.contentWindow?.print()
      } catch {
        window.open(downloadUrl(fileId, true), '_blank')
      }
    }
    f.src = downloadUrl(fileId, true)
  }, [fileId])

  const actions = useMemo(() => ({ save: () => void save(), download, print, saving }), [save, download, print, saving])
  useKeyboardShortcuts(ready, actions)

  // Image insertion upload (hidden input shared by toolbar + overlay).
  const onImagePicked = async (file: File | undefined) => {
    if (!file) return
    const s = useViewer.getState()
    try {
      const [out] = await uploadFiles([file])
      const aspect = await new Promise<number>((resolve) => {
        const img = new Image()
        img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight))
        img.onerror = () => resolve(4 / 3)
        img.src = URL.createObjectURL(file)
      })
      s.setPendingImage({ fileId: out.file_id, aspect })
      s.setMode('image')
      s.notify('info', 'Click or drag on the page to place the image')
    } catch (e) {
      s.notify('error', `Upload failed: ${(e as Error).message}`)
    }
  }

  // ---- render ------------------------------------------------------------------
  if (needPassword) return <PasswordPrompt wrong={needPassword.wrong} onSubmit={(pw) => void load(pw)} />
  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <XCircle className="text-red-500" size={32} />
        <p className="text-sm text-neutral-700 dark:text-neutral-300">{loadError}</p>
        <button type="button" className={btnCls} onClick={() => navigate('/view')}>
          Open another file
        </button>
      </div>
    )
  }
  if (loading || !ready) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-sm text-neutral-500">
        <Spinner /> Loading document…
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-neutral-100 dark:bg-neutral-900">
      <Toolbar actions={actions} />
      {dialog === 'readaloud' && <ReadAloud onClose={() => useViewer.getState().setDialog(null)} />}
      {dirty > 0 && <UnsavedBanner count={dirty} onSave={() => void save()} saving={saving} />}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && mode !== 'organize' && <Sidebar />}
        <div className="relative min-w-0 flex-1">{mode === 'organize' ? <OrganizeGrid /> : <DocumentView />}</div>
        {propsOpen && mode !== 'organize' && <PropertiesPanel />}
      </div>
      <StatusBar />
      <Toasts />
      <input id="v-image-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => void onImagePicked(e.target.files?.[0]).then(() => (e.target.value = ''))} />
      <iframe ref={printFrame} title="print" aria-hidden tabIndex={-1} style={{ position: 'fixed', width: 1, height: 1, left: -10, bottom: 0, border: 0, opacity: 0, pointerEvents: 'none' }} />
      {dialog === 'signature' && <SignatureDialog onClose={() => useViewer.getState().setDialog(null)} />}
      {dialog === 'info' && <InfoDialog onClose={() => useViewer.getState().setDialog(null)} />}
      {dialog === 'redact-search' && <RedactSearchDialog onClose={() => useViewer.getState().setDialog(null)} />}
    </div>
  )
}

function UnsavedBanner({ count, onSave, saving }: { count: number; onSave: () => void; saving: boolean }) {
  return (
    <div className="flex h-8 items-center gap-3 border-b border-amber-200 bg-amber-50 px-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <AlertTriangle size={14} />
      <span>
        {count} unsaved change{count === 1 ? '' : 's'}
      </span>
      <button type="button" onClick={onSave} disabled={saving} className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50">
        {saving ? 'Saving…' : 'Save now'}
      </button>
      <button
        type="button"
        onClick={() => {
          if (window.confirm('Discard all pending changes?')) useViewer.getState().clearEdits()
        }}
        className="rounded px-2 py-0.5 hover:bg-amber-100 dark:hover:bg-amber-900/40"
      >
        Discard
      </button>
    </div>
  )
}

function PasswordPrompt({ wrong, onSubmit }: { wrong: boolean; onSubmit: (pw: string) => void }) {
  const [pw, setPw] = useState('')
  return (
    <div className="flex h-full items-center justify-center p-8">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(pw)
        }}
        className="flex w-full max-w-sm flex-col gap-3 rounded-xl border border-neutral-200 bg-white p-6 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      >
        <div className="flex items-center gap-2 font-semibold">
          <Lock size={18} className="text-brand-600" /> This PDF is password protected
        </div>
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className={inputCls} />
        {wrong && <p className="text-xs text-red-600">Incorrect password. Try again.</p>}
        <button type="submit" className={btnPrimaryCls} disabled={!pw}>
          Open
        </button>
      </form>
    </div>
  )
}

function Toasts() {
  const toasts = useViewer((s) => s.toasts)
  const dismiss = useViewer((s) => s.dismissToast)
  if (!toasts.length) return null
  const icon = { info: <Info size={15} />, success: <CheckCircle2 size={15} className="text-emerald-500" />, warning: <AlertTriangle size={15} className="text-amber-500" />, error: <XCircle size={15} className="text-red-500" /> }
  return (
    <div className="pointer-events-none fixed bottom-12 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="v-fade-in pointer-events-auto flex items-start gap-2 rounded-lg border border-neutral-200 bg-white/95 p-3 text-xs shadow-lg backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95">
          <span className="mt-0.5 shrink-0">{icon[t.kind]}</span>
          <span className="flex-1 break-words">{t.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-white">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
