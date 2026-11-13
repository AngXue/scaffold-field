import { DISPLAY_ID } from '../facts/displayIdentity.ts'
import { PART_HISTORY, partBirth, partHistory, partChanged, removedParts, withRemoved, mapParts } from '../facts/partHistory.ts'
import { historyOf } from '../facts/memberHistory.ts'
import type { BaseChannel, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'
import type { CornerTopology, AlignedStations } from './topology.ts'
import { roundDomain as round } from '../facts/precision.ts'
const pointKey = (point: Vector3Tuple) => point.map(value => round(value)).join(':')
const vectorDistance = (a: Vector3Tuple, b: Vector3Tuple) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
export type BaseInput = { identityScope?: string; rows: Vector3Tuple[][][]; stations: AlignedStations; corners: CornerTopology; order: number[]; transverseTubeLength: number }
export function baseCandidates(input: BaseInput): BaseChannel[] {
  const baseChannels: BaseChannel[] = [], channelKeys = new Set<string>(), skippedChannels = new Set(input.corners.skippedChannels)
  const { transverseTubeLength } = input
  for (const mitre of input.corners.mitrePosts) {
    const half = transverseTubeLength / 2
    const channelStart: Vector3Tuple = [
      round(mitre.beamCentre[0] - mitre.normal[0] * half),
      0,
      round(mitre.beamCentre[2] - mitre.normal[1] * half),
    ]
    const channelEnd: Vector3Tuple = [
      round(mitre.beamCentre[0] + mitre.normal[0] * half),
      0,
      round(mitre.beamCentre[2] + mitre.normal[1] * half),
    ]
    const channelKey = [pointKey(channelStart), pointKey(channelEnd)].sort().join('|')
    if (!channelKeys.has(channelKey)) {
      channelKeys.add(channelKey)
      baseChannels.push({
        id: `B${baseChannels.length + 1}`,
        start: channelStart,
        end: channelEnd,
        length: round(vectorDistance(channelStart, channelEnd)),
        pathSegment: mitre.pathSegment,
      })
    }
  }
  for (const segmentIndex of input.order) {
    if (input.stations[segmentIndex].segmentLength <= 0.001) continue
    const postRows = input.rows[segmentIndex], { normal, bayCount } = input.stations[segmentIndex]
    for (let station = 0; station <= bayCount; station++) {
      const outerBase = postRows[0][station]
      const innerBase = postRows[1][station]
      const channelKey = [pointKey(outerBase), pointKey(innerBase)].sort().join('|')
      if (!skippedChannels.has(`${segmentIndex}:${station}`) && !channelKeys.has(channelKey)) {
        channelKeys.add(channelKey)
        const channelCentre: Vector3Tuple = [
          round((outerBase[0] + innerBase[0]) / 2),
          0,
          round((outerBase[2] + innerBase[2]) / 2),
        ]
        const half = transverseTubeLength / 2
        const channelStart: Vector3Tuple = [
          round(channelCentre[0] - normal[0] * half),
          0,
          round(channelCentre[2] - normal[1] * half),
        ]
        const channelEnd: Vector3Tuple = [
          round(channelCentre[0] + normal[0] * half),
          0,
          round(channelCentre[2] + normal[1] * half),
        ]
        baseChannels.push({
          id: `B${baseChannels.length + 1}`,
          start: channelStart,
          end: channelEnd,
          length: round(vectorDistance(channelStart, channelEnd)),
          pathSegment: segmentIndex,
        })
      }
    }
  }
  return baseChannels.map(base => { const history = partBirth(base,input.identityScope,'M07'); return { ...base, [DISPLAY_ID]: base.id, id: history.id, [PART_HISTORY]: history } })
}
export function retainSupportingBases(candidates: readonly BaseChannel[], members: readonly ScaffoldMember[]): BaseChannel[] {
  const baseChannels = mapParts(candidates, base => ({ ...base })), retired = [...removedParts(candidates)]
    const postsForBases = members.filter(member => member.type === 'post')
    const beamSupports = (beam: BaseChannel) => postsForBases.filter(post => {
      const dx = beam.end[0] - beam.start[0], dz = beam.end[2] - beam.start[2]
      const length = Math.hypot(dx, dz)
      const x = post.start[0] - beam.start[0], z = post.start[2] - beam.start[2]
      const along = (x * dx + z * dz) / length
      return along >= -0.001 && along <= length + 0.001 && Math.abs(x * dz - z * dx) / length < 0.001
    }).map(post => post.id)
    const supportedByBeam = new Map(baseChannels.map(beam => [beam, beamSupports(beam)]))
    const before = new Map(baseChannels.map(base => [base,partHistory(base)]))
    const postIds = new Map(postsForBases.map(post => [post.id,historyOf(post).id]))
    for (let index = baseChannels.length - 1; index >= 0; index--) {
      const beam = baseChannels[index], supported = supportedByBeam.get(beam)!
      const covering = supported.length ? baseChannels.filter(other => other !== beam && supportedByBeam.get(other)!.length > supported.length
        && supported.every(id => supportedByBeam.get(other)!.includes(id))) : []
      const ancestors = [before.get(beam)!], supportIds = supported.map(id => postIds.get(id)!)
      if (supported.length === 0 || covering.length) {
        retired.push(partChanged(beam, ancestors, 'M07', 'remove', covering.map(other => before.get(other)!), supportIds,
          supported.length ? 'covered-support' : 'unsupported'))
        baseChannels.splice(index,1)
      } else {
        const previous = ancestors[0]
        beam[PART_HISTORY] = previous.operation === 'support' && JSON.stringify(previous.supportIds) === JSON.stringify([...supportIds].sort())
          ? previous : partChanged(beam,ancestors,'M07','support',[],supportIds)
      }
    }
  return withRemoved(baseChannels,retired)
}
