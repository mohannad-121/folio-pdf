import type { ReactNode } from 'react'
import clsx from 'clsx'

export interface TooltipProps {
  label: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

const sides = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2 origin-bottom',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2 origin-top',
  left: 'right-full top-1/2 mr-2 -translate-y-1/2 origin-right',
  right: 'left-full top-1/2 ml-2 -translate-y-1/2 origin-left',
}

/**
 * CSS-only tooltip: shows on hover and keyboard focus of the wrapped element.
 * Keep `children` a single focusable element for keyboard users.
 */
export default function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  return (
    <span className={clsx('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={clsx(
          'pointer-events-none absolute z-50 scale-95 rounded-md bg-neutral-900 px-2 py-1 text-xs font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition duration-150 ease-out',
          'group-hover/tt:scale-100 group-hover/tt:opacity-100 group-focus-within/tt:scale-100 group-focus-within/tt:opacity-100 dark:bg-neutral-100 dark:text-neutral-900',
          sides[side],
        )}
      >
        {label}
      </span>
    </span>
  )
}
