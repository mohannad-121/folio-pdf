import clsx from 'clsx'

/** Gradient brand tile. */
export default function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = size === 'sm' ? 'size-5 rounded-[6px]' : size === 'lg' ? 'size-12 rounded-2xl' : 'size-8 rounded-lg'
  return (
    <span className={clsx('relative grid shrink-0 place-items-center overflow-hidden bg-linear-to-br from-brand-500 via-brand-600 to-cat-organize-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_2px_6px_-1px_rgb(52_67_245/0.5)]', s)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className={size === 'sm' ? 'size-3' : size === 'lg' ? 'size-7' : 'size-[18px]'} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l5 5v13H7z" />
        <path d="M14 3v5h5" />
        <path d="M10 13h6M10 17h4" />
      </svg>
      <span className="pointer-events-none absolute -top-1/2 left-0 h-full w-full rotate-12 bg-white/10" />
    </span>
  )
}
