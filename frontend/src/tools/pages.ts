/**
 * Client-side mirror of backend `parse_page_spec`: "1-3, 5, 8-" -> 1-based pages.
 * Accepts all/*, odd, even, last, open-ended ranges.
 */

export interface PageSpecResult {
  /** Sorted, unique 1-based page numbers. */
  pages: number[]
  /** Collapsed ranges for display, e.g. [[1,3],[5,5],[8,12]]. */
  ranges: [number, number][]
  error?: string
}

export function parsePageSpec(spec: string, pageCount: number | null): PageSpecResult {
  const s = spec.trim().toLowerCase()
  const n = pageCount ?? Infinity
  const fail = (error: string): PageSpecResult => ({ pages: [], ranges: [], error })

  if (s === '' || s === 'all' || s === '*') {
    return pageCount ? { pages: range(1, pageCount), ranges: [[1, pageCount]] } : { pages: [], ranges: [] }
  }
  if (s === 'odd' || s === 'even') {
    if (!pageCount) return { pages: [], ranges: [] }
    const pages = range(1, pageCount).filter((p) => (s === 'odd' ? p % 2 === 1 : p % 2 === 0))
    return { pages, ranges: collapse(pages) }
  }

  const set = new Set<number>()
  for (const raw of s.split(',')) {
    let part = raw.trim()
    if (!part) continue
    if (part.includes('last')) {
      if (!pageCount) return fail('"last" needs a known page count')
      part = part.replaceAll('last', String(pageCount))
    }
    let start: number
    let end: number
    if (part.includes('-')) {
      const [a, b] = part.split('-', 2)
      start = a.trim() ? Number(a) : 1
      end = b.trim() ? Number(b) : pageCount ?? NaN
      if (!b.trim() && !pageCount) return fail('Open-ended range needs a known page count')
    } else {
      start = end = Number(part)
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) return fail(`Not a page number: "${raw.trim()}"`)
    if (start < 1) return fail('Pages start at 1')
    if (end < start) return fail(`Bad range: "${raw.trim()}"`)
    if (start > n) return fail(`Page ${start} is beyond the last page (${pageCount})`)
    for (let p = start; p <= Math.min(end, n); p++) set.add(p)
  }
  if (set.size === 0) return fail('Page selection is empty')
  const pages = [...set].sort((a, b) => a - b)
  return { pages, ranges: collapse(pages) }
}

function range(a: number, b: number): number[] {
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

function collapse(pages: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const p of pages) {
    const last = out[out.length - 1]
    if (last && last[1] === p - 1) last[1] = p
    else out.push([p, p])
  }
  return out
}
