import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { ArrowLeft, Search } from 'lucide-react'
import { useCommandPalette } from '../components/CommandPalette'
import clsx from 'clsx'
import { Button, buttonBase, buttonSizes, buttonVariants } from '../components/ui'

export default function NotFound() {
  const reduce = useReducedMotion()
  const openPalette = useCommandPalette((s) => s.setOpen)
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-20 text-center sm:py-28">
      <LostPages animate={!reduce} />
      <p className="mt-8 text-xs font-semibold tracking-[0.2em] text-muted-2 uppercase">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">This page went missing</h1>
      <p className="mt-3 max-w-md text-muted text-pretty">That tool or page doesn't exist — maybe it was renamed, or a link lost a letter on the way here.</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/" className={clsx(buttonBase, buttonVariants.primary, buttonSizes.lg, 'btn-press')}>
          <ArrowLeft /> Back to all tools
        </Link>
        <Button size="lg" variant="secondary" leftIcon={<Search />} onClick={() => openPalette(true)}>
          Search tools
        </Button>
      </div>
    </div>
  )
}

/** Three drifting pages, one of them flying away. */
function LostPages({ animate }: { animate: boolean }) {
  const floatY = (delay: number, amp = 6) => (animate ? { y: [0, -amp, 0], transition: { duration: 4.5, delay, repeat: Infinity, ease: 'easeInOut' as const } } : undefined)
  return (
    <div className="relative h-44 w-56" aria-hidden="true">
      <div className="absolute inset-x-6 bottom-0 h-6 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--color-brand-500)_20%,transparent),transparent)] blur-md" />
      <motion.svg viewBox="0 0 120 150" className="absolute left-6 top-8 w-20 drop-shadow-lg" animate={floatY(0.6, 4)} style={{ rotate: -10 }}>
        <Page tone="var(--color-cat-organize-500)" />
      </motion.svg>
      <motion.svg viewBox="0 0 120 150" className="absolute left-16 top-2 w-24 drop-shadow-xl" animate={floatY(0)} style={{ rotate: 4 }}>
        <Page tone="var(--color-brand-500)" />
      </motion.svg>
      <motion.svg
        viewBox="0 0 120 150"
        className="absolute right-0 top-0 w-14 drop-shadow"
        initial={animate ? { x: 0, y: 0, rotate: 16, opacity: 1 } : false}
        animate={animate ? { x: [0, 24, 0], y: [0, -30, 0], rotate: [16, 40, 16], opacity: [1, 0.35, 1] } : undefined}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Page tone="var(--color-cat-review-500)" dashed />
      </motion.svg>
    </div>
  )
}

function Page({ tone, dashed }: { tone: string; dashed?: boolean }) {
  return (
    <g>
      <path d="M8 4h74l30 30v112H8z" fill="var(--color-surface)" stroke={tone} strokeWidth="4" strokeDasharray={dashed ? '8 6' : undefined} strokeLinejoin="round" />
      <path d="M82 4v30h30" fill="none" stroke={tone} strokeWidth="4" strokeLinejoin="round" />
      <rect x="24" y="58" width="60" height="6" rx="3" fill={tone} opacity="0.55" />
      <rect x="24" y="76" width="72" height="6" rx="3" fill={tone} opacity="0.35" />
      <rect x="24" y="94" width="48" height="6" rx="3" fill={tone} opacity="0.35" />
      <rect x="24" y="112" width="64" height="6" rx="3" fill={tone} opacity="0.2" />
    </g>
  )
}
