import type { ScaffoldMember, ScaffoldConnector, ScaffoldParameters, Vector3Tuple } from '../../scaffold.ts'
import { Vector } from '../facts/vector.ts'
import { CONNECTOR_CONTACT } from '../facts/connections.ts'
const round = (value: number) => Number(value.toFixed(3))
const pointKey = (point: Vector3Tuple) => point.map(round).join(':')

export function buildCrossConnectors(members: ScaffoldMember[], builtPostTops: Record<string, number>, parameters: Pick<ScaffoldParameters, 'pipeDiameter'>) {
  // Count actual connections, not nominal station points: a corner can remove
  // a post or omit a transverse, while its longitudinal connectionPoints survive.
  const planDistanceToRun = (member: ScaffoldMember, x: number, z: number) => {
    const dx = member.end[0] - member.start[0]
    const dz = member.end[2] - member.start[2]
    const length = Math.hypot(dx, dz)
    if (length <= 0.001) return Number.POSITIVE_INFINITY
    const along = ((x - member.start[0]) * dx + (z - member.start[2]) * dz) / length
    if (along < -0.001 || along > length + 0.001) return Number.POSITIVE_INFINITY
    return Math.abs((x - member.start[0]) * dz - (z - member.start[2]) * dx) / length
  }
  const memberAxis = (member: ScaffoldMember): Vector3Tuple =>
    new Vector(member.end).subtract(new Vector(member.start)).normalize().toTuple()
  const rawCrossConnectors: ScaffoldConnector[] = []
  const connectionKeys = new Set<string>()
  const addCross = (member: ScaffoldMember, other: ScaffoldMember, point: Vector3Tuple) => {
    const key = [member.id, other.id].sort().join(':')
    if (connectionKeys.has(key)) return
    connectionKeys.add(key)
    const verticalOffset = (member.type === 'transverse' ? -1 : 1) * parameters.pipeDiameter * 0.65
    rawCrossConnectors.push({
      id: `C-${member.id}-${other.id}`,
      type: 'cross',
      [CONNECTOR_CONTACT]: [...point],
      position: [point[0], round(point[1] + verticalOffset), point[2]],
      memberId: member.id,
      connectedMemberId: other.id,
      axis: memberAxis(member),
      secondaryAxis: memberAxis(other),
    })
  }
  const posts = members.filter((member) => member.type === 'post')
  const longitudinals = members.filter((member) => member.type === 'longitudinal')
  for (const member of members) {
    if (member.type === 'post') continue
    const elevation = member.start[1]
    for (const post of posts) {
      if (elevation < post.start[1] - 0.001 || elevation > (builtPostTops[post.id] ?? post.end[1]) + 0.001) continue
      if (planDistanceToRun(member, post.start[0], post.start[2]) < 0.005) {
        addCross(member, post, [post.start[0], elevation, post.start[2]])
      }
    }
    if (!(member.roles ?? [member.type]).includes('transverse')) continue
    // Only the intermediate deck-support rows: the two ordinary rows already
    // have their two main-node ties (longitudinal→post and transverse→post).
    for (const point of member.connectionPoints) {
      if (posts.some(post => elevation >= post.start[1] - 0.001 && elevation <= (builtPostTops[post.id] ?? post.end[1]) + 0.001
        && Math.hypot(post.start[0] - point[0], post.start[2] - point[2]) < 0.005)) continue
      const support = longitudinals.find((candidate) =>
        candidate.id !== member.id && candidate.layer === member.layer && Math.abs(candidate.start[1] - elevation) <= 0.001
        && Math.abs(memberAxis(candidate).reduce((sum, value, i) => sum + value * memberAxis(member)[i], 0)) < 0.01
        && planDistanceToRun(candidate, point[0], point[2]) < 0.005)
      if (support) addCross(support, member, point)
    }
  }
  const connectorsByPosition = rawCrossConnectors
    .reduce<Map<string, ScaffoldConnector[]>>((groups, connector) => {
      const key = pointKey(connector.position)
      groups.set(key, [...(groups.get(key) ?? []), connector])
      return groups
    }, new Map())
  const crossConnectors = [...connectorsByPosition.values()].flatMap((connectorsAtPoint) =>
    connectorsAtPoint.map((connector, index) => {
      if (connectorsAtPoint.length === 1) return connector
      const offset = (index - (connectorsAtPoint.length - 1) / 2) * parameters.pipeDiameter * 1.4
      return {
        ...connector,
        position: [round(connector.position[0] + offset), connector.position[1], connector.position[2]] as Vector3Tuple,
      }
    }))
  return crossConnectors
}
