import { DEFAULT_PARAMETERS, MATERIAL_KEYS, type MaterialAdjustments } from '../../scaffold.ts'

/** Display, export and totals all use the same clamped base-unit quantity. */
export function materialQuantity(calculated: number | null, adjustments: MaterialAdjustments, key: string) {
  return Math.max(0, (calculated ?? 0) + (adjustments[key] ?? 0))
}

/** Delta to add to the stored correction, clamping the last partial bag at zero. */
export function materialAdjustmentStep(calculated: number | null, adjustments: MaterialAdjustments, key: string, step: number) {
  const raw = (calculated ?? 0) + (adjustments[key] ?? 0)
  return Math.max(0, Math.max(0, raw) + step) - raw
}

/** Include unused default stocks so the site can add them manually. */
export function stockMaterialRows(stockSummary: Record<string, number>, adjustments: MaterialAdjustments) {
  const lengths = new Set([
    ...DEFAULT_PARAMETERS.stockLengths.map(length => `${length}m`),
    ...Object.keys(stockSummary),
    ...Object.keys(adjustments).filter(key => /^stock:\d+(?:\.\d+)?m$/.test(key)).map(key => key.slice('stock:'.length)),
  ])
  return [...lengths].map(length => ({
    length,
    calculated: stockSummary[length] ?? 0,
    quantity: materialQuantity(stockSummary[length] ?? 0, adjustments, MATERIAL_KEYS.stock(length)),
  })).sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0) || Number.parseFloat(b.length) - Number.parseFloat(a.length))
}

