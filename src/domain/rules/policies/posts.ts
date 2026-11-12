import type { Vector3Tuple, ScaffoldParameters } from '../../scaffold.ts'
import { makeUse, combineUses, type MemberUse } from '../facts/memberUses.ts'
import { roundDomain as round } from '../facts/precision.ts'
import { postHeightAt, type HeightProfile } from './heights.ts'
import type { CornerTopology, StationGrid, AlignedStations } from './topology.ts'
import type { EndBoundary } from './protectionRanges.ts'
import { chooseStockLengths, neighbourStockSequence, postStocks } from './stock.ts'

export const postPointKey = (point: readonly number[]) => point.map(value => round(value)).join(':')
export type PostDemand = { key: string; point: Vector3Tuple; top: number; pathSegment: number; parity: number; uses: MemberUse[]; cornerJunctions?: number[] }
export type PostInput = { rows: Vector3Tuple[][][]; heights: HeightProfile[]; ends: EndBoundary[]; grid: StationGrid;
  stations: AlignedStations; mitres: CornerTopology['mitrePosts']; retained: boolean[][] }
/** G08 reconciles all demands before emission, preserving the original first-owner and height/parity decisions. */
export function resolvePostDemands(input: PostInput): PostDemand[] {
  const posts = new Map<string, PostDemand>()
  const create = (point: Vector3Tuple, top: number, pathSegment: number, parity: number): PostDemand => ({ key: postPointKey(point), point: [...point], top,
    pathSegment, parity, uses: [makeUse(pathSegment, 'post', point, [point[0], top, point[2]], 'M01')] })
  const next = (index: number) => (index + 1) % input.grid.segmentCount
  for (const mitre of input.mitres) {
    const top = Math.max(postHeightAt(input.heights[mitre.pathSegment], 1, false), postHeightAt(input.heights[next(mitre.pathSegment)], 1, false))
    const key = postPointKey(mitre.point)
    if (!posts.has(key)) posts.set(key, create(mitre.point, top, mitre.pathSegment, mitre.parity))
    const post = posts.get(key)!
    post.cornerJunctions = [...(post.cornerJunctions ?? []), mitre.pathSegment]
    post.uses = combineUses(post.uses, [makeUse(next(mitre.pathSegment), 'post', post.point, [post.point[0], post.top, post.point[2]], 'G08')])
  }
  for (const segment of input.grid.segmentOrder) {
    if (input.stations[segment].segmentLength <= 0.001) continue
    for (let station = 0; station <= input.stations[segment].bayCount; station++) {
      const openEnd = input.ends[segment].endStations.includes(station)
      for (let row = 0; row < input.rows[segment].length; row++) {
        if (row === 1 && !input.retained[segment][station]) continue
        const point = input.rows[segment][row][station], key = postPointKey(point)
        const top = postHeightAt(input.heights[segment], row, openEnd), parity = (row + input.grid.stationOffsets[segment] + station) % 2
        const existing = posts.get(key)
        if (!existing) posts.set(key, create(point, top, segment, parity))
        else {
          existing.uses = combineUses(existing.uses, [makeUse(segment, 'post', point, [point[0], top, point[2]], 'G08')])
          if (existing.top < top) { existing.top = top; existing.parity = parity }
        }
      }
    }
  }
  return [...posts.values()].map(post => ({ ...post, uses: post.uses.map(use => ({ ...use, rules: [...new Set([...use.rules, 'M02', 'G03'])] })) }))
}
export function initialPostSequences(posts: readonly PostDemand[], parameters: ScaffoldParameters): Record<string, number[]> {
  const cache = new Map<string, number[]>(), sequences: Record<string, number[]> = {}
  for (const post of posts) {
    const key = `${post.top}:${post.parity}`
    let sequence = cache.get(key)
    if (!sequence) {
      const stocks = postStocks(parameters), overlap = Math.max(0, Math.min(parameters.spliceOverlap, Math.min(...stocks) * 0.8))
      const primary = chooseStockLengths(post.top, stocks, overlap)
      sequence = post.parity === 0 ? primary : neighbourStockSequence(primary, post.top, stocks, overlap)
      cache.set(key, sequence)
    }
    sequences[post.key] = sequence
  }
  return sequences
}
