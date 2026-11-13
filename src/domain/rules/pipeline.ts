import { validateRuleRelations } from './relations.ts'
import { traceInvocation, recordRuleTrace, recordAppliedRelation, enterCalculationPhase, rejectCalculation } from './diagnostics/session.ts'
import { RuleFailure, type Phase, type DeepReadonly, type Proposal, type RuleDefinition, type RuleStep, type Trace } from './contracts.ts'

/** Freeze only calculation-owned plain data; callers retain ownership of their input. */
function freeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) freeze(Reflect.get(value, key))
    Object.freeze(value)
  }
  return value as DeepReadonly<T>
}

function cloneFacts<T>(value: T, copies = new WeakMap<object, object>(), active = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value
  if (active.has(value)) throw new RuleFailure('input', 'facts must not contain cycles')
  const previous = copies.get(value)
  if (previous) return previous as T
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    throw new RuleFailure('input', 'facts must use plain objects and arrays')
  const copy: Record<PropertyKey, unknown> | unknown[] = Array.isArray(value) ? [] : {}
  copies.set(value, copy); active.add(value)
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const child = cloneFacts(Reflect.get(value, key), copies, active)
    if (key === '__proto__') Object.defineProperty(copy, key, { value: child, writable: true, enumerable: true, configurable: true })
    else (copy as Record<PropertyKey, unknown>)[key] = child
  }
  if (Array.isArray(value)) (copy as unknown[]).length = value.length
  active.delete(value)
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
  validateRuleRelations(definitions, steps)
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
  const start = (input: F, options: { trace?: boolean } = {}) => {
    let facts: DeepReadonly<F>
    try { facts = publish(configuration.snapshot ? configuration.snapshot(input) : cloneFacts(input)) }
    catch (error) { rejectCalculation(); throw error }
    let revision = 0
    const trace: Trace[] = [], invocation = traceInvocation()
    const written = new Map<string, { proposal: P; step: string }>()
    let cursor = 0, lastPhase = -1, failed = false
    const advance = (phase: Phase): { facts: DeepReadonly<F>; trace: Trace[] } => {
      if (failed) throw new RuleFailure('stage', 'cannot resume a rejected stage')
      if (!Number.isInteger(phase) || phase < lastPhase || phase > 9 || phase < 0) throw new RuleFailure('stage', 'invalid or backwards phase advance')
      try {
        // All writes remain private until the requested stage succeeds. A thrown
        // failure never publishes partially updated facts or mutates caller state.
        while (cursor < batches.length && batches[cursor][0].phase <= phase) {
          const batch = batches[cursor]
          const proposals = new Map<string, P>()
          for (const step of batch) {
            const view = Object.fromEntries(step.reads.map(key => [key, (facts as Readonly<F>)[key]])) as DeepReadonly<Partial<F>>
            let outcome
            try { enterCalculationPhase(step); outcome = step.evaluate(publish(view) as DeepReadonly<Partial<F>>, revision) }
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
              if (existing && !same) {
                const refinement = step.refines?.find(relation => relation.step === existing.step
                  && relation.targets.includes(proposal.target) && relation.when(proposal, existing.proposal, view))
                if (!refinement) throw new RuleFailure(step.id, `conflicting proposals: ${proposal.target}`)
                if (options.trace) {
                  const entry = trace.at(-1)!
                  entry.appliedRelations = [...new Set([...(entry.appliedRelations ?? []), refinement.relationId])]
                }
                recordAppliedRelation(invocation, step.id, refinement.relationId)
              }
              proposals.set(proposal.target, proposal)
              written.set(proposal.target, { proposal, step: step.id })
            }
          }
          if (proposals.size) {
            try { facts = publish(reduce(facts, [...proposals.values()])) }
            catch (error) { throw new RuleFailure(batch.map(step => step.id).join('+'), error instanceof Error ? error.message : String(error)) }
          }
          revision++; cursor++
        }
        lastPhase = phase
        return { facts, trace: [...trace] }
      } catch (error) { failed = true; rejectCalculation(); throw error }
    }
    return { advance, finish: () => advance(9) }
  }
  const run = (input: F, options: { trace?: boolean } = {}) => start(input, options).finish()
  return Object.assign(run, { start })
}
