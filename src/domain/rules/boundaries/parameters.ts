import { DEFAULT_PARAMETERS, TOP_POST_EXTENSION, type ScaffoldParameters } from '../../scaffold.ts'

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

/** Live kernel inventory stays explicit; only saved-project migration adds new defaults. */
export function normalizeKernelParameters(parameters: ScaffoldParameters): ScaffoldParameters {
  const legacyParameters = parameters as ScaffoldParameters & { rowCount?: number; height?: number }
  return {
    ...DEFAULT_PARAMETERS,
    ...parameters,
    deckSupportRailCount: parameters.deckSupportRailCount ?? legacyParameters.rowCount ?? DEFAULT_PARAMETERS.deckSupportRailCount,
    // A stored project from before `layerCount` carried a continuous 搭设高度; take the
    // number of whole 步距 that height held.
    layerCount: parameters.layerCount ?? (legacyParameters.height === undefined
      ? DEFAULT_PARAMETERS.layerCount
      : Math.max(1, Math.round((legacyParameters.height - TOP_POST_EXTENSION) / (parameters.liftHeight || DEFAULT_PARAMETERS.liftHeight)))),
  }
}
