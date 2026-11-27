/** Create / pick a signature: draw, type or upload. Saved list lives in localStorage. */
import clsx from 'clsx'
import { Check, Eraser, Trash2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { downloadUrl, uploadFiles } from '../../lib/api'
import { createSignatureImage } from '../api'
import { useLocalSignatures } from '../hooks/useLocalSignatures'
import { newId } from '../ops'
import { useViewer } from '../store'
import type { SavedSignature } from '../types'
import { btnCls, btnPrimaryCls, Dialog, inputCls, Spinner } from './ui'

type Tab = 'draw' | 'type' | 'upload'
const W = 600
const H = 200

export default function SignatureDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('draw')
  const { signatures, add, remove } = useLocalSignatures()
  const [busy, setBusy] = useState(false)
  const [color, setColor] = useState('#1a1a1a')
  const [width, setWidth] = useState(3)
  const [paths, setPaths] = useState<[number, number][][]>([])
  const [text, setText] = useState('')
  const [font, setFont] = useState<'cursive' | 'serif' | 'sans'>('cursive')
  const [file, setFile] = useState<File | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<[number, number][] | null>(null)

  // draw canvas
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.lineWidth = width
    // baseline
    ctx.save()
    ctx.strokeStyle = 'rgba(120,120,120,0.35)'
    ctx.setLineDash([6, 6])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(30, H - 50)
    ctx.lineTo(W - 30, H - 50)
    ctx.stroke()
    ctx.restore()
    for (const p of paths) {
      ctx.beginPath()
      p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
  }, [paths, color, width])

  const pt = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    return [Math.round(((e.clientX - r.left) / r.width) * W), Math.round(((e.clientY - r.top) / r.height) * H)]
  }

  const pick = (sig: SavedSignature) => {
    const s = useViewer.getState()
    s.setActiveSignature(sig)
    if (s.mode !== 'sign') s.setMode('sign')
    onClose()
  }

  const create = async () => {
    setBusy(true)
    const s = useViewer.getState()
    try {
      let fileId: string
      let preview: string
      let kind: SavedSignature['kind']
      let aspect = W / H
      if (tab === 'draw') {
        if (!paths.length) return
        const r = await createSignatureImage({ kind: 'draw', paths, color, width })
        fileId = r.outputs[0].file_id
        preview = previewFromPaths(paths, color, width)
        kind = 'draw'
      } else if (tab === 'type') {
        if (!text.trim()) return
        const r = await createSignatureImage({ kind: 'type', text: text.trim(), font, color, width })
        fileId = r.outputs[0].file_id
        preview = previewFromText(text.trim(), font, color)
        kind = 'type'
      } else {
        if (!file) return
        const [out] = await uploadFiles([file])
        fileId = out.file_id
        const img = await loadImage(URL.createObjectURL(file))
        aspect = img.naturalWidth / Math.max(1, img.naturalHeight)
        preview = toDataUrl(img)
        kind = 'upload'
      }
      const sig: SavedSignature = { id: newId(), file_id: fileId, preview, kind, label: tab === 'type' ? text.trim() : kind === 'upload' ? file!.name : 'Drawn signature', created: Date.now(), aspect }
      add(sig)
      pick(sig)
      s.notify('success', 'Signature saved. Click on the page to place it.')
    } catch (e) {
      s.notify('error', `Could not create signature: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (t: Tab, label: string) => (
    <button key={t} type="button" onClick={() => setTab(t)} className={clsx('flex-1 rounded-md px-3 py-1.5 text-sm font-medium', tab === t ? 'bg-white shadow dark:bg-neutral-700' : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-white')}>
      {label}
    </button>
  )

  const canCreate = tab === 'draw' ? paths.length > 0 : tab === 'type' ? text.trim().length > 0 : !!file

  return (
    <Dialog
      title="Signature"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className={btnCls} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimaryCls} disabled={!canCreate || busy} onClick={() => void create()}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : <Check size={15} />} Save &amp; use
          </button>
        </>
      }
    >
      <div className="mb-3 flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        {tabBtn('draw', 'Draw')}
        {tabBtn('type', 'Type')}
        {tabBtn('upload', 'Upload')}
      </div>

      {tab === 'draw' && (
        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="w-full touch-none rounded-lg border border-neutral-300 bg-white dark:border-neutral-600"
            style={{ aspectRatio: `${W} / ${H}`, cursor: 'crosshair' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = [pt(e)]
              setPaths((p) => [...p, drawing.current!])
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              drawing.current.push(pt(e))
              setPaths((p) => [...p.slice(0, -1), drawing.current!.slice()])
            }}
            onPointerUp={() => (drawing.current = null)}
          />
          <div className="flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
            <label className="flex items-center gap-1">
              Color
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
            </label>
            <label className="flex items-center gap-1">
              Pen
              <input type="range" min={1} max={8} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-24 accent-brand-600" />
            </label>
            <span className="flex-1" />
            <button type="button" className={btnCls} onClick={() => setPaths([])}>
              <Eraser size={14} /> Clear
            </button>
          </div>
        </div>
      )}

      {tab === 'type' && (
        <div className="space-y-3">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Your name" className={clsx(inputCls, 'text-lg')} autoFocus />
          <div className="grid grid-cols-3 gap-2">
            {(['cursive', 'serif', 'sans'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFont(f)} className={clsx('rounded-lg border p-3 text-2xl', fontCss(f), font === f ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-neutral-300 dark:border-neutral-600')} style={{ color }}>
                {text.trim() || 'Signature'}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-xs">
            Color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
          </label>
        </div>
      )}

      {tab === 'upload' && (
        <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-300 text-sm text-neutral-500 hover:border-brand-400 dark:border-neutral-600">
          <Upload size={22} />
          {file ? file.name : 'Choose a PNG with transparent background'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      )}

      {signatures.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Saved signatures</div>
          <div className="grid grid-cols-3 gap-2">
            {signatures.map((sig) => (
              <div key={sig.id} className="group relative rounded-lg border border-neutral-200 bg-white p-1 hover:border-brand-400 dark:border-neutral-700 dark:bg-neutral-100">
                <button type="button" className="block w-full" onClick={() => pick(sig)} title={sig.label}>
                  <img src={sig.preview || downloadUrl(sig.file_id, true)} alt={sig.label} className="h-14 w-full object-contain" />
                </button>
                <button type="button" aria-label="Delete signature" onClick={() => remove(sig.id)} className="absolute right-1 top-1 rounded bg-white/90 p-0.5 text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  )
}

function fontCss(f: 'cursive' | 'serif' | 'sans'): string {
  return f === 'cursive' ? 'font-[cursive] italic' : f === 'serif' ? 'font-serif' : 'font-sans'
}

function previewFromPaths(paths: [number, number][][], color: string, width: number): string {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.lineWidth = width
  for (const p of paths) {
    ctx.beginPath()
    p.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    ctx.stroke()
  }
  return c.toDataURL('image/png')
}

function previewFromText(text: string, font: 'cursive' | 'serif' | 'sans', color: string): string {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  const fam = font === 'cursive' ? 'italic 72px "Brush Script MT", "Segoe Script", cursive' : font === 'serif' ? '64px Georgia, serif' : '60px Helvetica, Arial, sans-serif'
  ctx.font = fam
  let size = 72
  while (ctx.measureText(text).width > W - 40 && size > 16) {
    size -= 4
    ctx.font = fam.replace(/\d+px/, `${size}px`)
  }
  ctx.fillText(text, W / 2, H / 2)
  return c.toDataURL('image/png')
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read image'))
    img.src = src
  })
}

function toDataUrl(img: HTMLImageElement): string {
  const c = document.createElement('canvas')
  const scale = Math.min(1, 300 / Math.max(1, img.naturalWidth))
  c.width = Math.max(1, Math.round(img.naturalWidth * scale))
  c.height = Math.max(1, Math.round(img.naturalHeight * scale))
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}
