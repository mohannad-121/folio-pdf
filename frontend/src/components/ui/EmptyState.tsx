import type { ReactNode } from 'react'
import clsx from 'clsx'

export interface EmptyStateProps {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}

export default function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div className={clsx('flex flex-col items-center text-center', compact ? 'gap-2 py-6' : 'gap-3 py-12', className)}>
      {icon && <span className={clsx('grid place-items-center rounded-2xl bg-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_10%,var(--color-surface-2))] text-[var(--accent,var(--color-brand-500))] ring-1 ring-inset ring-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_22%,var(--color-border))]', compact ? 'size-10 [&_svg]:size-5' : 'size-14 [&_svg]:size-7')}>{icon}</span>}
      <div>
        <h3 className={clsx('font-semibold tracking-tight', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {description && <p className={clsx('mx-auto mt-1 max-w-sm text-muted', compact ? 'text-xs' : 'text-sm')}>{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
