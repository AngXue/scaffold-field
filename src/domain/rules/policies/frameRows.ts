import type { Vector3Tuple } from '../../scaffold.ts'
import type { AlignedStations, CornerTopology, PlanPoint } from './topology.ts'
import { roundDomain as round } from '../facts/precision.ts'

/** M01: support-rail count never changes the two actual post rows. */
export function postRowsAt(start: PlanPoint, stations: AlignedStations[number], width: number): Vector3Tuple[][] {
  return Array.from({ length: 2 }, (_, row) => stations.stations.map(distance => [
    round(start[0] + stations.direction[0] * distance + stations.normal[0] * row * width), 0,
    round(start[1] + stations.direction[1] * distance + stations.normal[1] * row * width),
  ]))
}
export function extendFrameRows(postRows: Vector3Tuple[][], supportRailCount: number, extensions: CornerTopology['offsetRowExtensions'][number]) {
    const extensionAt = (map: Map<number, Vector3Tuple>, ratio: number): Vector3Tuple | undefined => {
      if (map.size === 0) return undefined
      let best: Vector3Tuple | undefined
      let bestGap = Number.POSITIVE_INFINITY
      for (const [rowRatio, point] of map) {
        const gap = Math.abs(rowRatio - ratio)
        if (gap < bestGap) {
          bestGap = gap
          best = point
        }
      }
      return bestGap < 0.001 ? best : undefined
    }
    const extendRow = (row: Vector3Tuple[], ratio: number): Vector3Tuple[] => {
      const points = [...row]
      const atStart = extensionAt(new Map(extensions.atStart), ratio)
      const atEnd = extensionAt(new Map(extensions.atEnd), ratio)
      if (atStart) points.unshift(atStart)
      if (atEnd) points.push(atEnd)
      return points
    }

    const supportRows = Array.from({ length: supportRailCount }, (_, supportIndex) => {
      const ratio = supportRailCount > 1 ? supportIndex / (supportRailCount - 1) : 1
      return postRows[0].map((outerPoint, station) => {
        const innerPoint = postRows[1][station]
        return [
          round(outerPoint[0] + (innerPoint[0] - outerPoint[0]) * ratio),
          0,
          round(outerPoint[2] + (innerPoint[2] - outerPoint[2]) * ratio),
        ] as Vector3Tuple
      })
    })

    const memberRows = supportRows.map((row, rowIndex) => extendRow(
      row,
      supportRailCount > 1 ? rowIndex / (supportRailCount - 1) : 1,
    ))
    const offsetRowPoints = extendRow(postRows[1], 1)
    if (offsetRowPoints.length !== postRows[1].length) {
      memberRows[memberRows.length - 1] = offsetRowPoints
    }

    // The two post rows carry the ordinary 纵向水平杆. Any rows between them are
    // 钢笆纵向支承杆 (deck-support rails), which only exist where a deck does.
    const normalRows = [extendRow(supportRows[0], 0), offsetRowPoints]
    const normalStationRows = [supportRows[0], postRows[1]]


  return { postRows, supportRows, memberRows, offsetRowPoints, normalRows, normalStationRows }
}
export type FrameRows = ReturnType<typeof extendFrameRows>
