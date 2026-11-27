import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export type CardTone = 'default' | 'wash' | 'wash-strong' | 'glass' | 'inverted'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  /** Add hover lift + accent glow (for clickable cards). */
  interactive?: boolean
  padding?: 'none' | 'sm' | 'md' | 'lg' | 'xl'
  as?: 'div' | 'section' | 'article' | 'li' | 'aside'
  /**
   * Surface treatment. `wash` adds a soft gradient in the accent color (set `accent`
   * or an inline `--accent`), `wash-strong` is for featured / highlighted cards,
   * `inverted` is a dark ink card (good for a "Pro" pricing tier).
   */
  tone?: CardTone
  /** 1px gradient border in the accent color (featured / "most popular" look). */
  highlight?: boolean
  /** Accent CSS color for washes/glow, e.g. categoryAccent(cat).cssVar or 'var(--color-brand-500)'. */
  accent?: string
  /** Small label pinned to the top edge (e.g. "Most popular"). */
  ribbon?: ReactNode
}

const pad = { none: '', sm: 'p-3', md: 'p-5', lg: 'p-6 sm:p-8', xl: 'p-8 sm:p-10' }

export const cardBase = 'relative rounded-2xl border border-border bg-surface shadow-card'

const tones: Record<CardTone, string> = {
  default: '',
  wash: 'card-wash',
  'wash-strong': 'card-wash-strong',
  glass: 'glass',
  inverted: 'border-transparent bg-[linear-gradient(160deg,#131a33,#0a0d1c)] text-white shadow-lift [--color-border:rgb(255_255_255/0.1)] [--color-muted:rgb(255_255_255/0.7)] [--color-surface-2:rgb(255_255_255/0.06)]',
}

export default function Card({ interactive, padding = 'md', as = 'div', tone = 'default', highlight, accent, ribbon, className, style, children, ...rest }: CardProps) {
  const Tag = as as 'div'
  const st = accent ? ({ ...(style ?? {}), '--accent': accent } as CSSProperties) : style
  return (
    <Tag
      className={clsx(
        cardBase,
        tones[tone],
        pad[padding],
        highlight && 'ring-gradient shadow-glow',
        interactive && 'transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-1 hover:border-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_45%,var(--color-border))] hover:shadow-glow',
        className,
      )}
      style={st}
      {...rest}
    >
      {ribbon && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-linear-to-r from-[var(--accent,var(--color-brand-500))] to-[color-mix(in_oklab,var(--accent,var(--color-brand-500))_60%,var(--color-cat-review-500))] px-3 py-1 text-[11px] font-semibold tracking-wide text-white uppercase shadow-glow">
          {ribbon}
        </span>
      )}
      {children}
    </Tag>
  )
}

export function CardHeader({ title, description, action, icon, eyebrow, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; icon?: ReactNode; eyebrow?: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-4 flex items-start gap-3', className)}>
      {icon && <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">{icon}</span>}
      <div className="min-w-0 flex-1">
        {eyebrow && <div className="text-eyebrow mb-1 text-[var(--accent,var(--color-brand-600))]">{eyebrow}</div>}
        <h3 className="text-title text-base">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}
