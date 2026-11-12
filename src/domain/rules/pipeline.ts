import { RuleFailure, type DeepReadonly, type Proposal, type RuleDefinition, type RuleStep, type Trace } from './contracts.ts'

/** Freeze only calculation-owned plain data; callers retain ownership of their input. */
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

/** Compile once. No rule can be activated by a project file or arbitrary priority. */
export function compilePipeline<F extends object, P extends Proposal>(definitions: readonly RuleDefinition[], steps: readonly RuleStep<F, P>[],
  reduce: (facts: DeepReadonly<F>, proposals: readonly P[]) => F) {
  const rules = new Map<string, RuleDefinition>()
  for (const rule of definitions) {
    if (rules.has(rule.id) || !Number.isInteger(rule.revision) || rule.revision < 1 || !rule.source.length || !rule.cases.length)
      throw new RuleFailure(rule.id, 'invalid or duplicate rule registration')
    rules.set(rule.id, rule)
  }
  const registered = new Map<string, RuleStep<F, P>>()
  for (const step of steps) {
    if (registered.has(step.id) || !rules.has(step.ruleId) || !Number.isInteger(step.phase) || step.phase < 0 || step.phase > 9)
      throw new RuleFailure(step.id, 'invalid or duplicate step registration')
    registered.set(step.id, step)
  }
  for (const step of steps) for (const relation of step.refines ?? []) {
    if (!registered.has(relation.step) || !step.after.includes(relation.step) || !relation.reason || !relation.caseId || !relation.targets.length)
      throw new RuleFailure(step.id, 'invalid refinement contract')
  }
  const active = steps.filter(step => rules.get(step.ruleId)!.status === 'active')
  for (const step of active) for (const dependency of step.after) {
    const predecessor = registered.get(dependency)
    if (!predecessor || !active.includes(predecessor) || predecessor.phase > step.phase)
      throw new RuleFailure(step.id, `missing, inactive or later dependency: ${dependency}`)
  }
  const batches: RuleStep<F, P>[][] = [], completed = new Set<string>()
  for (let phase = 0; phase <= 9; phase++) {
    let pending = active.filter(step => step.phase === phase)
    while (pending.length) {
      const batch = pending.filter(step => step.after.every(id => completed.has(id))).sort((a, b) => a.id.localeCompare(b.id))
      if (!batch.length) throw new RuleFailure(pending[0].id, 'cyclic dependency')
      batches.push(batch)
      batch.forEach(step => completed.add(step.id))
      pending = pending.filter(step => !completed.has(step.id))
    }
  }
  return (input: F, options: { trace?: boolean } = {}): { facts: DeepReadonly<F>; trace: Trace[] } => {
    let facts = freeze(structuredClone(input)), revision = 0
    const trace: Trace[] = []
    const written = new Map<string, { proposal: P; step: string }>()
    // All writes remain private until the entire calculation succeeds. A thrown
    // failure never publishes partially updated facts or mutates caller state.
    for (const batch of batches) {
      const proposals = new Map<string, P>()
      for (const step of batch) {
        const view = Object.fromEntries(step.reads.map(key => [key, (facts as Readonly<F>)[key]])) as DeepReadonly<Partial<F>>
        let outcome
        try { outcome = step.evaluate(freeze(view) as DeepReadonly<Partial<F>>, revision) }
        catch (error) { throw new RuleFailure(step.id, error instanceof Error ? error.message : String(error)) }
        if (outcome.status === 'rejected') throw new RuleFailure(step.id, outcome.reason)
        if (options.trace) trace.push({ step: step.id, phase: step.phase, status: outcome.status,
          ...(outcome.status === 'not-applicable' && { reason: outcome.reason }),
          targets: outcome.status === 'proposed' ? outcome.proposals.map(p => p.target) : [] })
        if (outcome.status !== 'proposed') continue
        for (const proposal of outcome.proposals) {
          if (!step.kinds.includes(proposal.kind) || !step.targets.includes(proposal.target) || proposal.expectedRevision !== revision || !proposal.target)
            throw new RuleFailure(step.id, 'unauthorized proposal or stale revision')
          const existing = written.get(proposal.target)
          const same = existing && JSON.stringify({ ...existing.proposal, expectedRevision: 0 }) === JSON.stringify({ ...proposal, expectedRevision: 0 })
          if (existing && !same && !step.refines?.some(relation => relation.step === existing.step
            && relation.targets.includes(proposal.target) && relation.when(proposal, existing.proposal, view)))
            throw new RuleFailure(step.id, `conflicting proposals: ${proposal.target}`)
          proposals.set(proposal.target, proposal)
          written.set(proposal.target, { proposal, step: step.id })
        }
      }
      if (proposals.size) facts = freeze(reduce(facts, [...proposals.values()]))
      revision++
    }
    return { facts, trace }
  }
}
