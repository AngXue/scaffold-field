import type { ScaffoldMember, DeckPanel, BaseChannel, Vector3Tuple } from '../../scaffold.ts'
import { FRAME_SCOPES, combinedScopes } from '../facts/scopes.ts'
import { MEMBER_USES, combineUses, memberUses } from '../facts/memberUses.ts'
import { roundDomain as round } from '../facts/precision.ts'
import { signedArea, subtractCoverage, type PlanPolygon } from '../../polygons.ts'
const pointKey = (point: Vector3Tuple) => point.map(value => round(value)).join(':')
export function sharedComponentPosts(candidates: readonly ScaffoldMember[], sourceSequences: Readonly<Record<string, number[]>>) {
  const members = candidates.map(member => ({ ...member })), sequences = { ...sourceSequences }
  const posts = new Map<string, ScaffoldMember>()
  for (let i = members.length - 1; i >= 0; i--) {
    const post = members[i]
    if (post.type !== 'post') continue
    const key = pointKey(post.start), existing = posts.get(key)
    if (!existing) { posts.set(key, post); continue }
    const scopes = combinedScopes(existing, post)
    if (scopes) existing[FRAME_SCOPES] = scopes
    existing[MEMBER_USES] = combineUses(memberUses(existing), memberUses(post))
    if (post.length > existing.length) {
      existing.length = post.length; existing.end = [...post.end]
      sequences[existing.id] = sequences[post.id]
    }
    members.splice(i, 1)
  }

  return { members, sequences }
}
export function uniqueComponentBases(candidates: readonly BaseChannel[]): BaseChannel[] {
  const baseChannels = [...candidates]
  const beams = new Set<string>()
  for (let i = baseChannels.length - 1; i >= 0; i--) {
    const b = baseChannels[i], key = [pointKey(b.start), pointKey(b.end)].sort().join('|')
    if (beams.has(key)) baseChannels.splice(i, 1)
    else beams.add(key)
  }

  return baseChannels
}
export function componentDeckCoverage(candidates: readonly DeckPanel[]) {
  const decks = candidates.map(deck => ({ ...deck }))
  const coveredByLayer = new Map<number, PlanPolygon[]>()
  let overlap = false
  for (let i = 0; i < decks.length;) {
    const deck = decks[i], covered = coveredByLayer.get(deck.layer) ?? []
    const original = (deck.coverage ?? [deck.corners]).map(face => face.map(p => [p[0], p[2]] as [number, number]))
    const faces = subtractCoverage(original, covered)
    const area = faces.reduce((sum, face) => sum + Math.abs(signedArea(face)), 0)
    if (area < deck.area - 0.001) overlap = true
    if (area < 0.00001) { decks.splice(i, 1); continue }
    deck.coverage = faces.map(face => face.map(p => [p[0], deck.corners[0][1], p[1]] as Vector3Tuple))
    deck.area = round(area, 4)
    coveredByLayer.set(deck.layer, [...covered, ...faces]); i++
  }

  return { decks, overlap }
}
