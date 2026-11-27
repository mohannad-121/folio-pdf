/**
 * Theme (light / dark / system) + per-category accent helpers.
 *
 * The resolved theme is written to <html data-theme="light|dark">; Tailwind's
 * `dark:` variant follows that attribute (see @custom-variant in index.css).
 * index.html contains an inline copy of `resolve()` so the first paint is right.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ToolCategory } from './tools'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'folio.theme'

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  return pref === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : pref
}

function apply(resolved: ResolvedTheme) {
  const root = document.documentElement
  root.setAttribute('data-theme', resolved)
  root.style.colorScheme = resolved
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
  const color = resolved === 'dark' ? '#0a0a0f' : '#fafafa'
  if (meta) meta.content = color
  else {
    const m = document.createElement('meta')
    m.name = 'theme-color'
    m.content = color
    document.head.appendChild(m)
  }
}

interface ThemeState {
  pref: ThemePref
  resolved: ResolvedTheme
  setPref: (p: ThemePref) => void
  /** Cycle light → dark → system → light. */
  cycle: () => void
}

export const useTheme = create<ThemeState>()((set, get) => {
  const pref = readPref()
  return {
    pref,
    resolved: resolveTheme(pref),
    setPref: (p) => {
      try {
        localStorage.setItem(STORAGE_KEY, p)
      } catch {
        /* private mode */
      }
      const resolved = resolveTheme(p)
      apply(resolved)
      set({ pref: p, resolved })
    },
    cycle: () => {
      const order: ThemePref[] = ['light', 'dark', 'system']
      get().setPref(order[(order.indexOf(get().pref) + 1) % order.length])
    },
  }
})

/** Mount once (Layout): applies the theme and tracks OS changes while in "system". */
export function useThemeEffect() {
  const pref = useTheme((s) => s.pref)
  useEffect(() => {
    apply(resolveTheme(pref))
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      const resolved = resolveTheme('system')
      apply(resolved)
      useTheme.setState({ resolved })
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])
}

// ---------------------------------------------------------------------------
// Category accents
// ---------------------------------------------------------------------------

export interface Accent {
  /** Category id (also the token suffix: --color-cat-<id>-500). */
  id: ToolCategory
  /** Human hue name, for copy ("violet"). */
  hue: string
  /** CSS value for the 500 shade, e.g. `var(--color-cat-organize-500)`. Use as `--accent`. */
  cssVar: string
  /** Inline style setting `--accent`, spread onto an element so `shadow-glow`, `field:focus`, etc. pick it up. */
  style: Record<string, string>
  /** Gradient tile for icons: text-white on a 500→600 diagonal. */
  tile: string
  /** Softer tint tile (icon colored, bg tinted). */
  tint: string
  /** Text color (600 light / 400 dark). */
  text: string
  /** Solid bg (500). */
  bg: string
  /** Border / ring colors. */
  ring: string
  border: string
  /** Gradient classes for CTA buttons (from/to only). */
  gradient: string
  /** Chip: tinted pill with colored text. */
  chip: string
}

const HUES: Record<ToolCategory, string> = {
  organize: 'violet',
  edit: 'orange',
  'convert-from': 'emerald',
  'convert-to': 'sky',
  optimize: 'rose',
  security: 'red',
  'forms-sign': 'teal',
  review: 'fuchsia',
}

/** Editorial copy for category section headers (eyebrow + one-line blurb). */
export const CATEGORY_META: Record<ToolCategory, { eyebrow: string; blurb: string; icon: string }> = {
  organize: { eyebrow: 'Pages & structure', blurb: 'Merge, split, reorder and reshape documents without opening a desktop app.', icon: 'LayoutGrid' },
  edit: { eyebrow: 'Content & marks', blurb: 'Stamp, number, annotate and fix what is on the page — or open the full editor.', icon: 'PenTool' },
  'convert-from': { eyebrow: 'PDF → anything', blurb: 'Turn PDFs into editable Office files, images, HTML, text and archival PDF/A.', icon: 'FileOutput' },
  'convert-to': { eyebrow: 'Anything → PDF', blurb: 'Bring Word, Excel, PowerPoint, images, scans and web pages into clean PDFs.', icon: 'FileInput' },
  optimize: { eyebrow: 'Smaller & smarter', blurb: 'Compress, OCR, repair and flatten so files are lighter and searchable.', icon: 'Gauge' },
  security: { eyebrow: 'Lock it down', blurb: 'Passwords, permissions, redaction and sanitizing — processed on your own server.', icon: 'ShieldCheck' },
  'forms-sign': { eyebrow: 'Forms & signatures', blurb: 'Fill forms, draw or certify signatures, and verify who signed what.', icon: 'PenLine' },
  review: { eyebrow: 'Inspect & compare', blurb: 'Diff versions, audit accessibility, inspect internals and count words.', icon: 'GitCompare' },
}

