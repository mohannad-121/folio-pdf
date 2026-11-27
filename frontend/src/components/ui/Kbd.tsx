import type { HTMLAttributes } from 'react'
import clsx from 'clsx'

/** Keyboard key chip. */
export default function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={clsx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border-strong bg-surface px-1.5 font-sans text-[11px] font-medium text-muted shadow-[0_1px_0_var(--color-border-strong)] dark:bg-surface-3',
        className,
      )}
      {...rest}
    />
  )
}

/** "⌘" on Apple platforms, "Ctrl" elsewhere. */
export function modKey(): string {
  if (typeof navigator === 'undefined') return 'Ctrl'
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'
}
