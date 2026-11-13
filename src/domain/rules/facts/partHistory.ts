import type { BaseChannel, DeckPanel, Vector3Tuple } from '../../scaffold.ts'
import { canonicalPoints, SemanticIdentities } from './identity.ts'

export const PART_HISTORY = Symbol('scaffold.partHistory')
export const REMOVED_PARTS = Symbol('scaffold.removedParts')
export type PartOrigin = { readonly pathSegment: number; readonly sectionId?: string; readonly spanId?: string }
export type PartHistory = {
  readonly id: string
  readonly kind: 'deck' | 'base'
  readonly operation: 'create' | 'coverage' | 'merge' | 'support' | 'remove'
  readonly rule: 'M05' | 'M06' | 'M07' | 'P05'
  readonly reason?: 'overlap' | 'duplicate' | 'unsupported' | 'covered-support'
  readonly points: readonly Vector3Tuple[]
  readonly faces?: readonly (readonly Vector3Tuple[])[]
  readonly area?: number
  readonly origins: readonly PartOrigin[]
  readonly parents: readonly PartHistory[]
  /** Read dependencies are not replaced by the result (e.g. overlapping panels). */
  readonly inputs: readonly PartHistory[]
  readonly supportIds: readonly string[]
}
export type HistoricPart = { [PART_HISTORY]?: PartHistory }
type Part = DeckPanel | BaseChannel
type Collection<T> = T[] & { [REMOVED_PARTS]?: readonly PartHistory[] }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value
}
function geometry(part: Part) {
  return 'corners' in part ? { kind: 'deck' as const, points: part.corners.map(point => [...point] as Vector3Tuple),
    faces: (part.coverage ?? [part.corners]).map(face => face.map(point => [...point] as Vector3Tuple)), area: part.area }
    : { kind: 'base' as const, points: [[...part.start], [...part.end]] as Vector3Tuple[] }
}
function shapeKey(shape: Pick<PartHistory, 'kind' | 'points' | 'faces' | 'area'>) {
  return [shape.kind, canonicalPoints(shape.points), shape.faces?.map(canonicalPoints).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) ?? null,
    shape.area ?? null] as const
}
const originKey = (origin: PartOrigin) => [origin.pathSegment, origin.sectionId ?? null, origin.spanId ?? null] as const
export function partBirth(part: Part, scope = '', rule: PartHistory['rule'] = 'M05', supportIds: readonly string[] = [], originInputs: readonly PartOrigin[] = [{ pathSegment: part.pathSegment }]): PartHistory {
  const shape = geometry(part), origins = originInputs.map(origin => ({ ...origin }))
  return freeze({ ...shape, id: new SemanticIdentities().of('part-demand', [scope, shapeKey(shape), origins.map(originKey), [...supportIds].sort()]),
    operation: 'create', rule, origins, parents: [], inputs: [], supportIds: [...supportIds].sort() })
}
export function partHistory(part: Part): PartHistory { return part[PART_HISTORY] ?? partBirth(part, '', 'corners' in part ? 'M05' : 'M07') }
export function partChanged(part: Part, parents: readonly PartHistory[], rule: PartHistory['rule'], operation: Exclude<PartHistory['operation'], 'create'>,
  inputs: readonly PartHistory[] = [], supportIds: readonly string[] = [], reason?: PartHistory['reason']): PartHistory {
  if (!parents.length) throw new Error('Part change requires a parent')
  const origins = [...new Map(parents.flatMap(parent => parent.origins).map(origin => [JSON.stringify(originKey(origin)), origin])).values()]
    .sort((a,b) => JSON.stringify(originKey(a)).localeCompare(JSON.stringify(originKey(b))))
  const shape = geometry(part), supports = [...new Set(supportIds)].sort()
  const previousById = new Map<string,PartHistory>()
  const signature = (node: PartHistory) => JSON.stringify([node.rule,node.operation,node.reason,shapeKey(node),node.origins,
    node.parents.map(parent => parent.id).sort(),node.inputs.map(input => input.id).sort(),node.supportIds])
  for (const parent of parents) {
    const existing = previousById.get(parent.id)
    if (existing && existing !== parent && signature(existing) !== signature(parent)) throw new Error(`Conflicting part parent: ${parent.id}`)
    previousById.set(parent.id,parent)
  }
  const previous = [...previousById.values()].sort((a,b) => a.id.localeCompare(b.id))
  return freeze({ ...shape, id: new SemanticIdentities().of('part-change', [operation, rule, reason ?? null,
    previous.map(parent => parent.id), inputs.map(input => input.id).sort(), supports, shapeKey(shape)]),
    operation, rule, ...(reason && { reason }), origins, parents: previous, inputs, supportIds: supports })
}
export function partShapeChanged(part: Part, before: PartHistory): boolean { return JSON.stringify(shapeKey(geometry(part))) !== JSON.stringify(shapeKey(before)) }
export function removedParts(values: readonly unknown[]): readonly PartHistory[] { return (values as Collection<unknown>)[REMOVED_PARTS] ?? [] }
/** Tombstones travel with their collection, including an empty collection. */
export function partList<T>(items: T[], ...sources: readonly (readonly unknown[])[]): T[] {
  const removed = [...new Set(sources.flatMap(source => [...removedParts(source)]))]
  if (removed.length) (items as Collection<T>)[REMOVED_PARTS] = Object.freeze(removed)
  return items
}
export function withRemoved<T>(items: T[], removed: readonly PartHistory[], ...sources: readonly (readonly unknown[])[]): T[] {
  const result = partList(items, ...sources) as Collection<T>
  result[REMOVED_PARTS] = Object.freeze([...new Set([...removedParts(result), ...removed])])
  return result
}
export function appendParts<T>(target: T[], source: readonly T[]) {
  target.push(...source)
  partList(target, target, source)
}
export function mapParts<T>(source: readonly T[], map: (item: T) => T): T[] { return partList(source.map(map), source) }
/** One coordinate adapter shares transformed ancestors across live and removed parts. */
export function partProjection(point: (point: Vector3Tuple) => Vector3Tuple, source: (origin: PartOrigin) => PartOrigin) {
  const cache = new WeakMap<PartHistory, PartHistory>()
  const record = (node: PartHistory): PartHistory => {
    const previous = cache.get(node)
    if (previous) return previous
    const result = freeze({ ...node, points: node.points.map(point), faces: node.faces?.map(face => face.map(point)), origins: node.origins.map(source),
      parents: node.parents.map(record), inputs: node.inputs.map(record) })
    cache.set(node,result)
    return result
  }
  const on = (part: HistoricPart): HistoricPart => part[PART_HISTORY] ? { [PART_HISTORY]: record(part[PART_HISTORY]) } : {}
  return { record, on, list: <T extends HistoricPart>(values: readonly T[], map: (part: T) => T): T[] =>
    withRemoved(values.map(part => ({...map(part), ...on(part)})), removedParts(values).map(record)) }
}
