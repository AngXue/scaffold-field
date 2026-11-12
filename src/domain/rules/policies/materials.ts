import { DEFAULT_PARAMETERS, GUARDRAILS, PENDING_MATERIALS, type MaterialResult, type ScaffoldMember, type ScaffoldParameters } from '../../scaffold.ts'
import type { PhysicalContribution } from '../facts/materialLedger.ts'

export type LogicalDemand = Pick<ScaffoldMember, 'id' | 'type' | 'length'>
export type QuantitySettings = Pick<ScaffoldParameters, 'width' | 'guardrailRailCount'>
export type ComputedQuantities = Omit<MaterialResult, 'postHeights' | 'assemblyPlans' | 'pendingMaterials' | 'connectorSummary'> & {
  connectorSummary: Pick<MaterialResult['connectorSummary'], 'cross' | 'butt'>
}
const round = (value: number, precision = 3) => Number(value.toFixed(precision))
export function summarizeContributions(contributions: readonly PhysicalContribution[], members: readonly LogicalDemand[], settings: QuantitySettings): ComputedQuantities {
  const stockSummary: Record<string, number> = {}
  let stockLength = 0, cross = 0, butt = 0, deckCount = 0, deckArea = 0, channelCount = 0, channelLength = 0, firstChannel = 0
  for (const entry of contributions) switch (entry.category) {
    case 'stock': {
      const key = `${entry.specification}m`
      stockSummary[key] = (stockSummary[key] ?? 0) + entry.quantity
      stockLength += entry.length!
      break
    }
    case 'cross': cross += entry.quantity; break
    case 'butt': butt += entry.quantity; break
    case 'deck': deckCount += entry.quantity; deckArea += entry.area!; break
    case 'channel':
      if (!channelCount) firstChannel = entry.length!
      channelCount += entry.quantity; channelLength += entry.length!
      break
  }
  const theoreticalLength = round(members.reduce((sum, member) => sum + member.length, 0)), actualLength = round(stockLength)
  const rails = members.filter(member => member.type === 'guardrail')
  return {
    theoreticalLength, actualLength, usedLength: theoreticalLength, wasteLength: round(actualLength - theoreticalLength),
    utilization: actualLength ? round(theoreticalLength / actualLength * 100, 1) : 0, stockSummary,
    connectorSummary: { cross, butt }, channelSteel: { count: channelCount, lengthPerPiece: round(firstChannel), totalLength: round(channelLength) },
    guardrail: {
      railCount: Math.max(1, Math.min(GUARDRAILS.length, Math.round(settings.guardrailRailCount ?? DEFAULT_PARAMETERS.guardrailRailCount))),
      runs: rails.length,
      // Preserve the existing display breakdown, including its legacy length heuristic.
      endRuns: rails.filter(member => Math.abs(member.length - settings.width) < 0.5).length,
      totalLength: round(rails.reduce((sum, member) => sum + member.length, 0)),
    },
    deckCount, deckArea: round(deckArea),
  }
}
export function unmodelledQuantities() {
  return { swivel: null, pending: PENDING_MATERIALS.map(item => ({ ...item })) }
}
