import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

interface RecentToolsState {
  ids: string[]
  touch: (id: string) => void
}

const MAX = 8

/** Last 8 tool ids the user opened (for the command palette's "Recent" section). */
export const useRecentTools = create<RecentToolsState>()(
  persist(
    (set) => ({
      ids: [],
      touch: (id) => set((s) => ({ ids: [id, ...s.ids.filter((x) => x !== id)].slice(0, MAX) })),
    }),
    { name: 'folio.recent-tools', storage: createJSONStorage(() => localStorage), version: 1 },
  ),
)
