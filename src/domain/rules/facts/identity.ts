/** Stable, local identities; not cryptographic fingerprints or display labels. */
export type SemanticValue = string | number | boolean | null | readonly SemanticValue[]
function digest(text: string) {
  let first = 0x811c9dc5, second = 0x9e3779b9
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i), 0x01000193)
    second = Math.imul(second ^ text.charCodeAt(i), 0x85ebca6b)
  }
  return (first >>> 0).toString(16).padStart(8, '0') + (second >>> 0).toString(16).padStart(8, '0')
}
/** Collision checking is calculation-local. No global cache survives an edit. */
export class SemanticIdentities {
  private readonly keys = new Map<string, string>()
  private readonly hash: (text: string) => string
  constructor(hash: (text: string) => string = digest) { this.hash = hash }
  of(kind: string, values: readonly SemanticValue[]): string {
    const key = JSON.stringify(values, (_, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite entity identity')
      return value
    })
    const id = `${kind}:${this.hash(key)}`, previous = this.keys.get(id)
    if (previous !== undefined && previous !== key) throw new Error(`Semantic identity collision: ${kind}`)
    this.keys.set(id, key)
    return id
  }
}
export function canonicalPoints(points: readonly (readonly number[])[]): number[][] {
  return points.map(point => [...point]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
}
