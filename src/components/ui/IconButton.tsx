import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
  /** Required: an icon alone has no accessible name. Also used as the tooltip. */
  label: string
  icon: ReactNode
  /** Visual pressed state. Pair with `toggle` so the state is also announced. */
  active?: boolean
  toggle?: boolean
  size?: 'xs' | 'sm' | 'md'
  /** `inverse` for an icon sitting on the dark primary surface. */
  tone?: 'default' | 'inverse'
}

/** A square icon-only control, e.g. undo, fullscreen, a popover close button. */
export function IconButton({
  label,
  icon,
  active = false,
  toggle = false,
  size = 'md',
  tone = 'default',
  className,
  title,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={toggle ? active : undefined}
      title={title ?? label}
      className={cx('ui-icon-button', `ui-icon-button--${size}`, tone === 'inverse' && 'ui-icon-button--inverse',
        active && 'is-active', className)}
      {...rest}
    >
      {icon}
    </button>
  )
}
