/** I02: preserve each established numeric boundary; do not round polygon integration. */
export const NUMERIC_POLICY = { revision: 1, sceneMillimetres: 1000, legacyPixelsPerMetre: 50, coverageDecimals: 6 } as const
export const PIXELS_PER_METER = NUMERIC_POLICY.legacyPixelsPerMetre
export const SITE_EPS = 0.001
export const mm = (metres: number) => Math.round(metres * 1000)
export const metresFromMm = (millimetres: number) => millimetres / 1000
export const roundSite = (metres: number) => metresFromMm(mm(metres))
// toFixed and Math.round intentionally retain their different negative half-tie behaviour.
export const roundDomain = (value: number, precision = 3) => Number(value.toFixed(precision))
export const roundFixedMillimetre = (value: number) => Number(value.toFixed(3))
export const roundPlan = (value: number, precision = 2) => Number(value.toFixed(precision))
