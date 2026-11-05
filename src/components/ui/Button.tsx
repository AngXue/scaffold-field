import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary = the commit action, secondary = raised control, ghost = in-place action. */
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading glyph; hidden from assistive tech because the label carries the meaning. */
  icon?: ReactNode
  trailing?: ReactNode
  block?: boolean
}

/**
 * The single raised control used across the app. The neumorphic depth comes from
 * the shared `--nm-e*` tokens, so a new screen gets the same height, radius and
 * pressed state by using this component rather than a bare `<button>`.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  trailing,
  block = false,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('ui-button', `ui-button--${variant}`, `ui-button--${size}`, block && 'ui-button--block', className)}
      {...rest}
    >
      {icon ? <span className="ui-button__icon" aria-hidden>{icon}</span> : null}
      {children === undefined || children === null ? null : <span className="ui-button__label">{children}</span>}
      {trailing ? <span className="ui-button__icon ui-button__icon--trailing" aria-hidden>{trailing}</span> : null}
    </button>
  )
}
