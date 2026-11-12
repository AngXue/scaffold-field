import type { Vector3Tuple } from '../../scaffold.ts'
import type { AlignedStations, PlanPoint } from './topology.ts'
import { roundDomain as round } from '../facts/precision.ts'
import type { FrameRows } from './frameRows.ts'

export type EndBoundary = { endStations: number[]; neighbours: [number, number][] }
export type GuardRange = { points: Vector3Tuple[]; endStations: number[]; clipStart: boolean; clipEnd: boolean }
export function endBoundaries(counts: readonly number[], stations: AlignedStations, closed: boolean): EndBoundary[] {
  return stations.map((segment, index) => {
    const endStations: number[] = [], neighbours: [number, number][] = [], last = counts.length - 1
    if (!closed && index === 0) endStations.push(0)
    if (!closed && index === last) endStations.push(segment.bayCount)
    if (closed || index > 0) neighbours.push([0, counts[(index + last) % counts.length]])
    if (closed || index < last) neighbours.push([segment.bayCount, counts[(index + 1) % counts.length]])
    for (const [station, count] of neighbours) if (count < counts[index]) endStations.push(station)
    return { endStations, neighbours }
  })
}
export function outwardRanges(rows: FrameRows, boundary: EndBoundary, layers: number, outerRow: number): GuardRange[] {
  const neighbours = new Map(boundary.neighbours)
  return Array.from({ length: layers }, (_, index) => ({
    points: (outerRow === 1 ? rows.offsetRowPoints : rows.postRows[0]).map(point => [...point] as Vector3Tuple),
    endStations: boundary.endStations.filter(station => index + 1 > (neighbours.get(station) ?? 0)), clipStart: false, clipEnd: false,
  }))
}
/** P03 refines only side-guard ranges, leaving working rows and deck support intact. */
export function inwardRanges(ranges: GuardRange[], boundary: EndBoundary, start: PlanPoint, segment: AlignedStations[number],
  limits: { start: number; end: number }, outerRow: number, width: number): GuardRange[] {
  const neighbours = new Map(boundary.neighbours)
  return ranges.map((range, index) => {
    const layer = index + 1
    const clipStart = outerRow === 1 && (neighbours.get(0) ?? 0) >= layer && limits.start > 0
    const clipEnd = outerRow === 1 && (neighbours.get(segment.bayCount) ?? 0) >= layer && limits.end < segment.segmentLength
    const from = clipStart ? limits.start : -Infinity, to = clipEnd ? limits.end : Infinity
    const stationOf = (point: Vector3Tuple) => (point[0] - start[0]) * segment.direction[0] + (point[2] - start[1]) * segment.direction[1]
    const at = (distance: number): Vector3Tuple => [round(start[0] + segment.direction[0] * distance + segment.normal[0] * width), 0,
      round(start[1] + segment.direction[1] * distance + segment.normal[1] * width)]
    const points = range.points.filter(point => stationOf(point) > from + 0.001 && stationOf(point) < to - 0.001)
    if (clipStart) points.unshift(at(from))
    if (clipEnd) points.push(at(to))
    return { ...range, points, clipStart, clipEnd }
  })
}
