import { describe, expect, it } from 'vitest'
import { restoreParameters } from './project'
import { DEFAULT_PARAMETERS } from './scaffold'

describe('saved parameter migration', () => {
  it('fills absent fields with the new defaults and keeps explicitly saved earlier specifications', () => {
    expect(restoreParameters()).toMatchObject({ width: 0.75, deckSupportRailCount: 3, deckPanelWidth: 0.75, deckPanelLength: 1 })
    const saved = { width: 0.9, deckSupportRailCount: 2, deckPanelWidth: 0.95, deckPanelLength: 1.2 }
    expect(restoreParameters(saved)).toMatchObject(saved)
  })

  it('adds the newly available stocks without resetting project choices', () => {
    const restored = restoreParameters({ stockLengths: [6, 4.5, 4, 3, 2.4, 2, 1.2, 0.8], width: 0.75, layerCount: 3 })
    expect(restored.stockLengths).toEqual(DEFAULT_PARAMETERS.stockLengths)
    expect(restored.width).toBe(0.75)
    expect(restored.layerCount).toBe(3)
  })
  it('retains height and row migrations and discards the removed guardrail setting', () => {
    const restored = restoreParameters({ height: 6.3, liftHeight: 2, rowCount: 3, guardrailSides: 2 })
    expect(restored.layerCount).toBe(3)
    expect(restored.deckSupportRailCount).toBe(3)
    expect(restored).not.toHaveProperty('guardrailSides')
    expect(restored).not.toHaveProperty('height')
  })
})
