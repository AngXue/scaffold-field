import { describe, expect, it } from 'vitest'
import {
  addHistoryRecord,
  formatHistoryTime,
  HISTORY_LIMIT,
  historyLabel,
  parseHistory,
  removeHistoryRecord,
  sameSnapshot,
  serialiseHistory,
  type HistoryRecord,
  type HistorySnapshot,
} from './history'
import { DEFAULT_PARAMETERS } from './scaffold'

const snapshot = (overrides: Partial<HistorySnapshot> = {}): HistorySnapshot => ({
  points: [
    { id: 'P1', x: 0, y: 0 },
    { id: 'P2', x: 360, y: 0 },
    { id: 'P3', x: 360, y: 240 },
  ],
  lengths: [7.2, 4.8],
  parameters: { ...DEFAULT_PARAMETERS },
  adjustments: {},
  ...overrides,
})

describe('history', () => {
  it('labels a record with what the site recognises', () => {
    expect(historyLabel(snapshot())).toBe('7.20 + 4.80 m · 5 层 · 排距 0.90')
    expect(historyLabel(snapshot({
      lengths: [7.1, 4.3],
      parameters: { ...DEFAULT_PARAMETERS, layerCount: 6, width: 0.9 },
    }))).toBe('7.10 + 4.30 m · 6 层 · 排距 0.90')
    // A record without lengths falls back to measuring its own path.
    expect(historyLabel(snapshot({ lengths: [] }))).toContain('7.20 + 4.80 m')
  })

  it('keeps the newest first and never stores the same project twice in a row', () => {
    const first = addHistoryRecord([], snapshot(), { now: 1000, id: 'a' })
    const second = addHistoryRecord(first, snapshot({ lengths: [7.1, 4.3] }), { now: 2000, id: 'b' })
    const again = addHistoryRecord(second, snapshot({ lengths: [7.1, 4.3] }), { now: 3000, id: 'c' })

    expect(first).toHaveLength(1)
    expect(second.map((record) => record.id)).toEqual(['b', 'a'])
    expect(again).toBe(second)
    expect(second[0].savedAt).toBe(2000)
    expect(second[0].adjustments).toEqual({})
  })

  it('caps the history at 100 records, dropping the oldest', () => {
    let records: HistoryRecord[] = []
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      records = addHistoryRecord(records, snapshot({ lengths: [7 + index * 0.01] }), {
        now: 1000 + index,
        id: `r${index}`,
      })
    }

    expect(records).toHaveLength(HISTORY_LIMIT)
    expect(records[0].id).toBe(`r${HISTORY_LIMIT + 4}`)
    expect(records.some((record) => record.id === 'r0')).toBe(false)
    expect(records[HISTORY_LIMIT - 1].id).toBe('r5')
  })

  it('deletes one record by id and leaves the rest alone', () => {
    const records = addHistoryRecord(
      addHistoryRecord([], snapshot(), { now: 1000, id: 'a' }),
      snapshot({ lengths: [7.1, 4.3] }),
      { now: 2000, id: 'b' },
    )

    expect(removeHistoryRecord(records, 'a').map((record) => record.id)).toEqual(['b'])
    expect(removeHistoryRecord(records, 'missing')).toHaveLength(2)
  })

  it('reads back what it wrote, and tolerates anything else', () => {
    const records = addHistoryRecord([], snapshot({ adjustments: { 'pipe-6': 2 } }), {
      now: 1000,
      id: 'a',
    })
    const restored = parseHistory(serialiseHistory(records))

    expect(restored).toHaveLength(1)
    expect(restored[0].id).toBe('a')
    expect(restored[0].label).toBe(records[0].label)
    expect(restored[0].adjustments).toEqual({ 'pipe-6': 2 })
    expect(sameSnapshot(restored[0], snapshot({ adjustments: { 'pipe-6': 2 } }))).toBe(true)

    // Junk, a truncated list, or a record from a build without the newer parameters.
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('not json')).toEqual([])
    expect(parseHistory('{"points":[]}')).toEqual([])
    expect(parseHistory('[{"points":[],"lengths":[]},null,7]')).toEqual([])
    const legacy = parseHistory(JSON.stringify([{ points: snapshot().points, lengths: [7.2, 4.8] }]))
    expect(legacy).toHaveLength(1)
    expect(legacy[0].parameters.layerCount).toBe(DEFAULT_PARAMETERS.layerCount)
    expect(legacy[0].adjustments).toEqual({})
    expect(legacy[0].label).toBe('7.20 + 4.80 m · 5 层 · 排距 0.90')
  })

  it('shows a short timestamp for a list row', () => {
    expect(formatHistoryTime(0)).toBe('—')
    expect(formatHistoryTime(new Date(2026, 9, 11, 20, 5).getTime())).toBe('10-11 20:05')
  })
})
