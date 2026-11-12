import { CALCULATION_META, CALCULATION_TRACE, type CalculationMeta, type DiagnosticTrace } from './session.ts'
import { calculateSite, type Site, type SiteLayout } from '../../site.ts'
import { PENDING_MATERIALS, type ScaffoldParameters } from '../../scaffold.ts'
import { resolveBlocks } from '../policies/blocks.ts'
import { sourcePerimeter } from '../boundaries/dimensions.ts'
import { RuleFailure } from '../contracts.ts'
export const CALCULATION_FAILURE = Symbol('scaffold.calculationFailure')
export type CalculationFailure = { code: 'calculation-failure'; step?: string; message: string; meta?: CalculationMeta; trace?: DiagnosticTrace[] }
export type EditorLayout = SiteLayout & { [CALCULATION_FAILURE]?: CalculationFailure }
/** Discard failed partial output. The editor receives this input's draft, never a cached prior BOM. */
export function calculateForEditor(input: Site, settings: ScaffoldParameters, engine: (site: Site, parameters: ScaffoldParameters) => SiteLayout = calculateSite): EditorLayout {
  try { return engine(input, settings) }
  catch (error) {
    const failure: CalculationFailure = { code: 'calculation-failure', ...(error instanceof RuleFailure && { step: error.step }),
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && { meta: Reflect.get(error, CALCULATION_META), trace: Reflect.get(error, CALCULATION_TRACE) }) }
    let blocks: SiteLayout['blocks'] = []
    try { blocks = resolveBlocks(input).blocks } catch { /* The source draft still belongs to the editor. */ }
    return {
      [CALCULATION_FAILURE]: failure, blocks, sections: [], members: [], pipeSegments: [], decks: [], connectors: [], baseChannels: [], pathDimensions: [], warnings: [],
      perimeter: sourcePerimeter(input.sections), canExportMaterials: false,
      issues: [{ code: failure.code, blocking: true, sectionIds: [],
        message: `本次测算未完成${failure.step ? `（${failure.step}）` : ''}。草图仍可编辑和保存，请调整后重算；本次不提供材料清单。` }],
      // These are placeholders for existing viewer props, never publishable quantities.
      materials: { theoreticalLength: 0, actualLength: 0, usedLength: 0, wasteLength: 0, utilization: 0,
        stockSummary: {}, connectorSummary: { cross: 0, butt: 0, swivel: null }, channelSteel: { count: 0, lengthPerPiece: 0, totalLength: 0 },
        guardrail: { railCount: settings.guardrailRailCount, runs: 0, endRuns: 0, totalLength: 0 },
        postHeights: { theoretical: 0, inner: 0, outer: 0 }, pendingMaterials: PENDING_MATERIALS.map(item => ({ ...item })),
        deckCount: 0, deckArea: 0, assemblyPlans: [] },
    }
  }
}
