import clsx from 'clsx'

export interface SkeletonProps {
  className?: string
  /** Circle vs. rounded rectangle. */
  round?: boolean
}

/** Shimmering placeholder. Size it with className (e.g. `h-4 w-32`). */
export default function Skeleton({ className, round }: SkeletonProps) {
  return <span aria-hidden="true" className={clsx('skeleton block', round ? 'rounded-full' : 'rounded-md', className)} />
}
