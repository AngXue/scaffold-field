import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'

type NumberFieldProps = {
  label: string
  value: number
  unit?: string
  step?: number
  min?: number
  max?: number
  /** Wrapper class: the inspector's `parameter-field`, or the 2D strip's `inline-field`. */
  className?: string
  onChange: (value: number) => void
}

/**
 * A numeric field with explicit −/+ steppers, shared by the parameter panel and the
 * 2D segment strip so a length is edited the same way wherever it appears.
 *
 * The value is a plain number with the browser's native spinners turned off: Android
 * WebView draws none at all, so without these buttons a tablet could only type into
 * the field.
 */
export function NumberField({
  label,
  value,
  unit = 'm',
  step = 0.1,
  min = 0.1,
  max,
  className = 'parameter-field',
  onChange,
}: NumberFieldProps) {
  // While the user is typing, show exactly what they typed. A purely controlled
  // numeric input rewrites "1." to "1" mid-edit, which makes decimals impossible
  // to enter with a soft keyboard. The parsed value is still committed per
  // keystroke, and the draft is dropped on blur so the field snaps back to the
  // canonical clamped value.
  const [draft, setDraft] = useState<string | null>(null)
  const decimals = (String(step).split('.')[1] ?? '').length
  /**
   * A parameter object that predates a field — an older saved project, or a hot reload
   * that kept the previous state — would otherwise leave the input showing
   * "undefined" and swallowing every press (NaN fails the finite check below). Falling
   * back to the minimum keeps every field operable.
   */
  const current = Number.isFinite(value) ? value : min

  const clamp = (raw: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, raw))

  /** Typing is free-form: a step is an increment, not a limit on precision. */
  const commitTyped = (raw: number) => {
    if (Number.isFinite(raw)) onChange(clamp(raw))
  }

  /**
   * Stepping snaps to the step's own precision. Fractional steps accumulate float
   * noise (0.1 + 0.2 = 0.30000000000000004), and the field must never show a
   * number the user could not have typed.
   */
  const commitStepped = (raw: number) => {
    if (Number.isFinite(raw)) onChange(Number(clamp(raw).toFixed(decimals)))
  }

  const nudge = (direction: number) => {
    setDraft(null)
    commitStepped(current + step * direction)
  }

  return (
    <label className={className}>
      <span>{label}</span>
      <span className="number-input">
        <button
          className="number-step"
          type="button"
          title={`减小${label}`}
          disabled={current <= min}
          onClick={() => nudge(-1)}
        >
          <Minus size={15} />
        </button>
        {/* Deliberately a text input with a decimal keypad. A number input reports
            its value as "" while the user is mid-way through "7." — the browser
            rejects a partial number — so decimals cannot be typed with a soft
            keyboard. Rendered value falls back to the model value when not
            editing. */}
        <input
          type="text"
          inputMode="decimal"
          value={draft ?? String(current)}
          onChange={(event) => {
            const raw = event.target.value.replace(/[^0-9.]/g, '')
            setDraft(raw)
            if (raw !== '' && raw !== '.') commitTyped(Number(raw))
          }}
          onBlur={() => setDraft(null)}
        />
        <b>{unit}</b>
        <button
          className="number-step"
          type="button"
          title={`增大${label}`}
          disabled={max !== undefined && current >= max}
          onClick={() => nudge(1)}
        >
          <Plus size={15} />
        </button>
      </span>
    </label>
  )
}
