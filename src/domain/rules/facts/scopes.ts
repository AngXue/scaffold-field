import type { SiteSection } from '../../site.ts'
import { SemanticIdentities } from './identity.ts'
/** A construction frame is a physical calculation scope, not a display prefix or editing group. */
export const FRAME_SCOPES = Symbol('scaffold.frameScopes')
export const CONSTRUCTION_FRAMES = Symbol('scaffold.constructionFrames')
export type ConstructionFrame = { id: string; spanIds: string[] }
export type ScopedEntity = { [FRAME_SCOPES]?: readonly string[] }
export function frameScope(ids: SemanticIdentities, sections: readonly SiteSection[]): string {
  const keys = sections.map(section => [section.id, section.surfaceId, section.layers,
    [section.start.x, section.start.z], [section.end.x, section.end.z]] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
  return ids.of('frame', keys)
}
export function requiredScopes(entity: ScopedEntity): readonly string[] {
  const scopes = entity[FRAME_SCOPES]
  if (!scopes?.length) throw new Error('Missing committed construction frame scope')
  return scopes
}
export function inFrameScopes(entity: ScopedEntity, scopes: ReadonlySet<string>): boolean {
  return requiredScopes(entity).some(scope => scopes.has(scope))
}
export function combinedScopes(...entities: ScopedEntity[]): readonly string[] | undefined {
  if (!entities.some(entity => entity[FRAME_SCOPES]?.length)) return undefined
  const scopes = entities.flatMap(entity => entity[FRAME_SCOPES] ?? [])
  return scopes.length ? [...new Set(scopes)].sort() : undefined
}
