import { SWEEP_BAR_LAYER, type Vector3Tuple, type ScaffoldParameters } from '../../scaffold.ts'
import type { FrameRows } from './frameRows.ts'
import { roundDomain as round } from '../facts/precision.ts'
export type MemberDemand = { type: 'longitudinal' | 'transverse'; start: Vector3Tuple; end: Vector3Tuple;
  connectionPoints: Vector3Tuple[]; startExtension: number; endExtension: number }
export type Band = { elevation: number; layer: number; withDeck: boolean; members: MemberDemand[] }
export type BandGeometry = { rows: FrameRows; bayCount: number; joinedStart: boolean; joinedEnd: boolean; lifts: number[] }

export function horizontalDemands(geometry: BandGeometry, elevation: number, withDeck: boolean, extension: number): MemberDemand[] {
  const { postRows, memberRows, normalRows, supportRows, normalStationRows } = geometry.rows
  const rows = withDeck ? memberRows : normalRows, stationRows = withDeck ? supportRows : normalStationRows
  const members: MemberDemand[] = rows.map(row => {
    const connectionPoints = row.map(point => [point[0], elevation, point[2]] as Vector3Tuple)
    return { type: 'longitudinal', start: connectionPoints[0], end: connectionPoints[connectionPoints.length - 1],
      connectionPoints, startExtension: extension, endExtension: extension }
  })
  postRows[0].forEach((outerPoint, station) => {
    if ((station === 0 && geometry.joinedStart) || (station === geometry.bayCount && geometry.joinedEnd)) return
    const innerPoint = postRows[1][station]
    members.push({ type: 'transverse', start: [outerPoint[0], elevation, outerPoint[2]], end: [innerPoint[0], elevation, innerPoint[2]],
      connectionPoints: stationRows.map(row => [row[station][0], elevation, row[station][2]]), startExtension: 0, endExtension: 0 })
  })
  return members
}
/** M04 local sweep layer has exactly the two ordinary rows, with no deck or filling rails. */
export function sweepBands(geometry: BandGeometry[], parameters: ScaffoldParameters): Band[][] {
  const elevation = parameters.sweepBarHeight > 0 && parameters.sweepBarHeight < parameters.liftHeight ? round(parameters.sweepBarHeight) : 0
  return geometry.map(segment => elevation > 0 && segment.bayCount > 0
    ? [{ elevation, layer: SWEEP_BAR_LAYER, withDeck: false, members: horizontalDemands(segment, elevation, false, parameters.tubeEndExtension) }] : [])
}
/** M03 working horizontals use extended rows; transverse ties stay on real station rows. */
export function workingBands(geometry: BandGeometry[], parameters: ScaffoldParameters, deckLayerOffset: number): Band[][] {
  return geometry.map(segment => segment.bayCount > 0 ? segment.lifts.map((elevation, index) => {
    const layer = index + 1, withDeck = (layer + deckLayerOffset) % Math.max(1, Math.round(parameters.deckLiftInterval)) === 0
    return { elevation, layer, withDeck, members: horizontalDemands(segment, elevation, withDeck, parameters.tubeEndExtension) }
  }) : [])
}