const cache = new Map<ToolCategory, Accent>()

export function categoryAccent(cat: ToolCategory): Accent {
  let a = cache.get(cat)
  if (a) return a
  const c = `cat-${cat}`
  a = {
    id: cat,
    hue: HUES[cat],
    cssVar: `var(--color-${c}-500)`,
    style: { '--accent': `var(--color-${c}-500)` },
    tile: `bg-linear-to-br from-${c}-500 to-${c}-700 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]`,
    tint: `bg-${c}-100 text-${c}-700 dark:bg-${c}-500/15 dark:text-${c}-400`,
    text: `text-${c}-600 dark:text-${c}-400`,
    bg: `bg-${c}-500`,
    ring: `ring-${c}-500`,
    border: `border-${c}-500`,
    gradient: `from-${c}-500 to-${c}-700`,
    chip: `bg-${c}-100 text-${c}-700 dark:bg-${c}-500/15 dark:text-${c}-400`,
  }
  cache.set(cat, a)
  return a
}

/*
 * Tailwind scans source files for class names, so every category class bundle
 * above must appear literally somewhere. This string keeps them discoverable.
 */
export const _CATEGORY_CLASS_SAFELIST = [
  'from-cat-organize-500 to-cat-organize-700 bg-cat-organize-100 text-cat-organize-700 dark:bg-cat-organize-500/15 dark:text-cat-organize-400 text-cat-organize-600 bg-cat-organize-500 ring-cat-organize-500 border-cat-organize-500',
  'from-cat-edit-500 to-cat-edit-700 bg-cat-edit-100 text-cat-edit-700 dark:bg-cat-edit-500/15 dark:text-cat-edit-400 text-cat-edit-600 bg-cat-edit-500 ring-cat-edit-500 border-cat-edit-500',
  'from-cat-convert-from-500 to-cat-convert-from-700 bg-cat-convert-from-100 text-cat-convert-from-700 dark:bg-cat-convert-from-500/15 dark:text-cat-convert-from-400 text-cat-convert-from-600 bg-cat-convert-from-500 ring-cat-convert-from-500 border-cat-convert-from-500',
  'from-cat-convert-to-500 to-cat-convert-to-700 bg-cat-convert-to-100 text-cat-convert-to-700 dark:bg-cat-convert-to-500/15 dark:text-cat-convert-to-400 text-cat-convert-to-600 bg-cat-convert-to-500 ring-cat-convert-to-500 border-cat-convert-to-500',
  'from-cat-optimize-500 to-cat-optimize-700 bg-cat-optimize-100 text-cat-optimize-700 dark:bg-cat-optimize-500/15 dark:text-cat-optimize-400 text-cat-optimize-600 bg-cat-optimize-500 ring-cat-optimize-500 border-cat-optimize-500',
  'from-cat-security-500 to-cat-security-700 bg-cat-security-100 text-cat-security-700 dark:bg-cat-security-500/15 dark:text-cat-security-400 text-cat-security-600 bg-cat-security-500 ring-cat-security-500 border-cat-security-500',
  'from-cat-forms-sign-500 to-cat-forms-sign-700 bg-cat-forms-sign-100 text-cat-forms-sign-700 dark:bg-cat-forms-sign-500/15 dark:text-cat-forms-sign-400 text-cat-forms-sign-600 bg-cat-forms-sign-500 ring-cat-forms-sign-500 border-cat-forms-sign-500',
  'from-cat-review-500 to-cat-review-700 bg-cat-review-100 text-cat-review-700 dark:bg-cat-review-500/15 dark:text-cat-review-400 text-cat-review-600 bg-cat-review-500 ring-cat-review-500 border-cat-review-500',
].join(' ')
