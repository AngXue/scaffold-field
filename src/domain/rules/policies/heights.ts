import { TOP_POST_EXTENSION, type ScaffoldParameters } from '../../scaffold.ts'
import { roundDomain as round } from '../facts/precision.ts'
import { assembledLength, postStocks } from './stock.ts'

export type HeightProfile = { layers: number; lifts: number[]; theoretical: number; railed: number; outerRow: number; innerRow: number }
export type SupportProfile = { rowTops: [number, number]; endTop: number }

/** M02: local work lifts come from the global elevation stage, never a new local grid. */
export function heightProfile(layers: number, parameters: ScaffoldParameters, localLifts?: readonly number[]): HeightProfile {
  const count = Math.max(1, Math.round(layers))
  const lifts = Array.from({ length: count }, (_, index) => localLifts?.[index] ?? round((index + 1) * parameters.liftHeight))
  const theoretical = round(TOP_POST_EXTENSION + lifts[count - 1])
  const outerRow = parameters.swapInnerOuter ? 1 : 0
  return { layers: count, lifts, theoretical, railed: round(theoretical + parameters.liftHeight + TOP_POST_EXTENSION), outerRow, innerRow: 1 - outerRow }
}
export function postHeightAt(profile: HeightProfile, row: number, openEnd: boolean): number {
  return row === profile.outerRow || openEnd ? profile.railed : profile.theoretical
}

/** S01 preview of the shortest legal stock assembly, before full parity/stagger selection. */
export function supportProfile(profile: HeightProfile, parameters: ScaffoldParameters): SupportProfile {
  const stocks = postStocks(parameters)
  const plain = assembledLength(profile.theoretical, stocks, parameters.spliceOverlap)
  const railed = assembledLength(profile.railed, stocks, parameters.spliceOverlap)
  return { rowTops: profile.outerRow === 0 ? [railed, plain] : [plain, railed], endTop: railed }
}
