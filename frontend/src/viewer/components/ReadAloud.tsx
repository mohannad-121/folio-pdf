/** Read-aloud bar using the Web Speech API over the server's plain-text extraction. */
import { Pause, Play, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPageText } from '../api'
import { useViewer } from '../store'
import { IconButton, inputCls } from './ui'

export default function ReadAloud({ onClose }: { onClose: () => void }) {
  const fileId = useViewer((s) => s.fileId)
  const password = useViewer((s) => s.password)
  const pageCount = useViewer((s) => s.info?.page_count ?? 1)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceURI, setVoiceURI] = useState('')
  const [rate, setRate] = useState(1)
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'paused'>('idle')
  const [page, setPage] = useState(() => useViewer.getState().currentPage)
  const [error, setError] = useState<string | null>(null)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window

  useEffect(() => {
    if (!supported) return
    const load = () => setVoices(window.speechSynthesis.getVoices())
    load()
    window.speechSynthesis.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis.removeEventListener('voiceschanged', load)
  }, [supported])

  const stop = useCallback(() => {
    if (supported) window.speechSynthesis.cancel()
    utterRef.current = null
    setState('idle')
  }, [supported])

  useEffect(() => () => stop(), [stop])

  const speakRef = useRef<(p: number) => Promise<void>>(async () => undefined)
  const speakPage = useCallback(
    async (p: number) => {
      if (!fileId || !supported) return
      setState('loading')
      setError(null)
      try {
        const res = await getPageText(fileId, String(p), password)
        const text = res[0]?.text?.trim() ?? ''
        if (!text) {
          if (p < pageCount) return void speakRef.current(p + 1)
          setState('idle')
          setError('No readable text on this page.')
          return
        }
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        const v = voices.find((x) => x.voiceURI === voiceURI)
        if (v) u.voice = v
        u.rate = rate
        u.onend = () => {
          if (utterRef.current !== u) return
          if (p < pageCount) {
            setPage(p + 1)
            useViewer.getState().scrollToPage(p + 1)
            void speakRef.current(p + 1)
          } else setState('idle')
        }
        u.onerror = (e) => {
          if (e.error === 'interrupted' || e.error === 'canceled') return
          setError(`Speech error: ${e.error}`)
          setState('idle')
        }
        utterRef.current = u
        setPage(p)
        setState('playing')
        window.speechSynthesis.speak(u)
      } catch (e) {
        setError((e as Error).message)
        setState('idle')
      }
    },
    [fileId, password, pageCount, rate, supported, voiceURI, voices],
  )
  useEffect(() => {
    speakRef.current = speakPage
  }, [speakPage])

  const toggle = () => {
    if (state === 'playing') {
      window.speechSynthesis.pause()
      setState('paused')
    } else if (state === 'paused') {
      window.speechSynthesis.resume()
      setState('playing')
    } else void speakPage(page)
  }

  if (!supported) {
    return (
      <Bar onClose={onClose}>
        <span className="text-xs text-red-600">Speech synthesis is not available in this browser.</span>
      </Bar>
    )
  }

  return (
    <Bar onClose={onClose}>
      <IconButton label={state === 'playing' ? 'Pause' : 'Play'} onClick={toggle} primary className="h-7 w-7 rounded-full">
        {state === 'playing' ? <Pause size={14} /> : <Play size={14} />}
      </IconButton>
      <IconButton label="Stop" onClick={stop} disabled={state === 'idle'} className="h-7 w-7">
        <Square size={13} />
      </IconButton>
      <label className="flex items-center gap-1 text-xs">
        Page
        <input type="number" min={1} max={pageCount} value={page} onChange={(e) => setPage(Math.min(pageCount, Math.max(1, Number(e.target.value) || 1)))} className={inputCls + ' h-7 w-16 py-0 text-xs'} disabled={state === 'playing'} />
      </label>
      <select value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)} className={inputCls + ' h-7 w-48 py-0 text-xs'} aria-label="Voice">
        <option value="">Default voice</option>
        {voices.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} ({v.lang})
          </option>
        ))}
      </select>
      <label className="flex items-center gap-1 text-xs">
        Speed
        <input type="range" min={0.5} max={2} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="w-20 accent-brand-600" />
        <span className="w-8 tabular-nums">{rate.toFixed(1)}×</span>
      </label>
      <span className="text-xs text-neutral-500">{state === 'loading' ? 'Loading text…' : state === 'playing' ? `Reading page ${page}` : state === 'paused' ? 'Paused' : ''}</span>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </Bar>
  )
}

function Bar({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-neutral-200 bg-brand-50 px-3 dark:border-neutral-800 dark:bg-brand-950/40">
      <span className="text-xs font-semibold text-brand-700 dark:text-brand-200">Read aloud</span>
      {children}
      <span className="flex-1" />
      <IconButton label="Close" onClick={onClose} className="h-7 w-7">
        <X size={14} />
      </IconButton>
    </div>
  )
}
