import type { ScaffoldParameters } from '../../scaffold.ts'
import { roundDomain as round } from '../facts/precision.ts'
import type { HeightProfile, SupportProfile } from './heights.ts'

/**
 * Height of the 上栏杆 上皮 above the 作业层 (JGJ 130-2011 §7.3.12(2)). It is the
 * height a 2-rail guarded side tops out at, and it is why a row that carries rails
 * needs one more 步距 of 立杆 than the row against the building.
 */
export const GUARDRAIL_TOP_EDGE = 1.2

/**
 * JGJ 130-2011 §7.3.12 requires, at every 作业层, TWO rails per guarded side:
 *   1 栏杆和挡脚板均应搭设在外立杆的内侧; 2 上栏杆上皮高度应为 1.2m;
 *   4 中栏杆应居中设置.
 * GB 51210-2016 §8.2.8 条文说明 fixes the lower rail as 居中 between the deck and
 * the top rail. The standard gives the top rail as 上皮 (top edge), so its
 * centreline sits one radius lower. The mid rail has no stated number; 0.6 m is
 * the common site reading and does not affect any material quantity, because
 * every rail is horizontal and therefore the same length wherever it sits.
 *
 * Heights are measured from the 作业层, which is the lift axis.
 */
export const GUARDRAILS = [
  { id: 'top', label: '上栏杆', centreAboveDeck: GUARDRAIL_TOP_EDGE - 0.024 },
  { id: 'mid', label: '中栏杆', centreAboveDeck: 0.6 },
] as const

/**
 * Which rails a guarded side carries, as a function of the 步距.
 *
 * - **2 根**: the §7.3.12 set — 上栏杆 (上皮 1.2 m above the 作业层) + 中栏杆.
 * - **1 根**: 居中 **in the 步距** — `liftHeight / 2` above the 作业层 (0.94 m at the
 *   1.88 m default). This is the site's single-rail position, not the 上栏杆 pulled
 *   down: it follows the 步距, so changing the 步距 moves the rail.
 *
 * The first entry of the returned set is also what a deckless top lift carries as
 * its 架顶栏杆.
 */
export function guardrailsFor(count: number, liftHeight: number): ReadonlyArray<{
  id: string
  label: string
  centreAboveDeck: number
}> {
  const clamped = Math.max(1, Math.min(GUARDRAILS.length, Math.round(count)))
  return clamped === 1
    ? [{ id: 'centre', label: '栏杆', centreAboveDeck: liftHeight / 2 }]
    : GUARDRAILS
}


export type Rail = { id: string; label: string; centreAboveDeck: number }
export type GuardCandidate = { layer: number; elevation: number; rails: Rail[]; coping: Rail | null }
export type SupportedRails = { usable: { rail: Rail; elevation: number }[]; above: string[] }
export type GuardCourse = { layer: number; enabled: boolean; side: SupportedRails; end: SupportedRails }

/** P01 candidates never grow posts. S4 support facts decide whether they survive. */
export function candidateCourses(profile: HeightProfile, parameters: ScaffoldParameters, deckLayerOffset: number): GuardCandidate[] {
  const rails = guardrailsFor(parameters.guardrailRailCount, parameters.liftHeight)
  return profile.lifts.map((elevation, index) => {
    const layer = index + 1, top = layer === profile.layers
    const withDeck = (layer + deckLayerOffset) % Math.max(1, Math.round(parameters.deckLiftInterval)) === 0
    return { layer, elevation, rails: (withDeck ? rails : top ? [rails[0]] : []).map(rail => ({ ...rail })),
      coping: top ? { id: 'coping', label: '架顶栏杆', centreAboveDeck: round(round(profile.theoretical + parameters.liftHeight) - elevation) } : null }
  })
}

/** Keep the original millimetre top-edge comparison and 50 mm coincidence test. */
export function railsWithin(candidate: GuardCandidate, rails: readonly Rail[], rowTop: number, layers: number,
  parameters: Pick<ScaffoldParameters, 'liftHeight' | 'pipeDiameter'>): SupportedRails {
  const usable: SupportedRails['usable'] = [], above: string[] = []
  for (const rail of rails) {
    const elevation = round(candidate.elevation + rail.centreAboveDeck)
    if (round(elevation + parameters.pipeDiameter / 2) > rowTop + 0.001) { above.push(rail.label); continue }
    if (candidate.layer < layers && Math.abs(elevation - round(candidate.elevation + parameters.liftHeight)) < 0.05) continue
    usable.push({ rail, elevation })
  }
  return { usable, above }
}

export function supportedCourses(candidates: readonly GuardCandidate[], height: HeightProfile, support: SupportProfile,
  parameters: ScaffoldParameters): GuardCourse[] {
  return candidates.map(candidate => {
    // The original coping test uses the independently rounded absolute centre.
    const topRail = round(height.theoretical + parameters.liftHeight)
    const copingUsable = candidate.coping !== null
      && round(topRail + parameters.pipeDiameter / 2) <= support.rowTops[height.outerRow] + 0.001
      && round(topRail + parameters.pipeDiameter / 2) <= support.endTop + 0.001
    const rails = copingUsable ? [...candidate.rails, candidate.coping!] : candidate.rails
    return { layer: candidate.layer, enabled: candidate.rails.length > 0,
      side: railsWithin(candidate, rails, support.rowTops[height.outerRow], height.layers, parameters),
      end: railsWithin(candidate, rails, support.endTop, height.layers, parameters) }
  })
}
