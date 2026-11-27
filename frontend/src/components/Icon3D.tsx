/**
 * A 3D icon tile: a lit, glossy face in the palette's colours, a thick darker edge built from
 * stacked layers in real CSS 3D space, an embossed white glyph floating above the face, and a soft
 * cast shadow. Rests at a slight angle and tilts further on hover (or follows the pointer when the
 * parent sets --rx / --ry). Styles live in index.css under ".i3d".
 */
import clsx from 'clsx'
import type { CSSProperties } from 'react'
import type { ToolCategory } from '../lib/tools'
import ToolIcon from './ToolIcon'

/** A colour family with 400/500/600/700 shades defined in index.css. */
export type Palette = `cat-${ToolCategory}` | 'brand'

interface Props {
  icon: string
  palette: Palette
  /** Tile size in px (the glyph scales with it). */
  size?: number
  /** Gentle up-and-down idle motion. */
  float?: boolean
  className?: string
}

export function paletteVars(palette: Palette): CSSProperties {
  return {
    '--c4': `var(--color-${palette}-400)`,
    '--c5': `var(--color-${palette}-500)`,
    '--c6': `var(--color-${palette}-600)`,
    '--c7': `var(--color-${palette}-700)`,
  } as CSSProperties
}

export default function Icon3D({ icon, palette, size = 52, float, className }: Props) {
  const glyph = Math.round(size * 0.46)
  return (
    <span className={clsx('i3d', float && 'motion-safe:animate-float', className)} style={{ ...paletteVars(palette), '--size': `${size}px` } as CSSProperties} aria-hidden="true">
      <span className="i3d-shadow" />
      <span className="i3d-stage">
        {/* Edge: stacked slices behind the face read as a solid block when the tile is tilted. */}
        <span className="i3d-side" style={{ '--z': '-2px' } as CSSProperties} />
        <span className="i3d-side" style={{ '--z': '-4px' } as CSSProperties} />
        <span className="i3d-side" style={{ '--z': '-6px' } as CSSProperties} />
        <span className="i3d-side" style={{ '--z': '-8px' } as CSSProperties} />
        <span className="i3d-side" style={{ '--z': '-10px' } as CSSProperties} />
        <span className="i3d-face">
          <span className="i3d-gloss" />
        </span>
        <span className="i3d-glyph-back">
          <ToolIcon name={icon} size={glyph} strokeWidth={2.4} />
        </span>
        <span className="i3d-glyph">
          <ToolIcon name={icon} size={glyph} strokeWidth={2.4} />
        </span>
      </span>
    </span>
  )
}
