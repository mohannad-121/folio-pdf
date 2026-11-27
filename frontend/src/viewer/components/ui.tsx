import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'

export function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
  className,
  shortcut,
  primary,
  danger,
  tipSide = 'bottom',
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
  children: ReactNode
  className?: string
  shortcut?: string
  primary?: boolean
  danger?: boolean
  tipSide?: 'bottom' | 'top' | 'right' | 'left'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-tip={shortcut ? `${label} (${shortcut})` : label}
      data-tip-side={tipSide}
      className={clsx(
        'v-tip relative grid h-8 w-8 shrink-0 place-items-center rounded-md transition',
        disabled && 'cursor-not-allowed opacity-40',
        !disabled && !active && !primary && 'text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-white',
        active && 'bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200',
        primary && 'bg-brand-600 text-white hover:bg-brand-700',
        danger && 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-neutral-200 dark:bg-neutral-700" aria-hidden />
}

export function ColorSwatches({ colors, value, onChange, allowCustom = true, size = 'md' }: { colors: string[]; value: string; onChange: (c: string) => void; allowCustom?: boolean; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <div className="flex items-center gap-1">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          className={clsx(sz, 'rounded-full border transition hover:scale-110', value.toLowerCase() === c.toLowerCase() ? 'border-neutral-900 ring-2 ring-brand-500 ring-offset-1 dark:border-white dark:ring-offset-neutral-900' : 'border-neutral-300 dark:border-neutral-600')}
          style={{ background: c }}
        />
      ))}
      {allowCustom && (
        <label className={clsx(sz, 'relative cursor-pointer overflow-hidden rounded-full border border-neutral-300 dark:border-neutral-600')} title="Custom color" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
        </label>
      )}
    </div>
  )
}

export function Field({ label, children, inline }: { label: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={clsx('text-xs text-neutral-600 dark:text-neutral-400', inline ? 'flex items-center justify-between gap-2' : 'flex flex-col gap-1')}>
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100'

export const btnCls = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700'
export const btnPrimaryCls = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50'
export const btnDangerCls = 'inline-flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50'

export function Dialog({ title, onClose, children, width = 'max-w-lg', footer }: { title: string; onClose: () => void; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={clsx('flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900', width)}>
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-4 py-3 dark:border-neutral-700">{footer}</div>}
      </div>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-700 select-none dark:text-neutral-300">
      <span role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={clsx('relative h-4 w-7 rounded-full transition', checked ? 'bg-brand-600' : 'bg-neutral-300 dark:bg-neutral-600')}>
        <span className={clsx('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition', checked ? 'left-3.5' : 'left-0.5')} />
      </span>
      {label}
    </label>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-brand-600 dark:border-neutral-600 dark:border-t-brand-400', className)} aria-label="Loading" />
}
