import type { ReactNode } from 'react'
import { cx } from './cx'

export type SegmentOption<T extends string | number> = {
  value: T
  label: ReactNode
  icon?: ReactNode
  title?: string
}

type SegmentedControlProps<T extends string | number> = {
  value: T
  options: ReadonlyArray<SegmentOption<T>>
  onChange: (value: T) => void
  ariaLabel: string
  /** Icon-only segments still need their label announced through `title`. */
  compact?: boolean
  className?: string
}

/**
 * A recessed track with one raised chip: the standard way to choose one of a
 * small set of modes (drawing tool, 房屋笔 rectangle/guide, 钢笆片 size...).
 *
 * It is a group of real buttons rather than a native `<select>` so the choice
 * stays visible and reachable with one tap on the tablet, and the selected chip
 * is legible without colour.
 */
export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  compact = false,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={cx('ui-segmented', compact && 'ui-segmented--compact', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={cx('ui-segmented__item', option.value === value && 'is-active')}
          aria-pressed={option.value === value}
          title={option.title ?? (typeof option.label === 'string' ? option.label : ariaLabel)}
          onClick={() => onChange(option.value)}
        >
          {option.icon ? <span className="ui-segmented__icon" aria-hidden>{option.icon}</span> : null}
          <span className={compact ? 'sr-only' : 'ui-segmented__label'}>{option.label}</span>
        </button>
      ))}
    </div>
  )
}
