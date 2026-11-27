import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CreditCard, LogOut, Sparkles, Timer, User as UserIcon } from 'lucide-react'
import clsx from 'clsx'
import { daysUntil, initials, useAuth } from '../lib/auth'
import { getPlanTier, TIER_META } from '../lib/plans'
import { useCheckout } from '../lib/paddle'
import { pop } from '../lib/motion'
import { Skeleton, toast } from './ui'
import TierBadge from './TierBadge'

/** Gradient initials avatar. */
export function Avatar({ name, email, size = 'md', className }: { name?: string | null; email: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  // Stable hue per email so avatars differ between accounts.
  let h = 0
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) % 360
  return (
    <span
      className={clsx('grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3)] ring-2 ring-surface', size === 'sm' ? 'size-7 text-[11px]' : size === 'lg' ? 'size-16 text-xl' : 'size-8 text-xs', className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.19 ${h}), oklch(0.5 0.2 ${(h + 60) % 360}))` }}
      aria-hidden="true"
    >
      {initials({ name: name ?? null, email })}
    </span>
  )
}

/** Header right side: Upgrade / trial pill / Sign in / avatar menu. */
export default function UserMenu() {
  const me = useAuth((s) => s.me)
  const loading = useAuth((s) => s.loading)
  const openAuth = useCheckout((s) => s.openAuth)

  if (loading) return <Skeleton className="h-8 w-20 rounded-lg" />
  if (!me) return null
  const billing = me.billing_enabled
  const user = me.user

  // Self-hosted edition: no account nags at all (but keep a signed-in user's menu).
  if (!billing && !user) return null

  const trialDays = me.plan_status === 'trialing' ? daysUntil(me.trial_ends_at) : null
  const plan = getPlanTier(me.plan)

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      {billing && trialDays != null && (
        <Link
          to="/account?tab=billing"
          className="hidden items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--color-brand-500)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--color-surface))] px-2.5 py-1 text-xs font-medium text-brand-700 transition hover:shadow-glow lg:inline-flex dark:text-brand-200"
        >
          <Timer size={13} aria-hidden="true" />
          {plan.name} trial · <span className="tabular">{trialDays}</span> day{trialDays === 1 ? '' : 's'} left
        </Link>
      )}
      {billing && me.plan === 'free' && (
        <Link
          to="/pricing"
          className="group relative hidden h-8 items-center gap-1.5 overflow-hidden rounded-lg bg-linear-to-r from-brand-600 via-cat-organize-600 to-cat-review-600 px-3 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_16px_-8px_var(--color-brand-500)] transition hover:brightness-110 sm:inline-flex"
        >
          <Sparkles size={14} aria-hidden="true" className="transition-transform duration-300 group-hover:rotate-12" />
          Upgrade
          <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 skew-x-[-20deg] bg-white/25 opacity-0 transition-[left,opacity] duration-700 group-hover:left-[120%] group-hover:opacity-100" aria-hidden="true" />
        </Link>
      )}
      {user ? (
        <AccountMenu />
      ) : (
        <button type="button" onClick={() => openAuth('signin')} className="h-8 rounded-lg px-3 text-sm font-medium text-fg transition hover:bg-surface-2">
          Sign in
        </button>
      )}
    </div>
  )
}

function AccountMenu() {
  const me = useAuth((s) => s.me)!
  const logout = useAuth((s) => s.logout)
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const user = me.user!

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // Focus the first item.
    window.setTimeout(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 10)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  const go = (to: string) => {
    setOpen(false)
    navigate(to)
  }

  const itemCls = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-fg transition hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none'

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" className="flex items-center rounded-full transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2">
        <Avatar name={user.name} email={user.email} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Account"
            onKeyDown={onMenuKey}
            variants={reduce ? undefined : pop}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute top-full right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border border-border bg-surface p-1.5 shadow-lift ring-1 ring-black/5 dark:ring-white/5"
          >
            <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
              <Avatar name={user.name} email={user.email} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{user.name || user.email.split('@')[0]}</div>
                <div className="truncate text-xs text-muted">{user.email}</div>
              </div>
            </div>
            {me.billing_enabled && (
              <div className="mx-1 mb-1.5 flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-2 text-xs">
                <span className="text-muted">Plan</span>
                <span className="flex items-center gap-1.5">
                  <TierBadge tier={me.plan} size="xs" />
                  {me.plan_status === 'trialing' && <span className="text-muted">trial</span>}
                </span>
              </div>
            )}
            <div className="border-t border-border pt-1.5">
              <button type="button" role="menuitem" className={itemCls} onClick={() => go('/account')}>
                <UserIcon size={16} className="text-muted" aria-hidden="true" /> Account
              </button>
              {me.billing_enabled && (
                <button type="button" role="menuitem" className={itemCls} onClick={() => go('/account?tab=billing')}>
                  <CreditCard size={16} className="text-muted" aria-hidden="true" /> Billing
                </button>
              )}
              {me.billing_enabled && me.plan !== 'max' && (
                <button type="button" role="menuitem" className={clsx(itemCls, TIER_META.pro.text, 'font-medium')} onClick={() => go('/pricing')}>
                  <Sparkles size={16} aria-hidden="true" /> {me.plan === 'free' ? 'Upgrade' : 'Change plan'}
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={itemCls}
                onClick={async () => {
                  setOpen(false)
                  await logout()
                  toast.info('Signed out')
                  navigate('/')
                }}
              >
                <LogOut size={16} className="text-muted" aria-hidden="true" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
