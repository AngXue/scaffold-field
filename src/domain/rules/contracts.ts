export type Phase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type RuleStatus = 'draft' | 'active' | 'retired'
export type RuleDefinition = {
  id: string
  revision: number
  title: string
  status: RuleStatus
  implementation: 'legacy-adapter' | 'native' | 'boundary'
  source: readonly string[]
  cases: readonly string[]
}
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T
export type Proposal = { kind: string; target: string; expectedRevision: number }
export type Outcome<P> =
  | { status: 'proposed'; proposals: readonly P[] }
  | { status: 'not-applicable'; reason: string }
  | { status: 'rejected'; reason: string }
export type RuleStep<F, P extends Proposal> = {
  id: string
  ruleId: string
  phase: Phase
  after: readonly string[]
  reads: readonly (keyof F)[]
  kinds: readonly P['kind'][]
  targets: readonly P['target'][]
  refines?: readonly {
    step: string
    targets: readonly P['target'][]
    reason: string
    caseId: string
    when(next: P, previous: P, facts: DeepReadonly<Partial<F>>): boolean
  }[]
  evaluate(facts: DeepReadonly<Partial<F>>, revision: number): Outcome<P>
}
export type Trace = { step: string; phase: Phase; status: Outcome<Proposal>['status']; reason?: string; targets: string[] }
export class RuleFailure extends Error {
  readonly step: string
  constructor(step: string, reason: string) { super(`${step}: ${reason}`); this.name = 'RuleFailure'; this.step = step }
}
