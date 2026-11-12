import { roundFixedMillimetre as round } from '../facts/precision.ts'
import type { ScaffoldMember } from '../../scaffold.ts'
import { MEMBER_USES, memberUses, combineUses } from '../facts/memberUses.ts'

const vectorDistance = (a: number[], b: number[]) => Math.hypot(...a.map((n, i) => n - b[i]))
const pointKey = (p: number[]) => p.map(round).join(':')

/** M08: pure merge preserving every source and purpose interval. */
export function mergeSharedRuns(members: ScaffoldMember[]) {
  const groups = new Map<string, Array<{ member: ScaffoldMember; low: number; high: number }>>()
  for (const original of members) {
    const member = { ...original }
    if (member.type === 'post') continue
    let dx = (member.end[0] - member.start[0]) / member.length
    let dz = (member.end[2] - member.start[2]) / member.length
    if (dx < -1e-6 || (Math.abs(dx) < 1e-6 && dz < 0)) { dx = -dx; dz = -dz }
    const key = `${member.type === 'guardrail' ? 'guardrail' : 'horizontal'}:${member.layer}:${member.start[1]}:${dx.toFixed(5)}:${dz.toFixed(5)}:${(-dz * member.start[0] + dx * member.start[2]).toFixed(3)}`
    const values = [member.start, member.end].map(p => p[0] * dx + p[2] * dz)
    const group = groups.get(key) ?? []
    group.push({ member, low: Math.min(...values), high: Math.max(...values) })
    groups.set(key, group)
  }
  const removed = new Set<string>()
  for (const group of groups.values()) {
    group.sort((a, b) => a.low - b.low || b.high - a.high)
    let active = group[0]
    for (const next of group.slice(1)) {
      if (next.low > active.high + 0.001) { active = next; continue }
      const candidates = [active.member.start, active.member.end, next.member.start, next.member.end]
      candidates.sort((a, b) => a[0] - b[0] || a[2] - b[2])
      active.member[MEMBER_USES] = combineUses(memberUses(active.member), memberUses(next.member)).map(use => ({ ...use, rules: [...new Set([...use.rules, 'M08'])] }))
      active.member.roles = [...new Set([...(active.member.roles ?? [active.member.type]), ...(next.member.roles ?? [next.member.type])])]
      if (active.member.roles.includes('longitudinal')) active.member.type = 'longitudinal'
      active.member.start = candidates[0]
      active.member.end = candidates.at(-1)!
      active.member.length = round(vectorDistance(active.member.start, active.member.end))
      active.member.connectionPoints = [...new Map([...active.member.connectionPoints, ...next.member.connectionPoints].map(p => [pointKey(p), p])).values()]
      active.high = Math.max(active.high, next.high)
      removed.add(next.member.id)
    }
  }
  const replacements = new Map([...groups.values()].flatMap(group => group.map(entry => [entry.member.id, entry.member] as const)))
  return members.filter(member => !removed.has(member.id)).map(member => replacements.get(member.id) ?? { ...member })
}

