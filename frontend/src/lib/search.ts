/**
 * Tool search shared by the home page and the command palette.
 *
 * Ranking prefers whole words: "word" matches "PDF to Word" strongly, "Compress" via the prefix
 * "comp" well, and "password" (a match inside a word) only weakly. Weak results are dropped
 * whenever there are stronger ones. Multi-word queries must match every word.
 */
import { CATEGORY_LABELS, TOOLS, type ToolDef } from './tools'

const SEPARATOR = /[^\p{L}\p{N}]/u
const WHOLE = 100
const PREFIX = 70
const INSIDE = 15
/** Results below this are only shown when nothing matches better. */
const STRONG = 60

function isBoundary(text: string, i: number): boolean {
  return i <= 0 || i >= text.length || SEPARATOR.test(text[i - 1] ?? '') || SEPARATOR.test(text[i] ?? '')
}

/** Best score of one query token in `text` (0 = no match). */
function tokenScore(token: string, text: string, fuzzy: boolean): number {
  let best = 0
  for (let i = text.indexOf(token); i >= 0; i = text.indexOf(token, i + 1)) {
    const starts = i === 0 || SEPARATOR.test(text[i - 1])
    const ends = i + token.length === text.length || SEPARATOR.test(text[i + token.length])
    const kind = starts && ends ? WHOLE : starts ? PREFIX : INSIDE
    best = Math.max(best, kind + Math.max(0, 10 - i / 8)) // small bonus for appearing early
  }
  if (best || !fuzzy || token.length < 2) return best
  // Letters in order (abbreviations / small typos), only for short fields; must start a word.
  let ti = 0
  let score = 0
  for (const [k, ch] of [...token].entries()) {
    const found = text.indexOf(ch, ti)
    if (found < 0) return 0
    if (k === 0 && !isBoundary(text, found)) return 0
    score += found === ti ? 3 : 1
    ti = found + 1
  }
  return Math.min(INSIDE, score)
}

/** Score of `query` against `text`; every whitespace-separated token must match. */
export function matchScore(query: string, text: string, fuzzy = false): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return 1
  const t = text.toLowerCase()
  let total = 0
  for (const tok of tokens) {
    const s = tokenScore(tok, t, fuzzy)
    if (!s) return 0
    total += s
  }
  return total / tokens.length
}

export function toolScore(query: string, tool: ToolDef): number {
  return Math.max(
    matchScore(query, tool.name, true) * 1.3,
    matchScore(query, tool.id.replace(/-/g, ' '), true),
    matchScore(query, tool.description) * 0.8,
    matchScore(query, CATEGORY_LABELS[tool.category]) * 0.7,
  )
}

/** Tools matching `query`, best first. */
export function searchTools(query: string, tools: ToolDef[] = TOOLS): ToolDef[] {
  const q = query.trim()
  if (!q) return []
  const scored = tools
    .map((t) => ({ t, score: toolScore(q, t) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || Number(!!b.t.featured) - Number(!!a.t.featured))
  const hasStrong = scored.some((x) => x.score >= STRONG)
  return (hasStrong ? scored.filter((x) => x.score >= STRONG) : scored).map((x) => x.t)
}
