/** Barriers shared by every path and every physical frame in one scene.
 * A constructor yields BEFORE executing that stage. No preview is published as
 * a completed draft, and a rejected constructor cannot be resumed.
 */
export const CONSTRUCTION_PHASES = [2, 3, 4, 5] as const
export type ConstructionPhase = typeof CONSTRUCTION_PHASES[number]
export function startConstruction<T>(generator: Generator<ConstructionPhase, T, void>) {
  let next = generator.next(), last = 1, failed = false
  const advance = (phase: ConstructionPhase): T | undefined => {
    if (failed) throw new Error('Cannot resume rejected construction')
    if (!CONSTRUCTION_PHASES.includes(phase) || phase < last) throw new Error('Invalid or backwards construction phase')
    try {
      while (!next.done) {
        if (!CONSTRUCTION_PHASES.includes(next.value)) throw new Error('Unknown construction phase')
        if (next.value > phase) break
        const previous = next.value
        next = generator.next()
        if (!next.done && next.value <= previous) throw new Error('Constructor repeated or reversed a phase')
      }
      last = phase
      return next.done ? next.value : undefined
    } catch (error) { failed = true; throw error }
  }
  return { advance, finish: () => {
    advance(5)
    if (!next.done) throw new Error('Construction did not complete')
    return next.value
  } }
}
