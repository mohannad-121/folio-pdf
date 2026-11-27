import { useEffect } from 'react'
import { useViewer } from '../store'
import type { Mode } from '../types'

export interface ShortcutActions {
  save: () => void
  download: () => void
  print: () => void
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

const MODE_KEYS: Record<string, Mode> = {
  v: 'select',
  h: 'hand',
  d: 'draw',
  t: 'text',
  e: 'edit-text',
  n: 'note',
  i: 'image',
  l: 'link',
  r: 'redact',
  s: 'sign',
  p: 'stamp',
  f: 'forms',
  o: 'organize',
}

export function useKeyboardShortcuts(enabled: boolean, actions: ShortcutActions) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const s = useViewer.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 's') {
        e.preventDefault()
        actions.save()
        return
      }
      if (mod && key === 'f') {
        e.preventDefault()
        s.setSidebar(true, 'search')
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-search-input]')?.focus())
        return
      }
      if (mod && key === 'p') {
        e.preventDefault()
        actions.print()
        return
      }
      if (mod && (key === 'z' || key === 'y')) {
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        if (key === 'y' || (key === 'z' && e.shiftKey)) s.redo()
        else s.undo()
        return
      }
      if (mod && (key === '=' || key === '+' || key === '-' || key === '0')) {
        e.preventDefault()
        if (key === '0') s.setZoom(1, 'width')
        else s.setZoom(s.zoom * (key === '-' ? 1 / 1.2 : 1.2))
        return
      }

      if (isEditableTarget(e.target)) return
      if (s.dialog) {
        if (e.key === 'Escape') s.setDialog(null)
        return
      }

      if (e.key === 'Escape') {
        if (s.selection || s.editingOpId) s.select(null)
        else s.setMode('select')
        s.setEditingOpId(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && s.selection?.kind === 'op') {
        e.preventDefault()
        s.removeOp(s.selection.id)
        return
      }
      if (mod) return

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
        case 'PageDown':
          if (e.key === 'PageDown' || s.layout === 'single') {
            e.preventDefault()
            s.scrollToPage(Math.min(s.info?.page_count ?? 1, s.currentPage + 1))
          }
          return
        case 'ArrowUp':
        case 'ArrowLeft':
        case 'PageUp':
          if (e.key === 'PageUp' || s.layout === 'single') {
            e.preventDefault()
            s.scrollToPage(Math.max(1, s.currentPage - 1))
          }
          return
        case 'Home':
          e.preventDefault()
          s.scrollToPage(1)
          return
        case 'End':
          e.preventDefault()
          s.scrollToPage(s.info?.page_count ?? 1)
          return
        case '+':
        case '=':
          s.setZoom(s.zoom * 1.2)
          return
        case '-':
          s.setZoom(s.zoom / 1.2)
          return
      }

      if (e.shiftKey && key === 'h') {
        s.setMarkupType('highlight')
        s.setMode('markup')
        return
      }
      if (e.shiftKey || e.altKey) return
      const mode = MODE_KEYS[key]
      if (mode) s.setMode(mode)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, actions])
}
