import { useId, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import clsx from 'clsx'
import { spring, instant } from '../../lib/motion'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedProps<T extends string> {
  value: T
  onChange: (v: T) => void
  options: SegmentedOption<T>[]
  size?: 'sm' | 'md'
  /** Stretch segments to fill the row. */
  block?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
}

/** Segmented control (radiogroup) with a sliding, layout-animated thumb. */
export default function Segmented<T extends string>({ value, onChange, options, size = 'md', block, className, ...aria }: SegmentedProps<T>) {
  const group = useId()
  const reduce = useReducedMotion()
  const idx = options.findIndex((o) => o.value === value)

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const enabled = options.filter((o) => !o.disabled)
    const cur = enabled.findIndex((o) => o.value === value)
    let next = cur
    if (e.key === 'ArrowRight') next = (cur + 1) % enabled.length
    if (e.key === 'ArrowLeft') next = (cur - 1 + enabled.length) % enabled.length
    if (e.key === 'Home') next = 0
    if (e.key === 'End') next = enabled.length - 1
    onChange(enabled[next].value)
  }

  return (
    <div
      role="radiogroup"
      onKeyDown={onKey}
      className={clsx('inline-flex rounded-xl bg-surface-2 p-1 ring-1 ring-inset ring-border', block ? 'flex w-full' : 'max-w-full overflow-x-auto', className)}
      {...aria}
    >
      {options.map((o, i) => {
        const active = i === idx
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={clsx(
              'relative z-0 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:opacity-40',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              block && 'flex-1',
              active ? 'text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId={`${group}-thumb`}
                transition={reduce ? instant : spring}
                className="absolute inset-0 -z-10 rounded-lg bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.1),0_0_0_1px_var(--color-border)] dark:bg-surface-3"
                aria-hidden="true"
              />
            )}
            {o.icon}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
