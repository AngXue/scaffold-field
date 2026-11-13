import type { MemberType, Vector3Tuple } from '../../scaffold.ts'
import { canonicalPoints, SemanticIdentities, type SemanticValue } from './identity.ts'

/** Native construction keys, before the compatibility label adapter runs.
 * A scope describes authored source edges, never their traversal ordinal.
 * Geometry is kept at its original precision; this is identity, not tolerance.
 */
export class ConstructionIdentities {
  private readonly ids = new SemanticIdentities()
  readonly scope: string
  constructor(sources: readonly SemanticValue[], lifts: readonly number[] | undefined, layerOffset: number) {
    this.scope = this.ids.of('construction', [sources, lifts ?? null, layerOffset])
  }
  member(type: MemberType, layer: number | undefined, start: Vector3Tuple, end: Vector3Tuple): string {
    // Exact coincident demands intentionally share a key. The constructor retains
    // every purpose interval on that member; it never infers ownership from the key.
    return this.ids.of('demand', [this.scope, type, layer ?? null, canonicalPoints([start, end])])
  }
}

/** Display labels are required at the boundary, never guessed from a native key. */
export function constructionAlias(aliases: ReadonlyMap<string, string>, id: string): string {
  const result = aliases.get(id)
  if (!result) throw new Error(`Missing construction display alias: ${id}`)
  return result
}
