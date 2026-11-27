import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useOutlet } from 'react-router-dom'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { Code2 as Github, Menu, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { useThemeEffect } from '../lib/theme'
import { instant, page, slideDown, spring } from '../lib/motion'
import ThemeToggle from './ThemeToggle'
import CommandPalette, { useCommandPalette } from './CommandPalette'
import { Kbd, Toaster, modKey } from './ui'

const GITHUB_URL = 'https://github.com/mohannad-121/folio-pdf'
const VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.1.0'

const NAV: { to: string; label: string }[] = [
  { to: '/', label: 'All tools' },
  { to: '/tools/merge', label: 'Merge' },
  { to: '/tools/compress', label: 'Compress' },
  { to: '/tools/pdf-to-word', label: 'Convert' },
  { to: '/tools/edit', label: 'Edit' },
  { to: '/tools/sign', label: 'Sign' },
]

export default function Layout() {
  useThemeEffect()
  const { pathname } = useLocation()
  const outlet = useOutlet()
  const reduce = useReducedMotion()
  const isViewer = pathname.startsWith('/view')
  const [menu, setMenu] = useState(false)
  const togglePalette = useCommandPalette((s) => s.toggle)
  const openPalette = useCommandPalette((s) => s.setOpen)

  // ⌘K / Ctrl+K opens the palette anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        togglePalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette])

  return (
    <div className="flex h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-md focus:bg-brand-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white">
        Skip to content
      </a>
      <header className="glass sticky top-0 z-40 border-b border-border/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:gap-6">
          <Link to="/" className="group flex items-center gap-2.5 rounded-md font-semibold tracking-tight">
            <BrandMark />
            <span>
              Folio<span className="text-muted-2 transition-colors group-hover:text-brand-500"> PDF</span>
            </span>
          </Link>

          <LayoutGroup id="main-nav">
            <nav className="hidden items-center gap-0.5 text-sm md:flex" aria-label="Primary">
              {NAV.map((n) => (
                <NavItem key={n.to} to={n.to} label={n.label} reduce={!!reduce} />
              ))}
            </nav>
          </LayoutGroup>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => openPalette(true)}
              className="hidden h-9 items-center gap-2 rounded-lg border border-border bg-surface/60 pr-1.5 pl-3 text-sm text-muted shadow-[0_1px_2px_rgb(15_23_42/0.04)] transition hover:border-border-strong hover:bg-surface hover:text-fg sm:inline-flex"
              aria-label="Search tools"
            >
              <Search size={15} aria-hidden="true" />
              <span className="hidden lg:inline">Search tools</span>
              <span className="ml-1 inline-flex items-center gap-0.5">
                <Kbd>{modKey()}</Kbd>
                <Kbd>K</Kbd>
              </span>
            </button>
            <button type="button" onClick={() => openPalette(true)} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg sm:hidden" aria-label="Search tools">
              <Search size={18} />
            </button>
            <ThemeToggle className="hidden sm:inline-flex" />
            <ThemeToggle compact className="sm:hidden" />
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="hidden size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg sm:grid" aria-label="GitHub repository">
              <Github size={18} />
            </a>
            <button type="button" onClick={() => setMenu((m) => !m)} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg md:hidden" aria-label={menu ? 'Close menu' : 'Open menu'} aria-expanded={menu} aria-controls="mobile-menu">
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        <AnimatePresence initial={false}>
          {menu && (
            <motion.nav id="mobile-menu" aria-label="Primary" variants={reduce ? undefined : slideDown} initial="initial" animate="animate" exit="exit" className="overflow-hidden border-t border-border md:hidden">
              <ul className="mx-auto max-w-7xl space-y-0.5 px-3 py-3">
                {NAV.map((n) => (
                  <li key={n.to}>
                    <NavLink to={n.to} end={n.to === '/'} onClick={() => setMenu(false)} className={({ isActive }) => clsx('block rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                      {n.label}
                    </NavLink>
                  </li>
                ))}
                <li className="pt-2">
                  <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg">
                    <Github size={16} /> GitHub
                  </a>
                </li>
              </ul>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <main id="main" className={clsx('flex-1', isViewer ? 'flex min-h-0 flex-col overflow-hidden' : 'overflow-x-clip')}>
        {isViewer ? (
          outlet
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={pathname} variants={reduce ? undefined : page} initial="initial" animate="animate" exit="exit" className="min-h-full">
              {outlet}
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      {!isViewer && (
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-muted sm:flex-row">
            <div className="flex items-center gap-2">
              <BrandMark size="sm" />
              <span>
                Folio PDF <span className="text-muted-2">v{VERSION}</span> — open source, self-hosted. Your files never leave your server.
              </span>
            </div>
            <div className="flex items-center gap-4">
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition hover:text-fg">
                <Github size={14} /> GitHub
              </a>
              <a href={`${GITHUB_URL}#readme`} target="_blank" rel="noreferrer" className="transition hover:text-fg">
                Docs
              </a>
            </div>
          </div>
        </footer>
      )}

      <CommandPalette />
      <Toaster />
    </div>
  )
}

/** Gradient brand tile. */
export function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'size-5 rounded-[6px]' : size === 'lg' ? 'size-12 rounded-2xl' : 'size-8 rounded-lg'
  return (
    <span className={clsx('relative grid shrink-0 place-items-center overflow-hidden bg-linear-to-br from-brand-500 via-brand-600 to-cat-organize-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_2px_6px_-1px_rgb(52_67_245/0.5)]', s)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={size === 'sm' ? 'size-3' : size === 'lg' ? 'size-7' : 'size-[18px]'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
        <path d="M10 13h6M10 17h4" />
      </svg>
      <span className="pointer-events-none absolute -top-1/2 left-0 h-full w-full rotate-12 bg-white/10" />
    </span>
  )
}

function NavItem({ to, label, reduce }: { to: string; label: string; reduce: boolean }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => clsx('relative rounded-md px-3 py-1.5 font-medium transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-fg')}>
      {({ isActive }) => (
        <>
          {label}
          {isActive && <motion.span layoutId="nav-underline" transition={reduce ? instant : spring} className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-linear-to-r from-brand-500 to-cat-organize-500" aria-hidden="true" />}
        </>
      )}
    </NavLink>
  )
}
