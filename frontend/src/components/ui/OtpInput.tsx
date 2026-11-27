import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import clsx from 'clsx'

export interface OtpInputProps {
  value: string
  onChange: (v: string) => void
  /** Fired once all boxes are filled (auto-submit). */
  onComplete?: (v: string) => void
  length?: number
  disabled?: boolean
  /** Truthy → red boxes + a shake. Change the value (e.g. a counter) to shake again. */
  error?: unknown
  autoFocus?: boolean
  'aria-label'?: string
  'aria-describedby'?: string
  className?: string
}

/**
 * One-time-code input: N single-digit boxes with auto-advance, whole-code paste, backspace /
 * arrow navigation and auto-submit. The first box carries `autocomplete="one-time-code"` so
 * iOS/Android can fill codes from SMS or email.
 */
export default function OtpInput({ value, onChange, onComplete, length = 6, disabled, error, autoFocus, className, ...aria }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const reduce = useReducedMotion()
  const controls = useAnimationControls()
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  const lastCompleted = useRef<string | null>(null)

  useEffect(() => {
    if (autoFocus) window.setTimeout(() => refs.current[Math.min(value.length, length - 1)]?.focus(), 30)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus once on mount
  }, [])

  useEffect(() => {
    if (!error || reduce) return
    void controls.start({ x: [0, -8, 8, -6, 6, -3, 0], transition: { duration: 0.4 } })
    // Clear and refocus so the next attempt starts fresh.
    lastCompleted.current = null
    refs.current[0]?.focus()
  }, [error, controls, reduce])

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length)
    onChange(clean)
    if (clean.length === length && clean !== lastCompleted.current) {
      lastCompleted.current = clean
      onComplete?.(clean)
    } else if (clean.length < length) lastCompleted.current = null
  }

  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus()

  const onInput = (i: number, raw: string) => {
    const typed = raw.replace(/\D/g, '')
    if (!typed) return
    if (typed.length > 1) {
      // Autofill / fast typing delivered several digits into one box.
      const next = (value.slice(0, i) + typed).slice(0, length)
      commit(next)
      focus(next.length)
      return
    }
    // The value is always contiguous: typing past the end appends, typing over a digit replaces it.
    const next = i < value.length ? value.slice(0, i) + typed + value.slice(i + 1) : value + typed
    commit(next)
    focus(Math.min(i < value.length ? i + 1 : next.length, length - 1))
  }

  const onKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (i < value.length) {
        commit(value.slice(0, i) + value.slice(i + 1))
      } else if (value.length > 0) {
        commit(value.slice(0, -1))
        focus(value.length - 1)
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(i + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focus(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focus(length - 1)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '')
    if (!text) return
    e.preventDefault()
    const next = text.slice(0, length)
    commit(next)
    focus(next.length >= length ? length - 1 : next.length)
  }

  return (
    <motion.div animate={controls} role="group" aria-label={aria['aria-label'] ?? 'Verification code'} className={clsx('flex justify-center gap-2 sm:gap-2.5', className)}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          value={d}
          onChange={(e) => onInput(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={i === 0 ? length : 1}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={aria['aria-describedby']}
          data-autofocus={i === 0 && autoFocus ? true : undefined}
          className={clsx(
            'tabular size-11 rounded-xl border bg-surface text-center font-mono text-xl font-semibold text-fg shadow-[0_1px_2px_rgb(15_23_42/0.06)] caret-brand-500 transition-[border-color,box-shadow,background-color] duration-150 outline-none sm:h-14 sm:w-12 sm:text-2xl',
            'focus:border-brand-500 focus:shadow-ring disabled:opacity-60',
            error ? 'border-red-400 bg-red-50/60 dark:border-red-500/60 dark:bg-red-500/10' : d ? 'border-border-strong' : 'border-border',
            i === Math.floor(length / 2) - 1 && 'mr-1.5 sm:mr-3',
          )}
        />
      ))}
    </motion.div>
  )
}
