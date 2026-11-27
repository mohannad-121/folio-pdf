import { useCallback, useEffect, useState } from 'react'
import type { SavedSignature } from '../types'

const KEY = 'folio.signatures.v1'

function load(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as SavedSignature[]) : []
  } catch {
    return []
  }
}

function save(list: SavedSignature[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* storage full or unavailable */
  }
}

/** Signatures saved in the browser (file ids live on the server). */
export function useLocalSignatures() {
  const [signatures, setSignatures] = useState<SavedSignature[]>(() => load())

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSignatures(load())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const add = useCallback((sig: SavedSignature) => {
    setSignatures((prev) => {
      const next = [sig, ...prev.filter((s) => s.id !== sig.id)].slice(0, 12)
      save(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setSignatures((prev) => {
      const next = prev.filter((s) => s.id !== id)
      save(next)
      return next
    })
  }, [])

  return { signatures, add, remove }
}
