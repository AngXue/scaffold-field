import type { MemberType, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'

/** Calculation-only metadata: spread preserves it, legacy JSON intentionally omits it. */
export const MEMBER_USES = Symbol('scaffold.memberUses')
export const RETIRED_USES = Symbol('scaffold.retiredUses')
export type RetiredUse = { history?: import('./memberHistory.ts').MemberHistory; use: MemberUse; rule: 'P04' | 'P06'; reason: 'wall' | 'shared-cap' | 'transition-cap' }
export type MemberPurpose = MemberType | 'side-guard' | 'end-guard' | 'bridge-guard' | 'bridge-working'
export type UseRangeChange = { rule: string; before: [Vector3Tuple, Vector3Tuple]; after: [Vector3Tuple, Vector3Tuple] }
export type MemberUse = {
  pathSegment: number
  sectionId?: string
  spanId?: string
  purpose: MemberPurpose
  start: Vector3Tuple
  end: Vector3Tuple
  rules: string[]
  /** Compact interval replacement facts, retained even if a later merge absorbs this use. */
  changes?: UseRangeChange[]
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
    const changes = previous?.changes?.length || use.changes?.length
      ? [...new Map([...(previous?.changes ?? []), ...(use.changes ?? [])].map(change => [JSON.stringify(change), change])).values()] : []
    unique.set(key, { ...use, start: copyPoint(use.start), end: copyPoint(use.end), rules: [...new Set([...(previous?.rules ?? []), ...use.rules])],
      ...(changes.length && { changes: changes.map(change => ({ ...change, before: change.before.map(copyPoint) as UseRangeChange['before'], after: change.after.map(copyPoint) as UseRangeChange['after'] })) }) })
  }
  return [...unique.values()]
}
export function transformUses(member: Provenanced, point: (p: Vector3Tuple) => Vector3Tuple,
  source: (use: MemberUse) => Pick<MemberUse, 'pathSegment' | 'sectionId' | 'spanId'>): MemberUse[] {
  return memberUses(member).map(use => ({ ...use, ...source(use), start: point(use.start), end: point(use.end), rules: [...use.rules],
    ...(use.changes && { changes: use.changes.map(change => ({ ...change, before: change.before.map(point) as UseRangeChange['before'], after: change.after.map(point) as UseRangeChange['after'] })) }),
  }))
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
    const start = at(forward ? a : b), end = at(forward ? b : a)
    const changed = [start, end].some((point, side) => point.some((value, axis) => value !== [use.start, use.end][side][axis]))
    return [{ ...use, start, end, rules: [...new Set([...use.rules, rule])],
      ...(changed && { changes: [...(use.changes ?? []), { rule, before: [copyPoint(use.start), copyPoint(use.end)], after: [copyPoint(start), copyPoint(end)] } as UseRangeChange] }),
    }]
  })
}
/** Consumers query all retained sources, never the compatibility display owner alone. */
export function hasSource(member: ScaffoldMember, pathSegment: number) {
  const uses = memberUses(member)
  return uses.length ? uses.some(use => use.pathSegment === pathSegment) : member.pathSegment === pathSegment
}
