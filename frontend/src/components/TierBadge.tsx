import { Crown, Feather, Lock, Sparkles, Zap, type LucideProps } from 'lucide-react'
import clsx from 'clsx'
import { TIER_META, type Tier } from '../lib/plans'


const ICONS = { free: Feather, plus: Zap, pro: Sparkles, max: Crown } satisfies Record<Tier, React.ComponentType<LucideProps>>

export function TierIcon({ tier, ...props }: { tier: Tier } & LucideProps) {
  const Icon = ICONS[tier]
  return <Icon aria-hidden="true" {...props} />
}

export interface TierBadgeProps {
  tier: Tier
  /** Show a lock icon (the user is below this tier). */
  locked?: boolean
  size?: 'xs' | 'sm' | 'md'
  className?: string
  /** Visually hidden suffix for screen readers. */
  srLabel?: string
}

/** Small tier pill: "🔒 Pro" in the tier's color. */
export default function TierBadge({ tier, locked, size = 'sm', className, srLabel }: TierBadgeProps) {
  const m = TIER_META[tier]
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1 rounded-full font-semibold whitespace-nowrap',
        size === 'xs' ? 'px-1.5 py-px text-[10px] leading-4 [&_svg]:size-2.5' : size === 'sm' ? 'px-2 py-0.5 text-[11px] leading-4 [&_svg]:size-3' : 'px-2.5 py-1 text-xs [&_svg]:size-3.5',
        m.chip,
        className,
      )}
    >
      {locked ? <Lock aria-hidden="true" strokeWidth={2.5} /> : <TierIcon tier={tier} strokeWidth={2.5} />}
      {m.name}
      {srLabel && <span className="sr-only"> {srLabel}</span>}
    </span>
  )
}
