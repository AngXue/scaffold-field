import { DEFAULT_PARAMETERS, TOP_POST_EXTENSION, type ScaffoldParameters } from './scaffold'

/** Saved projects gain new inventory and retain all earlier parameter migrations. */
export function restoreParameters(stored: Partial<ScaffoldParameters> & {
  rowCount?: number; height?: number; guardrailSides?: number
} = {}): ScaffoldParameters {
  if (!stored || typeof stored !== 'object') stored = {}
  const { rowCount, height, guardrailSides: removed, ...current } = stored
  void removed
  return {
    ...DEFAULT_PARAMETERS, ...current,
    layerCount: current.layerCount ?? (height === undefined ? DEFAULT_PARAMETERS.layerCount
      : Math.max(1, Math.round((height - TOP_POST_EXTENSION) / (current.liftHeight ?? DEFAULT_PARAMETERS.liftHeight)))),
    deckSupportRailCount: current.deckSupportRailCount ?? rowCount ?? DEFAULT_PARAMETERS.deckSupportRailCount,
    stockLengths: [...new Set([...(current.stockLengths ?? DEFAULT_PARAMETERS.stockLengths), 5, 3.5])].sort((a, b) => b - a),
  }
}
