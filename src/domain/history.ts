import {
  DEFAULT_PARAMETERS,
  type MaterialAdjustments,
  type Point2D,
  type ScaffoldParameters,
} from './scaffold'
import { measurePath } from './plan'

/** How many records the history keeps; the oldest one is dropped beyond this. */
export const HISTORY_LIMIT = 100
export const HISTORY_KEY = 'scaffold-history'

/** The project state a history record captures — everything a save restores. */
export type HistorySnapshot = {
  points: Point2D[]
  lengths: number[]
  parameters: ScaffoldParameters
  adjustments: MaterialAdjustments
}

export type HistoryRecord = HistorySnapshot & {
  id: string
  savedAt: number
  /** What the record holds, in the site's words: 段长 · 作业层数 · 排距. */
  label: string
}

/**
 * "7.10 + 4.30 m · 5 层 · 排距 0.90" — enough to tell two records apart in a list
 * without opening them, and it never goes stale because it is derived, not typed.
 */
export function historyLabel(snapshot: HistorySnapshot): string {
  const lengths = snapshot.lengths.length > 0
    ? snapshot.lengths
    : measurePath(snapshot.points)
  const segments = lengths.map((length) => length.toFixed(2)).join(' + ')
  const layers = Math.max(1, Math.round(snapshot.parameters?.layerCount ?? DEFAULT_PARAMETERS.layerCount))
  const width = Number(snapshot.parameters?.width ?? DEFAULT_PARAMETERS.width)
  return `${segments} m · ${layers} 层 · 排距 ${width.toFixed(2)}`
}

/** Two snapshots are the same project when every saved field matches. */
export function sameSnapshot(a: HistorySnapshot, b: HistorySnapshot): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}

function canonical(snapshot: HistorySnapshot) {
  return {
    points: snapshot.points,
    lengths: snapshot.lengths,
    parameters: snapshot.parameters,
    adjustments: snapshot.adjustments ?? {},
  }
}

/**
 * Put a snapshot at the top of the history. Saving the same project twice in a row
 * does not add a second record — the button is easy to hit twice and a list of
 * identical rows helps nobody — and anything past `HISTORY_LIMIT` falls off the end.
 */
export function addHistoryRecord(
  records: HistoryRecord[],
  snapshot: HistorySnapshot,
  options: { now?: number; id?: string } = {},
): HistoryRecord[] {
  const now = options.now ?? Date.now()
  if (records.length > 0 && sameSnapshot(records[0], snapshot)) {
    return records
  }
  const record: HistoryRecord = {
    ...snapshot,
    adjustments: snapshot.adjustments ?? {},
    id: options.id ?? `h${now}-${records.length}`,
    savedAt: now,
    label: historyLabel(snapshot),
  }
  return [record, ...records].slice(0, HISTORY_LIMIT)
}

export function removeHistoryRecord(records: HistoryRecord[], id: string): HistoryRecord[] {
  return records.filter((record) => record.id !== id)
}

/** Read the stored list, tolerating anything a previous version may have written. */
export function parseHistory(raw: string | null): HistoryRecord[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const records: HistoryRecord[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const candidate = entry as Partial<HistoryRecord>
    if (!Array.isArray(candidate.points) || candidate.points.length < 2) continue
    if (!Array.isArray(candidate.lengths)) continue
    const savedAt = typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
      ? candidate.savedAt
      : 0
    const snapshot: HistorySnapshot = {
      points: candidate.points as Point2D[],
      lengths: candidate.lengths as number[],
      // A record from an older build is completed with today's defaults rather than
      // rejected: its own fields still describe the project it saved.
      parameters: { ...DEFAULT_PARAMETERS, ...(candidate.parameters ?? {}) },
      adjustments: (candidate.adjustments ?? {}) as MaterialAdjustments,
    }
    records.push({
      ...snapshot,
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `h${savedAt}-${records.length}`,
      savedAt,
      label: typeof candidate.label === 'string' && candidate.label
        ? candidate.label
        : historyLabel(snapshot),
    })
    if (records.length >= HISTORY_LIMIT) break
  }
  return records
}

export function serialiseHistory(records: HistoryRecord[]): string {
  return JSON.stringify(records.slice(0, HISTORY_LIMIT))
}

/** "10-11 20:15" — short enough for a list row, and the list is already date-ordered. */
export function formatHistoryTime(savedAt: number): string {
  if (!savedAt) return '—'
  const date = new Date(savedAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
