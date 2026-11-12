import { traceInvocation, recordRuleTrace } from './diagnostics/session.ts'
import { RuleFailure, type DeepReadonly, type Proposal, type RuleDefinition, type RuleStep, type Trace } from './contracts.ts'

/** Freeze only calculation-owned plain data; callers retain ownership of their input. */
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function cloneFacts<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneFacts) as T
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new RuleFailure('input', 'facts must use plain objects and arrays')
  const copy: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(value)) {
    const child = cloneFacts(Reflect.get(value, key))
    if (key === '__proto__') Object.defineProperty(copy, key, { value: child, writable: true, enumerable: true, configurable: true })
    else copy[key] = child
  }
  return copy as T
}


function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Reflect.ownKeys(left), otherKeys = Reflect.ownKeys(right)
  return keys.length === otherKeys.length && keys.every(key => Object.hasOwn(right, key) && sameValue(Reflect.get(left, key), Reflect.get(right, key)))
}

/** Compile once. No rule can be activated by a project file or arbitrary priority. */
export function compilePipeline<F extends object, P extends Proposal>(definitions: readonly RuleDefinition[], steps: readonly RuleStep<F, P>[],
  reduce: (facts: DeepReadonly<F>, proposals: readonly P[]) => F, configuration: { verifyImmutability?: boolean; snapshot?: (input: F) => F } = {}) {
  // Type-level immutability is always active. Deep runtime verification may be
  // disabled only by trusted compiled packages, never by a saved project.
  const publish = configuration.verifyImmutability === false ? <T>(value: T) => value as DeepReadonly<T> : freeze
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
    let facts = publish(configuration.snapshot ? configuration.snapshot(input) : cloneFacts(input)), revision = 0
    const trace: Trace[] = [], invocation = traceInvocation()
    const written = new Map<string, { proposal: P; step: string }>()
    // All writes remain private until the entire calculation succeeds. A thrown
    // failure never publishes partially updated facts or mutates caller state.
    for (const batch of batches) {
      const proposals = new Map<string, P>()
      for (const step of batch) {
        const view = Object.fromEntries(step.reads.map(key => [key, (facts as Readonly<F>)[key]])) as DeepReadonly<Partial<F>>
        let outcome
        try { outcome = step.evaluate(publish(view) as DeepReadonly<Partial<F>>, revision) }
        catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          if (invocation !== undefined) recordRuleTrace(invocation, step, revision, 'rejected', [], reason)
          throw new RuleFailure(step.id, reason)
        }
        if (invocation !== undefined) recordRuleTrace(invocation, step, revision, outcome.status, outcome.status === 'proposed' ? outcome.proposals.map(proposal => proposal.target) : [], outcome.status === 'not-applicable' || outcome.status === 'rejected' ? outcome.reason : undefined)
        if (outcome.status === 'rejected') throw new RuleFailure(step.id, outcome.reason)
        if (options.trace) trace.push({ step: step.id, phase: step.phase, status: outcome.status,
          ...(outcome.status === 'not-applicable' && { reason: outcome.reason }),
          targets: outcome.status === 'proposed' ? outcome.proposals.map(p => p.target) : [] })
        if (outcome.status !== 'proposed') continue
        for (const proposal of outcome.proposals) {
          if (!step.kinds.includes(proposal.kind) || !step.targets.includes(proposal.target) || proposal.expectedRevision !== revision || !proposal.target)
            throw new RuleFailure(step.id, 'unauthorized proposal or stale revision')
          const existing = written.get(proposal.target)
          const same = existing && sameValue({ ...existing.proposal, expectedRevision: 0 }, { ...proposal, expectedRevision: 0 })
          if (existing && !same && !step.refines?.some(relation => relation.step === existing.step
            && relation.targets.includes(proposal.target) && relation.when(proposal, existing.proposal, view)))
            throw new RuleFailure(step.id, `conflicting proposals: ${proposal.target}`)
          proposals.set(proposal.target, proposal)
          written.set(proposal.target, { proposal, step: step.id })
        }
      }
      if (proposals.size) {
        try { facts = publish(reduce(facts, [...proposals.values()])) }
        catch (error) { throw new RuleFailure(batch.map(step => step.id).join('+'), error instanceof Error ? error.message : String(error)) }
      }
      revision++
    }
    return { facts, trace }
  }
}
