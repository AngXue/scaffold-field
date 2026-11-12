import type { MemberType, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'

/** Calculation-only metadata: spread preserves it, legacy JSON intentionally omits it. */
export const MEMBER_USES = Symbol('scaffold.memberUses')
export type MemberPurpose = MemberType | 'side-guard' | 'end-guard' | 'bridge-guard' | 'bridge-working'
export type MemberUse = {
  pathSegment: number
  sectionId?: string
  spanId?: string
  purpose: MemberPurpose
  start: Vector3Tuple
  end: Vector3Tuple
  rules: string[]
}
export type Provenanced = { [MEMBER_USES]?: MemberUse[] }
const copyPoint = (p: Vector3Tuple): Vector3Tuple => [...p]
export function memberUses(member: Provenanced): readonly MemberUse[] { return member[MEMBER_USES] ?? [] }
export function makeUse(pathSegment: number, purpose: MemberPurpose, start: Vector3Tuple, end: Vector3Tuple, rule: string): MemberUse {
  return { pathSegment, purpose, start: copyPoint(start), end: copyPoint(end), rules: [rule] }
}
export function combineUses(...groups: readonly (readonly MemberUse[])[]): MemberUse[] {
  const unique = new Map<string, MemberUse>()
  for (const use of groups.flat()) {
    const key = JSON.stringify([use.pathSegment, use.sectionId, use.spanId, use.purpose, use.start, use.end])
    const previous = unique.get(key)
    unique.set(key, { ...use, start: copyPoint(use.start), end: copyPoint(use.end), rules: [...new Set([...(previous?.rules ?? []), ...use.rules])] })
  }
  return [...unique.values()]
}
export function transformUses(member: Provenanced, point: (p: Vector3Tuple) => Vector3Tuple,
  source: (use: MemberUse) => Pick<MemberUse, 'pathSegment' | 'sectionId' | 'spanId'>): MemberUse[] {
  return memberUses(member).map(use => ({ ...use, ...source(use), start: point(use.start), end: point(use.end), rules: [...use.rules] }))
}
export function clipUses(member: Provenanced, start: Vector3Tuple, end: Vector3Tuple, rule: string): MemberUse[] {
  const delta = start.map((v, i) => Math.abs(end[i] - v))
  const axis = delta.indexOf(Math.max(...delta))
  const low = Math.min(start[axis], end[axis]), high = Math.max(start[axis], end[axis])
  return memberUses(member).flatMap(use => {
    const a = Math.max(low, Math.min(use.start[axis], use.end[axis]))
    const b = Math.min(high, Math.max(use.start[axis], use.end[axis]))
    if (b - a < 0.000001) return []
    const at = (value: number): Vector3Tuple => use.start.map((v, i) => i === axis ? value : v) as Vector3Tuple
    const forward = use.end[axis] >= use.start[axis]
    return [{ ...use, start: at(forward ? a : b), end: at(forward ? b : a), rules: [...new Set([...use.rules, rule])] }]
  })
}
/** Consumers query all retained sources, never the compatibility display owner alone. */
export function hasSource(member: ScaffoldMember, pathSegment: number) {
  const uses = memberUses(member)
  return uses.length ? uses.some(use => use.pathSegment === pathSegment) : member.pathSegment === pathSegment
}
