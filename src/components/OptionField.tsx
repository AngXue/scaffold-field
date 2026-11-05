import { SegmentedControl } from './ui'

type Option<T extends string | number> = {
  value: T
  label: string
}

type OptionFieldProps<T extends string | number> = {
  label: string
  value: T
  options: ReadonlyArray<Option<T>>
  /** Wrapper class, matching `NumberField` so a grid of fields stays on one rhythm. */
  className?: string
  onChange: (value: T) => void
}

/**
 * A parameter that is a CHOICE rather than a number — which side of the drawing the
 * building is on, which 钢笆片 size the site stocks. Same height and edge as the
 * number fields beside it, and it delegates the actual control to the shared
 * segmented control so a choice looks the same everywhere in the app.
 *
 * Buttons rather than a `<select>`: a native picker inside a WebView is one more
 * surface the theme cannot reach, and every option is worth showing at once when
 * there are only two or three of them.
 */
export function OptionField<T extends string | number>({
  label,
  value,
  options,
  className = 'parameter-field',
  onChange,
}: OptionFieldProps<T>) {
  return (
    <div className={className}>
      <span>{label}</span>
      <SegmentedControl value={value} options={options} onChange={onChange} ariaLabel={label} />
    </div>
  )
}
