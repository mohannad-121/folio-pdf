import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CircleCheck, CircleExclamationPoint, Info, X } from 'lucide-react'
import clsx from 'clsx'
import { create } from 'zustand'
import { slideInRight } from '../../lib/motion'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  title: string
  description?: string
  /** ms; 0 = sticky. */
  duration: number
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => number
  dismiss: (id: number) => void
}

let seq = 0
const timers = new Map<number, number>()

export const useToast = create<ToastState>()((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq
    const duration = t.duration ?? (t.kind === 'error' ? 6000 : 3200)
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id, duration }] }))
    if (duration > 0) timers.set(id, window.setTimeout(() => get().dismiss(id), duration))
    return id
  },
  dismiss: (id) => {
    const t = timers.get(id)
    if (t) window.clearTimeout(t)
    timers.delete(id)
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }))
  },
}))

/** Imperative helpers: toast.success('Copied'), toast.error('…'), toast.info('…'). */
export const toast = {
  success: (title: string, description?: string) => useToast.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) => useToast.getState().push({ kind: 'error', title, description }),
  info: (title: string, description?: string) => useToast.getState().push({ kind: 'info', title, description }),
}

const icons = { success: CircleCheck, error: CircleExclamationPoint, info: Info }
const tones = {
  success: 'text-emerald-600 dark:text-emerald-400',
  error: 'text-red-600 dark:text-red-400',
  info: 'text-brand-600 dark:text-brand-300',
}

/** Mount once near the root. Bottom-right stack, slide-in, auto-dismiss. */
export default function Toaster() {
  const toasts = useToast((s) => s.toasts)
  const dismiss = useToast((s) => s.dismiss)
  const reduce = useReducedMotion()
  if (typeof document === 'undefined') return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[110] flex flex-col items-end gap-2 p-4 sm:inset-x-auto sm:right-0" aria-live="polite" aria-atomic="false">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = icons[t.kind]
          return (
            <motion.div
              key={t.id}
              layout
              variants={reduce ? undefined : slideInRight}
              initial="initial"
              animate="animate"
              exit="exit"
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={clsx(
                'pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border border-border bg-surface/95 p-3 pr-2 pl-4 shadow-lift backdrop-blur-md',
                'before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-full',
                t.kind === 'success' ? 'before:bg-emerald-500' : t.kind === 'error' ? 'before:bg-red-500' : 'before:bg-brand-500',
              )}
            >
              <Icon size={18} className={clsx('mt-0.5 shrink-0', tones[t.kind])} aria-hidden="true" />
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{t.title}</div>
                {t.description && <div className="mt-0.5 text-xs text-muted wrap-break-word">{t.description}</div>}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="rounded-md p-1 text-muted-2 transition hover:bg-surface-2 hover:text-fg" aria-label="Dismiss">
                <X size={14} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>,
    document.body,
  )
}
