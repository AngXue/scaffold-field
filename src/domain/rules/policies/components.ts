import { PART_HISTORY, partHistory, partChanged, partShapeChanged, removedParts, withRemoved, mapParts, type PartHistory } from '../facts/partHistory.ts'
import { MEMBER_HISTORY, historyOf, memberChange } from '../facts/memberHistory.ts'
import type { ScaffoldMember, DeckPanel, BaseChannel, Vector3Tuple } from '../../scaffold.ts'
import { FRAME_SCOPES, combinedScopes } from '../facts/scopes.ts'
import { MEMBER_USES, combineUses, memberUses } from '../facts/memberUses.ts'
import { roundDomain as round } from '../facts/precision.ts'
import { signedArea, subtractCoverage, type PlanPolygon } from '../../polygons.ts'
const pointKey = (point: Vector3Tuple) => point.map(value => round(value)).join(':')
export function sharedComponentPosts(candidates: readonly ScaffoldMember[], sourceSequences: Readonly<Record<string, number[]>>) {
  const members = candidates.map(member => ({ ...member })), sequences = { ...sourceSequences }
  const sequenceOwners = Object.fromEntries(candidates.filter(member => member.type === 'post').map(member => [member.id, member.id]))
  const posts = new Map<string, ScaffoldMember>()
  for (let i = members.length - 1; i >= 0; i--) {
    const post = members[i]
    if (post.type !== 'post') continue
    const key = pointKey(post.start), existing = posts.get(key)
    if (!existing) { posts.set(key, post); continue }
    const ancestors = [historyOf(existing), historyOf(post)]
    const scopes = combinedScopes(existing, post)
    if (scopes) existing[FRAME_SCOPES] = scopes
    existing[MEMBER_USES] = combineUses(memberUses(existing), memberUses(post))
    if (post.length > existing.length) {
      existing.length = post.length; existing.end = [...post.end]
      sequences[existing.id] = sequences[post.id]
      sequenceOwners[existing.id] = sequenceOwners[post.id]
    }
    existing[MEMBER_HISTORY] = memberChange(existing, ancestors, 'G08', 'merge')
    members.splice(i, 1)
  }

  return { members, sequences, sequenceOwners }
}
export function uniqueComponentBases(candidates: readonly BaseChannel[]): BaseChannel[] {
  const baseChannels = mapParts(candidates, base => ({ ...base }))
  const beams = new Map<string, BaseChannel>()
  for (let i = baseChannels.length - 1; i >= 0; i--) {
    const b = baseChannels[i], key = [pointKey(b.start), pointKey(b.end)].sort().join('|')
    const existing = beams.get(key)
    if (existing) {
      const before = partHistory(existing), duplicate = partHistory(b)
      if (before.id !== duplicate.id) existing[PART_HISTORY] = partChanged(existing, [before, duplicate], 'M07', 'merge', [], [], 'duplicate')
      baseChannels.splice(i, 1)
    } else beams.set(key,b)
  }

  return baseChannels
}
export function componentDeckCoverage(candidates: readonly DeckPanel[]) {
  const decks = mapParts(candidates, deck => ({ ...deck })), retired = [...removedParts(candidates)]
  const priorByLayer = new Map<number, DeckPanel[]>()
  const coveredByLayer = new Map<number, PlanPolygon[]>()
  let overlap = false
  for (let i = 0; i < decks.length;) {
    const deck = decks[i], covered = coveredByLayer.get(deck.layer) ?? []
    const original = (deck.coverage ?? [deck.corners]).map(face => face.map(p => [p[0], p[2]] as [number, number]))
    const faces = subtractCoverage(original, covered)
    const area = faces.reduce((sum, face) => sum + Math.abs(signedArea(face)), 0)
    if (area < deck.area - 0.001) overlap = true
    const before = partHistory(deck)
    const overlaps = (other: DeckPanel) => [0,2].every(axis =>
      Math.min(Math.max(...deck.corners.map(point => point[axis])), Math.max(...other.corners.map(point => point[axis])))
      - Math.max(Math.min(...deck.corners.map(point => point[axis])), Math.min(...other.corners.map(point => point[axis]))) > 1e-7)
    const inputs: PartHistory[] = area < deck.area - 1e-7 ? (priorByLayer.get(deck.layer) ?? []).filter(overlaps).map(partHistory) : []
    if (area < 0.00001) {
      retired.push(partChanged({ ...deck, area: 0, coverage: [] }, [before], 'M06', 'remove', inputs, [], 'overlap'))
      decks.splice(i, 1); continue
    }
    deck.coverage = faces.map(face => face.map(p => [p[0], deck.corners[0][1], p[1]] as Vector3Tuple))
    deck.area = round(area, 4)
    deck[PART_HISTORY] = partShapeChanged(deck,before) ? partChanged(deck,[before],'M06','coverage', inputs) : before
    priorByLayer.set(deck.layer, [...(priorByLayer.get(deck.layer) ?? []), deck])
    coveredByLayer.set(deck.layer, [...covered, ...faces]); i++
  }

  return { decks: withRemoved(decks,retired), overlap }
}
