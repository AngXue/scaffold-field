import { calculateSite, type Site, type SiteIssue } from '../../site.ts'
import type { ScaffoldParameters } from '../../scaffold.ts'
import { CALCULATION_META, CALCULATION_TRACE, RULESET_MANIFEST, type DiagnosedLayout } from './session.ts'
import { calculateForEditor, CALCULATION_FAILURE } from './editor.ts'
import { buildEntityGraph } from '../facts/entityGraph.ts'
import { ISSUE_ORIGIN, type SourcedIssue } from '../facts/issues.ts'
/** Explicit local diagnostic export; 0.7/0.6 project serializers never include this payload. */
export function explainSite(input: Site, parameters: ScaffoldParameters) {
  const layout = calculateForEditor(input, parameters, (site, settings) => calculateSite(site, settings, { trace: true }))
  const failure = layout[CALCULATION_FAILURE]
  const issues = layout.issues.map((issue: SiteIssue) => ({ ...issue, origin: (issue as Partial<SourcedIssue>)[ISSUE_ORIGIN] }))
  return { diagnosticVersion: 2, scope: 'package-local trace; global phase scheduling pending',
    meta: failure?.meta ?? (layout as DiagnosedLayout)[CALCULATION_META], ruleset: RULESET_MANIFEST,
    input: { scene: input, parameters }, issues,
    trace: failure?.trace ?? (layout as DiagnosedLayout)[CALCULATION_TRACE] ?? [],
    ...(failure ? { failure } : { graph: buildEntityGraph(input, layout) }),
  }
}
