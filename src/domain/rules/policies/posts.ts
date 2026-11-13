import type { StationPlan } from '../facts/stations.ts'
import { MEMBER_HISTORY, memberBirth, memberChange, type MemberHistory } from '../facts/memberHistory.ts'
import { SemanticIdentities } from '../facts/identity.ts'
import type { Vector3Tuple, ScaffoldParameters, ScaffoldMember } from '../../scaffold.ts'
import { MEMBER_USES, makeUse, combineUses, type MemberUse } from '../facts/memberUses.ts'
import { roundDomain as round } from '../facts/precision.ts'
import { postHeightAt, type HeightProfile } from './heights.ts'
import type { CornerTopology, StationGrid, AlignedStations } from './topology.ts'
import type { EndBoundary } from './protectionRanges.ts'
import { chooseStockLengths, neighbourStockSequence, postStocks } from './stock.ts'

export const postPointKey = (point: readonly number[]) => point.map(value => round(value)).join(':')
export type PostDemand = { [MEMBER_HISTORY]?: MemberHistory; key: string; point: Vector3Tuple; top: number; pathSegment: number; parity: number; uses: MemberUse[]; cornerJunctions?: number[] }
export type PostInput = { stationPlan?: StationPlan; identityScope?: string; rows: Vector3Tuple[][][]; heights: HeightProfile[]; ends: EndBoundary[]; grid: StationGrid;
  stations: AlignedStations; mitres: CornerTopology['mitrePosts']; retained: boolean[][] }
/** G08 reconciles all demands before emission, preserving the original first-owner and height/parity decisions. */
export function resolvePostDemands(input: PostInput): PostDemand[] {
  const posts = new Map<string, PostDemand>()
  const identities = new SemanticIdentities()
  const asMember = (post: PostDemand): ScaffoldMember => ({ id: post.key, type: 'post', start: post.point,
    end: [post.point[0],post.top,post.point[2]], length: post.top - post.point[1], connectionPoints: [post.point,[post.point[0],post.top,post.point[2]]],
    pathSegment: post.pathSegment, [MEMBER_USES]: post.uses })
  const create = (point: Vector3Tuple, top: number, pathSegment: number, parity: number, stationId?: string): PostDemand => {
    const post: PostDemand = { key: postPointKey(point), point: [...point], top, pathSegment, parity,
      uses: [makeUse(pathSegment, 'post', point, [point[0], top, point[2]], 'M01')] }
    const id = identities.of('post-demand', [input.identityScope ?? null, pathSegment, point, top, parity])
    post[MEMBER_HISTORY] = memberBirth(asMember(post), id, input.stationPlan && stationId ? {plan:input.stationPlan,ids:[stationId]} : undefined)
    return post
  }
  const reconcile = (post: PostDemand, parents: MemberHistory[]) => {
    post[MEMBER_HISTORY] = memberChange(asMember(post), parents, 'G08', 'merge')
  }
  const next = (index: number) => (index + 1) % input.grid.segmentCount
  for (const [mitreIndex, mitre] of input.mitres.entries()) {
    const stationId = input.stationPlan?.cornerIds[mitreIndex]
    const top = Math.max(postHeightAt(input.heights[mitre.pathSegment], 1, false), postHeightAt(input.heights[next(mitre.pathSegment)], 1, false))
    const key = postPointKey(mitre.point)
    const incoming = create(mitre.point, postHeightAt(input.heights[mitre.pathSegment], 1, false), mitre.pathSegment, mitre.parity, stationId)
    const outgoing = create(mitre.point, postHeightAt(input.heights[next(mitre.pathSegment)], 1, false), next(mitre.pathSegment), mitre.parity, stationId)
    const prior = posts.get(key)?.[MEMBER_HISTORY]
    if (!posts.has(key)) posts.set(key, create(mitre.point, top, mitre.pathSegment, mitre.parity, stationId))
    const post = posts.get(key)!
    post.cornerJunctions = [...(post.cornerJunctions ?? []), mitre.pathSegment]
    post.uses = combineUses(post.uses, [makeUse(next(mitre.pathSegment), 'post', post.point, [post.point[0], post.top, post.point[2]], 'G08')])
    reconcile(post, [...(prior ? [prior] : []), incoming[MEMBER_HISTORY]!, outgoing[MEMBER_HISTORY]!])
  }
  for (const segment of input.grid.segmentOrder) {
    if (input.stations[segment].segmentLength <= 0.001) continue
    for (let station = 0; station <= input.stations[segment].bayCount; station++) {
      const openEnd = input.ends[segment].endStations.includes(station)
      for (let row = 0; row < input.rows[segment].length; row++) {
        if (row === 1 && !input.retained[segment][station]) continue
        const point = input.rows[segment][row][station], key = postPointKey(point)
        const top = postHeightAt(input.heights[segment], row, openEnd), parity = (row + input.grid.stationOffsets[segment] + station) % 2
        const stationId = input.stationPlan?.heads[segment][row][station]
        const existing = posts.get(key)
        if (!existing) posts.set(key, create(point, top, segment, parity, stationId))
        else {
          const ancestors = [existing[MEMBER_HISTORY]!, create(point, top, segment, parity, stationId)[MEMBER_HISTORY]!]
          existing.uses = combineUses(existing.uses, [makeUse(segment, 'post', point, [point[0], top, point[2]], 'G08')])
          if (existing.top < top) { existing.top = top; existing.parity = parity }
          reconcile(existing, ancestors)
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
