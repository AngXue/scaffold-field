import type { Vector3Tuple } from '../../scaffold.ts'
import { SemanticIdentities } from './identity.ts'
export const STATION_TRACK = Symbol('scaffold.stationTrack')
export const STATION_PLAN = Symbol('scaffold.stationPlan')
export type StationOrigin = { readonly pathSegment: number; readonly sectionId?: string; readonly spanId?: string }
export type StationVersion = {
  readonly id: string
  readonly operation: 'grid' | 'align' | 'keep' | 'omit' | 'corner'
  readonly rule: 'G03' | 'G08' | 'G09'
  readonly point: Vector3Tuple
  readonly row: 0 | 1
  readonly origins: readonly StationOrigin[]
  readonly parentIds: readonly string[]
  readonly reason?: 'corner-anchor' | 'transition-pair' | 'ordinary' | 'shared-corner' | 'short-corner' | 'outside-corner-range'
}
export type StationTrack = { readonly scope: string; readonly versions: readonly StationVersion[]; readonly heads: readonly (readonly StationVersion[])[] }
export type StationPlan = { readonly id: string; readonly versions: readonly StationVersion[]; readonly heads: readonly (readonly (readonly string[])[])[]; readonly cornerIds: readonly string[] }
export type StationBinding = { readonly plan: StationPlan; readonly ids: readonly string[] }
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    // Factory-owned coordinate tuples have only three scalar values.
    if (Array.isArray(value) && value.length === 3 && typeof value[0] === 'number'
      && typeof value[1] === 'number' && typeof value[2] === 'number') return Object.freeze(value)
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value,key))
    Object.freeze(value)
  }
  return value
}
export function stationBirth(scope: string, point: Vector3Tuple, row: 0 | 1, origins: readonly StationOrigin[], corner = false): StationVersion {
  return freeze({ id: new SemanticIdentities().of('station', [scope, point, row, origins.map(origin => origin.pathSegment), corner]),
    operation: corner ? 'corner' : 'grid', rule: corner ? 'G08' : 'G03', point:[...point] as Vector3Tuple, row,
    origins: origins.map(origin => ({...origin})), parentIds:[] })
}
export function stationChange(parent: StationVersion, operation: 'align' | 'keep' | 'omit', point: Vector3Tuple, reason: NonNullable<StationVersion['reason']>): StationVersion {
  return freeze({ ...parent, id: new SemanticIdentities().of('station-change', [parent.id, operation, point, reason]),
    operation, rule: operation === 'align' ? 'G03' : 'G09', point:[...point] as Vector3Tuple, parentIds:[parent.id], reason })
}
export function stationPlan(versions: readonly StationVersion[], heads: StationPlan['heads'], cornerIds: readonly string[]): StationPlan {
  return freeze({ id:new SemanticIdentities().of('station-plan',[versions.map(node => node.id),heads,cornerIds]), versions:[...versions],heads,cornerIds:[...cornerIds] })
}
/** A whole local plan is shared by its post demands, including omitted stations. */
export function stationProjection(point: (point: Vector3Tuple) => Vector3Tuple, source: (origin: StationOrigin) => StationOrigin) {
  const plans = new WeakMap<StationPlan,StationPlan>()
  return (binding: StationBinding): StationBinding => {
    let plan = plans.get(binding.plan)
    if (!plan) {
      plan = freeze({...binding.plan,versions:binding.plan.versions.map(node => ({...node,point:point(node.point),origins:node.origins.map(source)}))})
      plans.set(binding.plan,plan)
    }
    return freeze({plan,ids:binding.ids})
  }
}
