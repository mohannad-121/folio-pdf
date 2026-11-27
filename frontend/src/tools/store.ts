import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { FileOut } from '../lib/api'

export interface RecentFile {
  file_id: string
  name: string
  size: number
  content_type: string
  page_count: number | null
  /** Epoch ms when the file was uploaded / produced. */
  ts: number
  /** Where it came from. */
  origin: 'upload' | 'output'
}

interface RecentFilesState {
  files: RecentFile[]
  add: (f: FileOut, origin: RecentFile['origin']) => void
  remove: (fileId: string) => void
  clear: () => void
}

const MAX = 20
/** Files expire server-side after 24h; drop them locally too. */
const TTL_MS = 24 * 60 * 60 * 1000

export const useRecentFiles = create<RecentFilesState>()(
  persist(
    (set) => ({
      files: [],
      add: (f, origin) =>
        set((s) => {
          const entry: RecentFile = {
            file_id: f.file_id,
            name: f.name,
            size: f.size,
            content_type: f.content_type,
            page_count: f.page_count,
            ts: Date.now(),
            origin,
          }
          const rest = s.files.filter((x) => x.file_id !== f.file_id && Date.now() - x.ts < TTL_MS)
          return { files: [entry, ...rest].slice(0, MAX) }
        }),
      remove: (fileId) => set((s) => ({ files: s.files.filter((x) => x.file_id !== fileId) })),
      clear: () => set({ files: [] }),
    }),
    {
      name: 'folio.recent-files',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    },
  ),
)

/** Selector that also filters expired entries (without mutating the store). */
export function selectFresh(files: RecentFile[]): RecentFile[] {
  const now = Date.now()
  return files.filter((f) => now - f.ts < TTL_MS)
}
