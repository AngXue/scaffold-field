import type { MemberType, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'
import { MEMBER_USES, combineUses, memberUses, transformUses, type MemberUse, type RetiredUse } from './memberUses.ts'
import { FRAME_SCOPES } from './scopes.ts'
import { canonicalPoints, SemanticIdentities } from './identity.ts'

/** Persistent, calculation-only ancestry. Parents are shared immutable records,
 * not copies of a scene, stock collection, or a rule's complete input snapshot. */
export const MEMBER_HISTORY = Symbol('scaffold.memberHistory')
export type MemberHistory = {
  readonly id: string
  readonly operation: 'demand' | 'merge' | 'clip' | 'connect' | 'purpose-removal'
  readonly rules: readonly string[]
  readonly type: MemberType
  readonly roles: readonly MemberType[]
  readonly start: Vector3Tuple
  readonly end: Vector3Tuple
  readonly parents: readonly MemberHistory[]
  readonly uses: readonly MemberUse[]
}
export type HistoricMember = { [MEMBER_HISTORY]?: MemberHistory }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value
}
const origins = (uses: readonly MemberUse[]) => uses.map(use => [use.sectionId ?? null, use.spanId ?? null,
  use.pathSegment, use.purpose, [use.start, use.end]] as const).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

/** Called at demand publication, before compatibility labels are assigned. */
export function memberBirth(member: ScaffoldMember, nativeId?: string): MemberHistory {
  const uses = combineUses(memberUses(member)), roles = [...new Set(member.roles ?? [member.type])].sort()
  const id = nativeId ?? new SemanticIdentities().of('member-demand', [member.type, member.layer ?? null, roles,
    canonicalPoints([member.start, member.end]), canonicalPoints(member.connectionPoints), origins(uses), [...(member[FRAME_SCOPES] ?? [])].sort()])
  return freeze({ id, operation: 'demand', rules: [...new Set(uses.flatMap(use => use.rules))].sort(), type: member.type, roles,
    start: [...member.start] as Vector3Tuple, end: [...member.end] as Vector3Tuple, parents: [], uses })
}
export function historyOf(member: ScaffoldMember): MemberHistory { return member[MEMBER_HISTORY] ?? memberBirth(member) }

/** A change gets its own identity. No producer edits a published parent record. */
export function memberChange(member: ScaffoldMember, inputs: readonly MemberHistory[], rule: string,
  operation: Exclude<MemberHistory['operation'], 'demand'>, uses: readonly MemberUse[] = []): MemberHistory {
  const unique = new Map<string, MemberHistory>()
  const key = (node: MemberHistory) => JSON.stringify([node.operation, [...node.rules].sort(), node.type, [...node.roles].sort(),
    node.start, node.end, node.parents.map(parent => parent.id).sort(), origins(node.uses)])
  for (const parent of inputs) {
    const previous = unique.get(parent.id)
    if (previous && previous !== parent && key(previous) !== key(parent)) throw new Error(`Conflicting member ancestor: ${parent.id}`)
    unique.set(parent.id, parent)
  }
  const parents = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id))
  if (!parents.length) throw new Error('Member replacement requires an ancestor')
  const roles = [...new Set(member.roles ?? [member.type])].sort()
  const id = new SemanticIdentities().of('member-change', [operation, rule, parents.map(parent => parent.id), member.type, roles,
    canonicalPoints([member.start, member.end]), origins(uses)])
  return freeze({ id, operation, rules: [rule], type: member.type, roles, start: [...member.start] as Vector3Tuple,
    end: [...member.end] as Vector3Tuple, parents, uses: combineUses(uses) })
}

/** One transformer per coordinate boundary preserves structural sharing across
 * all members passing that boundary. Native identities survive projections. */
export function historyTransformer(point: (point: Vector3Tuple) => Vector3Tuple,
  source: (use: MemberUse) => Pick<MemberUse, 'pathSegment' | 'sectionId' | 'spanId'>) {
  const transformed = new WeakMap<MemberHistory, MemberHistory>()
  const visit = (node: MemberHistory): MemberHistory => {
    const previous = transformed.get(node)
    if (previous) return previous
    const next = freeze({ ...node, start: point(node.start), end: point(node.end), parents: node.parents.map(visit),
      uses: transformUses({ [MEMBER_USES]: node.uses as MemberUse[] }, point, source) })
    transformed.set(node, next)
    return next
  }
  return (member: HistoricMember): HistoricMember => member[MEMBER_HISTORY] ? { [MEMBER_HISTORY]: visit(member[MEMBER_HISTORY]) } : {}
}

export function retiredMemberUse(member: ScaffoldMember, use: MemberUse, rule: RetiredUse['rule'], reason: RetiredUse['reason']): RetiredUse {
  const interval = { ...member, start: use.start, end: use.end }
  return { use, rule, reason, history: memberChange(interval, [historyOf(member)], rule, 'purpose-removal', [use]) }
}
