import type { Site, SiteLayout } from '../../site.ts'
import type { ScaffoldParameters } from '../../scaffold.ts'
import type { Phase, Trace } from '../contracts.ts'
import { RULES } from '../catalog.ts'
import { NUMERIC_POLICY } from '../facts/precision.ts'
import { ENGINE_REVISION } from './build.ts'
import { fingerprint } from './fingerprint.ts'
export const CALCULATION_META = Symbol('scaffold.calculationMeta')
export const CALCULATION_TRACE = Symbol('scaffold.calculationTrace')
export type CalculationMeta = { formatVersion: '0.7'; inputFingerprint: string; rulesetFingerprint: string; engineRevision: string }
export type DiagnosticTrace = Trace & { invocation: number; ruleId: string; ruleRevision: number; inputRevision: number }
export type DiagnosedLayout = SiteLayout & { [CALCULATION_META]: CalculationMeta; [CALCULATION_TRACE]?: DiagnosticTrace[] }
export const RULESET_MANIFEST = Object.freeze({ precision: Object.freeze({ ...NUMERIC_POLICY }), engineRevision: ENGINE_REVISION,
  rules: Object.freeze(RULES.filter(rule => rule.status === 'active').map(rule => Object.freeze({ id: rule.id, revision: rule.revision })).sort((a, b) => a.id.localeCompare(b.id))) })
const rulesetFingerprint = fingerprint(RULESET_MANIFEST)
type Session = { trace: DiagnosticTrace[]; invocation: number }
let session: Session | undefined
/** Synchronous, request-scoped stack. No state survives the calculation or a failure. */
export function traceInvocation(): number | undefined { return session ? ++session.invocation : undefined }
export function recordRuleTrace(invocation: number | undefined, rule: { id: string; ruleId: string; phase: Phase }, revision: number,
  status: Trace['status'], targets: string[], reason?: string) {
  if (!session || invocation === undefined) return
  session.trace.push({ invocation, step: rule.id, phase: rule.phase, ruleId: rule.ruleId,
    ruleRevision: RULES.find(entry => entry.id === rule.ruleId)?.revision ?? 0, inputRevision: revision, status, targets, ...(reason && { reason }) })
}
export function calculationSession(input: Site, parameters: ScaffoldParameters, calculate: () => SiteLayout, trace = false): DiagnosedLayout {
  const meta: CalculationMeta = Object.freeze({ formatVersion: '0.7', inputFingerprint: fingerprint({ scene: input, parameters }), rulesetFingerprint, engineRevision: ENGINE_REVISION })
  const previous = session, current = trace ? { trace: [] as DiagnosticTrace[], invocation: 0 } : undefined
  session = current
  try {
    const result = calculate() as DiagnosedLayout
    result[CALCULATION_META] = meta
    if (current) result[CALCULATION_TRACE] = current.trace
    return result
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error))
    Object.assign(failure, { [CALCULATION_META]: meta, ...(current && { [CALCULATION_TRACE]: current.trace }) })
    throw failure
  } finally { session = previous }
}
