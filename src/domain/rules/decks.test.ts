import { expect, it } from 'vitest'
import { DEFAULT_PARAMETERS, type DeckPanel } from '../scaffold'
import { resolveDecks } from './decks'
import { resolveDeckCoverage } from './policies/decks'

it('counts whole lapped panels separately from the geometric roof area and skips deckless lifts', () => {
  const result = resolveDecks({ geometry: [{ stations: [0, 1.8], postRows: [[[0, 0, 0], [1.8, 0, 0]], [[0, 0, 0.75], [1.8, 0, 0.75]]],
    bands: [{ elevation: 0.2, layer: 0, withDeck: false }, { elevation: 0.26, layer: 1, withDeck: true }] }],
    order: [0], corners: [], counts: [1], lifts: [0.26], parameters: DEFAULT_PARAMETERS, deckLayerOffset: 1, physical: [[0, 0], [1.8, 0]], closed: false, perSegmentCounts: false })
  expect(result.map(deck => deck.id)).toEqual(['D1', 'D2'])
  expect(result.reduce((sum, deck) => sum + deck.area, 0)).toBe(1.35)
  expect(result.every(deck => deck.corners.every(point => point[1] === 0.315))).toBe(true)
})
it('overlap removal does not mutate source panels or count a cut face as an extra purchased panel', () => {
  const first: DeckPanel = { id: 'D1', layer: 1, pathSegment: 0, area: 1, corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] }
  const second: DeckPanel = { ...first, id: 'D2', pathSegment: 1 }
  const input = [first, second], before = structuredClone(input)
  const result = resolveDeckCoverage(input, [[0, 0], [1, 0], [1, 1]], false, true)
  expect(input).toEqual(before)
  expect(result).toHaveLength(1)
  expect(result[0].id).toBe('D1')
  expect(result[0].area).toBe(1)
})
