import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import clsx from 'clsx'
import { fade, instant, pop } from '../../lib/motion'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  description?: ReactNode
  children: ReactNode
  /** Width preset. */
  size?: 'sm' | 'md' | 'lg'
  /** Hide the built-in header (for custom content like the command palette). */
  bare?: boolean
  /** Vertical placement; "top" is good for palettes. */
  align?: 'center' | 'top'
  className?: string
  /** Accessible name when `title` is omitted. */
  'aria-label'?: string
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/** Modal dialog: portal, backdrop, Esc to close, basic focus trap, focus restore. */
export default function Dialog({ open, onClose, title, description, children, size = 'md', bare, align = 'center', className, ...aria }: DialogProps) {
  const reduce = useReducedMotion()
  const panel = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Focus the first focusable element (or the panel) after mount.
    const t = window.setTimeout(() => {
      const el = panel.current
      if (!el) return
      const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? el).focus()
    }, 10)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      restore.current?.focus?.()
    }
  }, [open, onClose])

  if (typeof document === 'undefined') return null
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="dialog"
          className={clsx('fixed inset-0 z-[100] flex justify-center px-4', align === 'top' ? 'items-start pt-[12vh]' : 'items-center py-8')}
          variants={reduce ? undefined : fade}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <div className="absolute inset-0 bg-neutral-950/40 backdrop-blur-sm dark:bg-black/60" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={aria['aria-label']}
            tabIndex={-1}
            variants={reduce ? undefined : pop}
            transition={reduce ? instant : undefined}
            className={clsx('relative w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-lift outline-none ring-1 ring-black/5 dark:ring-white/5', sizes[size], className)}
          >
            {!bare && (
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0 flex-1">
                  {title && <h2 className="text-base font-semibold tracking-tight">{title}</h2>}
                  {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
                </div>
                <button type="button" onClick={onClose} className="-m-1 rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Close">
                  <X size={16} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
