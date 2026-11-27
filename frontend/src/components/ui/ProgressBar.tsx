import { motion, useReducedMotion } from 'motion/react'
import clsx from 'clsx'
import { instant, springSoft } from '../../lib/motion'

export interface ProgressBarProps {
  /** 0..1, or null for indeterminate. */
  value: number | null
  size?: 'xs' | 'sm' | 'md'
  /** Bar color class; defaults to the --accent var (brand). */
  barClassName?: string
  className?: string
  label?: string
  /** Show the percent text to the right. */
  showValue?: boolean
}

const heights = { xs: 'h-1', sm: 'h-1.5', md: 'h-2.5' }

export default function ProgressBar({ value, size = 'sm', barClassName, className, label, showValue }: ProgressBarProps) {
  const reduce = useReducedMotion()
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className={clsx('flex items-center gap-3', className)}>
      <div
        className={clsx('relative w-full flex-1 overflow-hidden rounded-full bg-surface-3', heights[size])}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={pct === null ? 'Working' : `${pct}%`}
      >
        {pct === null ? (
          <span className={clsx('absolute inset-y-0 left-0 w-1/4 animate-indeterminate rounded-full bg-[var(--accent,var(--color-brand-500))]', barClassName)} />
        ) : (
          <motion.span
            className={clsx('absolute inset-y-0 left-0 rounded-full bg-[var(--accent,var(--color-brand-500))]', barClassName)}
            initial={false}
            animate={{ width: `${Math.max(2, pct)}%` }}
            transition={reduce ? instant : springSoft}
          >
            <span className="absolute inset-0 rounded-full bg-linear-to-r from-transparent via-white/25 to-transparent" aria-hidden="true" />
          </motion.span>
        )}
      </div>
      {showValue && pct !== null && <span className="w-10 shrink-0 text-right text-xs text-muted tabular">{pct}%</span>}
    </div>
  )
}
