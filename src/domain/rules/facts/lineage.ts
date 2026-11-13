/** A directed ancestry graph. Reference links (e.g. node↔member) are not derivations. */
export type LineageRecord = { id: string; kind: string; derivedFrom: string[]; replacedBy: string[] }
export type RangeReplacement = { rule: string; before: string; after: string }
export function validateLineage(records: readonly LineageRecord[]) {
  const byId = new Map(records.map(record => [record.id, record]))
  if (byId.size !== records.length) throw new Error('Duplicate lineage identity')
  const active = new Set<string>(), done = new Set<string>()
  const visit = (id: string) => {
    if (active.has(id)) throw new Error(`Cyclic lineage: ${id}`)
    if (done.has(id)) return
    const record = byId.get(id)
    if (!record) throw new Error(`Dangling lineage: ${id}`)
    active.add(id)
    for (const parent of record.derivedFrom) visit(parent)
    for (const successor of record.replacedBy) {
      const target = byId.get(successor)
      if (!target || !target.derivedFrom.includes(id)) throw new Error(`Inconsistent replacement: ${id}`)
    }
    active.delete(id); done.add(id)
  }
  records.forEach(record => visit(record.id))
}
