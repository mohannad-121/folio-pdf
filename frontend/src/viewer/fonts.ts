import type { FontName, TextSpan } from './types'

export const FONT_OPTIONS: { v: FontName; label: string }[] = [
  { v: 'helv', label: 'Helvetica' },
  { v: 'heit', label: 'Helvetica Italic' },
  { v: 'tiro', label: 'Times' },
  { v: 'tibo', label: 'Times Bold' },
  { v: 'cour', label: 'Courier' },
]

/** CSS font-family approximating a PDF base-14 font name. */
export function fontFamily(font: FontName | string | undefined): string {
  switch (font) {
    case 'tiro':
    case 'tibo':
      return '"Times New Roman", Times, serif'
    case 'cour':
      return '"Courier New", Courier, monospace'
    default:
      return 'Helvetica, Arial, sans-serif'
  }
}

/** Best-effort mapping from an extracted span's font to a base-14 name. */
export function guessFont(span: TextSpan | undefined): FontName {
  if (!span) return 'helv'
  const f = span.font.toLowerCase()
  if (f.includes('cour') || f.includes('mono')) return 'cour'
  if (f.includes('times') || f.includes('serif') || f.includes('georgia') || f.includes('garamond')) return span.bold ? 'tibo' : 'tiro'
  if (span.italic) return 'heit'
  return 'helv'
}
