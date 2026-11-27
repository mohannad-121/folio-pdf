/** Client-side full-text search via pdf.js text content; hits are highlighted on the overlay. */
import clsx from 'clsx'
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getPage, getTextItems, type PDFDocumentProxy } from '../pdfjs'
import { useViewer } from '../store'
import type { RectT, SearchHit } from '../types'
import { IconButton, inputCls, Spinner } from './ui'

async function searchDocument(doc: PDFDocumentProxy, query: string, matchCase: boolean, signal: { cancelled: boolean }, onPage?: (hits: SearchHit[]) => void): Promise<SearchHit[]> {
  const all: SearchHit[] = []
  const q = matchCase ? query : query.toLowerCase()
  for (let p = 1; p <= doc.numPages; p++) {
    if (signal.cancelled) break
    const page = await getPage(doc, p)
    const items = await getTextItems(page)
    // Build a flat string with per-char item index.
    let text = ''
    const owner: number[] = []
    const offset: number[] = []
    items.forEach((it, idx) => {
      for (let c = 0; c < it.str.length; c++) {
        owner.push(idx)
        offset.push(c)
      }
      text += it.str
      if (it.hasEOL) {
        text += ' '
        owner.push(idx)
        offset.push(it.str.length)
      }
    })
    const hay = matchCase ? text : text.toLowerCase()
    let from = 0
    const pageHits: SearchHit[] = []
    while (from < hay.length) {
      const i = hay.indexOf(q, from)
      if (i < 0) break
      const end = i + q.length
      // group matched chars by item → rects
      const rects: RectT[] = []
      let cur: { idx: number; a: number; b: number } | null = null
      for (let c = i; c < end; c++) {
        const idx = owner[c]
        const off = offset[c]
        if (cur && cur.idx === idx) cur.b = off + 1
        else {
          if (cur) rects.push(itemRect(items[cur.idx], cur.a, cur.b))
          cur = { idx, a: off, b: off + 1 }
        }
      }
      if (cur) rects.push(itemRect(items[cur.idx], cur.a, cur.b))
      for (const r of rects) pageHits.push({ page: p, rect: r, text: text.slice(Math.max(0, i - 30), Math.min(text.length, end + 30)).replace(/\s+/g, ' ') })
      // Merge rects of one match into a single hit (use union) for navigation
      from = end
    }
    // Collapse the hit list so each match is one entry with the union rect but keep per-item rects for display
    all.push(...pageHits)
    onPage?.(all.slice())
  }
  return all
}

function itemRect(it: { str: string; rect: RectT }, a: number, b: number): RectT {
  const len = Math.max(1, it.str.length)
  const w = it.rect[2] - it.rect[0]
  return [it.rect[0] + (w * a) / len, it.rect[1], it.rect[0] + (w * b) / len, it.rect[3]]
}

export default function SearchPanel() {
  const doc = useViewer((s) => s.doc)
  const search = useViewer((s) => s.search)
  const setSearch = useViewer((s) => s.setSearch)
  const [query, setQuery] = useState(search.query)
  const runRef = useRef<{ cancelled: boolean } | null>(null)

  const run = useCallback(
    async (q: string, matchCase: boolean) => {
      if (runRef.current) runRef.current.cancelled = true
      if (!doc || !q.trim()) {
        setSearch({ query: q, hits: [], index: -1, running: false })
        return
      }
      const signal = { cancelled: false }
      runRef.current = signal
      setSearch({ query: q, matchCase, hits: [], index: -1, running: true })
      try {
        const hits = await searchDocument(doc, q, matchCase, signal, (partial) => {
          if (!signal.cancelled) setSearch({ hits: partial })
        })
        if (signal.cancelled) return
        setSearch({ hits, index: hits.length ? 0 : -1, running: false })
        if (hits.length) useViewer.getState().scrollToPage(hits[0].page, hits[0].rect)
      } catch (e) {
        if (!signal.cancelled) {
          setSearch({ running: false })
          useViewer.getState().notify('error', `Search failed: ${(e as Error).message}`)
        }
      }
    },
    [doc, setSearch],
  )

  useEffect(() => () => void (runRef.current && (runRef.current.cancelled = true)), [])

  const goto = (idx: number) => {
    const hits = search.hits
    if (!hits.length) return
    const i = ((idx % hits.length) + hits.length) % hits.length
    setSearch({ index: i })
    useViewer.getState().scrollToPage(hits[i].page, hits[i].rect)
  }

  return (
    <div className="flex h-full flex-col">
      <form
        className="flex items-center gap-1 border-b border-neutral-200 p-2 dark:border-neutral-800"
        onSubmit={(e) => {
          e.preventDefault()
          if (query === search.query && search.hits.length) goto(search.index + 1)
          else void run(query, search.matchCase)
        }}
      >
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input data-search-input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in document…" className={clsx(inputCls, 'pl-7 pr-6')} autoFocus />
          {query && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                setQuery('')
                setSearch({ query: '', hits: [], index: -1 })
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <IconButton label="Match case" active={search.matchCase} onClick={() => void run(query, !search.matchCase)} className="h-7 w-7">
          <CaseSensitive size={16} />
        </IconButton>
      </form>
      <div className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-500">
        {search.running ? (
          <>
            <Spinner className="h-3 w-3" /> Searching… {search.hits.length} so far
          </>
        ) : search.query ? (
          <span>
            {search.hits.length} result{search.hits.length === 1 ? '' : 's'}
            {search.hits.length > 0 && ` · ${search.index + 1} of ${search.hits.length}`}
          </span>
        ) : (
          <span>Press Enter to search</span>
        )}
        <span className="flex-1" />
        <IconButton label="Previous" disabled={!search.hits.length} onClick={() => goto(search.index - 1)} className="h-6 w-6">
          <ChevronUp size={14} />
        </IconButton>
        <IconButton label="Next" disabled={!search.hits.length} onClick={() => goto(search.index + 1)} className="h-6 w-6">
          <ChevronDown size={14} />
        </IconButton>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto text-xs">
        {search.hits.map((h, i) => (
          <li key={i}>
            <button type="button" onClick={() => goto(i)} className={clsx('flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800', i === search.index && 'bg-brand-50 dark:bg-brand-900/30')}>
              <span className="shrink-0 tabular-nums text-neutral-400">p.{h.page}</span>
              <span className="line-clamp-2 text-neutral-700 dark:text-neutral-300">{highlightSnippet(h.text, search.query, search.matchCase)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function highlightSnippet(text: string, q: string, matchCase: boolean): React.ReactNode {
  if (!q) return text
  const hay = matchCase ? text : text.toLowerCase()
  const i = hay.indexOf(matchCase ? q : q.toLowerCase())
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700/60">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}
