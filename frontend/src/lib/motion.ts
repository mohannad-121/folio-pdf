/**
 * Shared motion presets (motion/react). Durations stay in the 120–300ms band;
 * springs are gentle. Components call `useReducedMotion()` and swap to `instant`.
 */
import type { Transition, Variants } from 'motion/react'

export const ease = [0.22, 1, 0.36, 1] as const

export const dur = {
  fast: 0.12,
  base: 0.18,
  slow: 0.26,
} as const

export const tween: Transition = { duration: dur.base, ease }
export const tweenSlow: Transition = { duration: dur.slow, ease }
export const spring: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }
export const springSoft: Transition = { type: 'spring', stiffness: 260, damping: 28 }
export const instant: Transition = { duration: 0 }

/** Page / route transition: fade + 8px slide. */
export const page: Variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: tweenSlow },
  exit: { opacity: 0, y: -6, transition: { duration: dur.fast, ease } },
}

/** Step transition inside the tool page (upload → options → results). */
export const step: Variants = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: tweenSlow },
  exit: { opacity: 0, x: -24, transition: { duration: dur.fast, ease } },
}

/** Fade + scale for cards, toasts, popovers. */
export const pop: Variants = {
  initial: { opacity: 0, scale: 0.96, y: 6 },
  animate: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: dur.fast } },
}

export const fade: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: tween },
  exit: { opacity: 0, transition: { duration: dur.fast } },
}

/** Staggered list container + item. */
export const staggerContainer = (stagger = 0.04, delay = 0): Variants => ({
  initial: {},
  animate: { transition: { staggerChildren: stagger, delayChildren: delay } },
})

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: dur.slow, ease } },
}

/** Slide-in from the right (toasts). */
export const slideInRight: Variants = {
  initial: { opacity: 0, x: 24, scale: 0.98 },
  animate: { opacity: 1, x: 0, scale: 1, transition: spring },
  exit: { opacity: 0, x: 16, scale: 0.98, transition: { duration: dur.fast } },
}

/** Slide-down (mobile menu, dropdowns). */
export const slideDown: Variants = {
  initial: { opacity: 0, y: -8, height: 0 },
  animate: { opacity: 1, y: 0, height: 'auto', transition: tween },
  exit: { opacity: 0, y: -6, height: 0, transition: { duration: dur.fast } },
}
