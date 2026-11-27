import { useId, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import clsx from 'clsx'
import { spring, instant } from '../../lib/motion'

export interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  id?: string
  size?: 'sm' | 'md'
  className?: string
}

/** Accessible toggle with a sliding knob. Uses --accent (defaults to brand). */
export default function Switch({ checked, onChange, label, description, disabled, id: idProp, size = 'md', className }: SwitchProps) {
  const auto = useId()
  const id = idProp ?? auto
  const reduce = useReducedMotion()
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'
  const knob = size === 'sm' ? 'size-4' : 'size-5'

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50',
        track,
        checked ? 'bg-[var(--accent,var(--color-brand-600))] shadow-[inset_0_1px_2px_rgb(0_0_0/0.15)]' : 'bg-surface-3 shadow-[inset_0_1px_2px_rgb(0_0_0/0.08)] dark:bg-border-strong',
      )}
    >
      <motion.span
        aria-hidden="true"
        layout
        transition={reduce ? instant : spring}
        className={clsx('block rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)]', knob, checked && 'ml-auto')}
      />
    </button>
  )

  if (!label) return control
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      {control}
      <label htmlFor={id} className={clsx('cursor-pointer select-none', disabled && 'opacity-60')}>
        <span className="block text-sm font-medium leading-6">{label}</span>
        {description && <span className="block text-xs text-muted">{description}</span>}
      </label>
    </div>
  )
}
