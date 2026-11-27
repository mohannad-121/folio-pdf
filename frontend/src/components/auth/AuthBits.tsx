/** Small building blocks shared by the auth flow, the MFA dialog and the Security tab. */
import { useEffect, useId, useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CircleExclamationPoint, Eye, EyeOff, Lock, RefreshCw } from 'lucide-react'
import clsx from 'clsx'
import { passwordStrength } from '../../lib/auth'
import { instant, spring } from '../../lib/motion'

const STRENGTH_COLORS = ['bg-red-500', 'bg-red-500', 'bg-amber-500', 'bg-lime-500', 'bg-emerald-500']
const STRENGTH_TEXT = ['text-red-600 dark:text-red-400', 'text-red-600 dark:text-red-400', 'text-amber-700 dark:text-amber-300', 'text-lime-700 dark:text-lime-300', 'text-emerald-700 dark:text-emerald-300']


interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  icon?: ReactNode
  error?: string | null
  hint?: ReactNode
  /** Right side of the label row. */
  aside?: ReactNode
}

/** Labelled input with a leading icon and an error line. */
export function TextField({ label, value, onChange, icon, error, hint, aside, className, id: idProp, ...rest }: FieldProps) {
  const auto = useId()
  const id = idProp ?? auto
  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        {icon && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-2 [&_svg]:size-4">{icon}</span>}
        <input id={id} className={clsx('field h-11', icon && 'pl-9')} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error || hint ? `${id}-help` : undefined} {...rest} />
      </div>
      {(error || hint) && (
        <p id={`${id}-help`} className={clsx('mt-1.5 text-xs', error ? 'text-red-600 dark:text-red-400' : 'text-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

interface PasswordFieldProps {
  label?: ReactNode
  value: string
  onChange: (v: string) => void
  /** Show the strength meter (new passwords). */
  meter?: boolean
  autoComplete: 'current-password' | 'new-password'
  error?: string | null
  hint?: ReactNode
  aside?: ReactNode
  placeholder?: string
  autoFocus?: boolean
}

export function PasswordField({ label = 'Password', value, onChange, meter, autoComplete, error, hint, aside, placeholder, autoFocus }: PasswordFieldProps) {
  const id = useId()
  const reduce = useReducedMotion()
  const [show, setShow] = useState(false)
  const strength = useMemo(() => passwordStrength(value), [value])
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {meter && strength.label ? <span className={clsx('text-xs font-medium', STRENGTH_TEXT[strength.score])}>{strength.label}</span> : aside}
      </div>
      <div className="relative">
        <Lock size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-2" aria-hidden="true" />
        <input
          id={id}
          type={show ? 'text' : 'password'}
          className="field h-11 pr-11 pl-9"
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          placeholder={placeholder ?? (autoComplete === 'new-password' ? 'At least 8 characters' : '••••••••')}
          data-autofocus={autoFocus ? true : undefined}
          autoFocus={autoFocus}
        />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-2 text-muted-2 transition hover:bg-surface-2 hover:text-fg" aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {meter && (
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className="h-1 overflow-hidden rounded-full bg-surface-3">
              <motion.span className={clsx('block h-full rounded-full', STRENGTH_COLORS[strength.score])} initial={false} animate={{ width: value && strength.score >= i ? '100%' : value && i === 1 ? '35%' : '0%' }} transition={reduce ? instant : spring} />
            </span>
          ))}
        </div>
      )}
      <p id={`${id}-help`} className={clsx('mt-1.5 text-xs', error ? 'text-red-600 dark:text-red-400' : 'text-muted', !error && !hint && 'sr-only')}>
        {error ?? hint ?? ''}
      </p>
    </div>
  )
}

/** Animated inline error banner. */
export function ErrorNote({ error, children }: { error: string | null; children?: ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {error && (
        <motion.div key={error} role="alert" initial={reduce ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
          <CircleExclamationPoint size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {error}
            {children}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** "Resend code" with a cooldown countdown. `startedAt` resets the timer (e.g. Date.now() after sending). */
export function ResendButton({ onResend, startedAt, cooldown = 60, className }: { onResend: () => Promise<void>; startedAt: number | null; cooldown?: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const left = startedAt ? Math.max(0, cooldown - Math.floor((now - startedAt) / 1000)) : 0
  useEffect(() => {
    if (!left) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [left, startedAt])
  return (
    <button
      type="button"
      disabled={left > 0 || busy}
      onClick={async () => {
        setBusy(true)
        try {
          await onResend()
          setNow(Date.now())
        } finally {
          setBusy(false)
        }
      }}
      className={clsx('inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand-700 transition hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline dark:text-brand-300 dark:disabled:text-muted', className)}
    >
      <RefreshCw size={13} className={clsx(busy && 'animate-spin')} aria-hidden="true" />
      {left > 0 ? (
        <span>
          Resend code in <span className="tabular">0:{String(left).padStart(2, '0')}</span>
        </span>
      ) : (
        'Resend code'
      )}
    </button>
  )
}

/** Big round icon for step headers. */
export function StepIcon({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'success' }) {
  return (
    <span
      className={clsx(
        'relative grid size-14 place-items-center rounded-2xl text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_12px_28px_-12px_var(--glow)] [&_svg]:size-7',
        tone === 'success' ? 'bg-linear-to-br from-emerald-400 to-emerald-600 [--glow:var(--color-emerald-500)]' : 'bg-linear-to-br from-brand-500 via-brand-600 to-cat-organize-600 [--glow:var(--color-brand-500)]',
      )}
      aria-hidden="true"
    >
      {children}
      <span className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
    </span>
  )
}
