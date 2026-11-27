import { Monitor, Moon, Sun } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import clsx from 'clsx'
import { useTheme, type ThemePref } from '../lib/theme'
import { instant, spring } from '../lib/motion'
import { Tooltip } from './ui'

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

/** Light / dark / system switch. `compact` renders a single cycling button. */
export default function ThemeToggle({ compact, className }: { compact?: boolean; className?: string }) {
  const pref = useTheme((s) => s.pref)
  const setPref = useTheme((s) => s.setPref)
  const cycle = useTheme((s) => s.cycle)
  const reduce = useReducedMotion()

  if (compact) {
    const cur = OPTIONS.find((o) => o.value === pref) ?? OPTIONS[2]
    return (
      <Tooltip label={`Theme: ${cur.label}`} side="bottom">
        <button
          type="button"
          onClick={cycle}
          aria-label={`Theme: ${cur.label}. Click to change.`}
          className={clsx('grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg', className)}
        >
          <motion.span key={pref} initial={reduce ? false : { rotate: -90, opacity: 0, scale: 0.6 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} transition={reduce ? instant : spring} className="grid place-items-center">
            <cur.Icon size={17} />
          </motion.span>
        </button>
      </Tooltip>
    )
  }

  return (
    <div role="radiogroup" aria-label="Theme" className={clsx('inline-flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5 ring-1 ring-inset ring-border', className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = value === pref
        return (
          <Tooltip key={value} label={label} side="bottom">
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              onClick={() => setPref(value)}
              className={clsx('relative grid size-7 place-items-center rounded-full transition-colors', active ? 'text-fg' : 'text-muted-2 hover:text-fg')}
            >
              {active && <motion.span layoutId="theme-thumb" transition={reduce ? instant : spring} className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.12),0_0_0_1px_var(--color-border)] dark:bg-surface-3" aria-hidden="true" />}
              <Icon size={14} className="relative" />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
