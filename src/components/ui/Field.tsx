import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from './cx'

export type FieldProps = {
  label?: string
  hint?: ReactNode
  htmlFor?: string
  children: ReactNode
  className?: string
}

/** Label + control + optional hint. The only wrapper a form control needs. */
export function Field({ label, hint, htmlFor, children, className }: FieldProps) {
  return (
    <div className={cx('ui-field', className)}>
      {label ? <label className="ui-field__label" htmlFor={htmlFor}>{label}</label> : null}
      {children}
      {hint ? <small className="ui-field__hint">{hint}</small> : null}
    </div>
  )
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** A unit shown inside the recessed well, e.g. `m`. */
  unit?: string
}

/** Recessed text/number input. The inset edge is the visible boundary. */
export function Input({ unit, className, ...rest }: InputProps) {
  if (!unit) return <input className={cx('ui-input', className)} {...rest} />
  return (
    <span className="ui-input-wrap">
      <input className={cx('ui-input', 'ui-input--with-unit', className)} {...rest} />
      <b className="ui-input__unit" aria-hidden>{unit}</b>
    </span>
  )
}

export type SelectOption = { value: string; label: string; disabled?: boolean }

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  options: ReadonlyArray<SelectOption>
}

/** A native select in the same recessed well as the inputs. */
export function Select({ options, className, ...rest }: SelectProps) {
  return (
    <span className="ui-select-wrap">
      <select className={cx('ui-select', className)} {...rest}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
      <ChevronDown className="ui-select__chevron" size={15} aria-hidden />
    </span>
  )
}

export type BadgeProps = {
  children: ReactNode
  tone?: 'neutral' | 'strong' | 'warn' | 'danger'
  className?: string
}

/** Small flat status tag. It is read, not pressed — no shadow. */
export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return <span className={cx('ui-badge', `ui-badge--${tone}`, className)}>{children}</span>
}

export type SectionHeadingProps = {
  title: ReactNode
  caption?: ReactNode
  action?: ReactNode
  level?: 2 | 3
}

/** Flat section header used by every panel and table block. */
export function SectionHeading({ title, caption, action, level = 2 }: SectionHeadingProps) {
  const Tag = level === 2 ? 'h2' : 'h3'
  return (
    <div className="ui-section-heading">
      <div className="ui-section-heading__text">
        {caption ? <span className="field-caption">{caption}</span> : null}
        <Tag>{title}</Tag>
      </div>
      {action ? <div className="ui-section-heading__action">{action}</div> : null}
    </div>
  )
}

export type EmptyStateProps = {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="ui-empty">
      {icon ? <span className="ui-empty__icon" aria-hidden>{icon}</span> : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}
