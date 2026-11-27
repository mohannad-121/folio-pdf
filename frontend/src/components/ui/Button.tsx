import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import clsx from 'clsx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Optional progress text while loading (e.g. "42%"). */
  loadingLabel?: ReactNode
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  /** Stretch to container width. */
  block?: boolean
}

export const buttonBase =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:pointer-events-none disabled:opacity-50'

export const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(15_23_42/0.2)] hover:bg-brand-500 active:bg-brand-700',
  /* Category-colored gradient; set `--accent` + gradient classes via `className`. */
  accent:
    'bg-linear-to-br text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_2px_rgb(15_23_42/0.2)] hover:brightness-110 hover:shadow-glow active:brightness-95',
  secondary:
    'border border-border-strong bg-surface text-fg shadow-[0_1px_2px_rgb(15_23_42/0.04)] hover:bg-surface-2 hover:border-border-strong active:bg-surface-3',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg active:bg-surface-3',
  danger: 'bg-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-red-500 active:bg-red-700',
}

export const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
  sm: 'h-8 px-3 text-sm [&_svg]:size-4',
  md: 'h-10 px-4 text-sm [&_svg]:size-4',
  lg: 'h-12 px-6 text-base rounded-xl [&_svg]:size-5',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, loadingLabel, leftIcon, rightIcon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(buttonBase, buttonVariants[variant], buttonSizes[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : leftIcon}
      <span className={clsx(loading && loadingLabel != null && 'tabular')}>{loading && loadingLabel != null ? loadingLabel : children}</span>
      {!loading && rightIcon}
    </button>
  )
})

export default Button
