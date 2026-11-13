/** Compatibility labels never participate in construction or reference keys. */
export const DISPLAY_ID = Symbol('scaffold.displayId')
export const INTERNAL_ID = Symbol('scaffold.internalId')
export type DisplayIdentity = { [DISPLAY_ID]?: string; [INTERNAL_ID]?: string }
export function displayId(entity: { id: string } & DisplayIdentity): string { return entity[DISPLAY_ID] ?? entity.id }
export function publicIdentity<T extends { id: string } & DisplayIdentity>(entity: T): T {
  return { ...entity, [INTERNAL_ID]: entity[INTERNAL_ID] ?? entity.id, id: displayId(entity) }
}
