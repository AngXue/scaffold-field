import type { PipeSegment, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'
import { historyOf } from './memberHistory.ts'
import { SemanticIdentities } from './identity.ts'
import type { Move } from './placement.ts'

/** Calculation-only immutable records; public stock IDs remain display aliases. */
export const STOCK_HISTORY = Symbol('scaffold.stockHistory')
export const STOCK_DEMAND = Symbol('scaffold.stockDemand')
export type StockSelection = {
  readonly id: string
  readonly memberConstructionId: string
  readonly stockLengths: readonly number[]
  readonly requiredLength: number
  readonly effectiveLength: number
  readonly excessLength: number
  readonly overlap: number
}
export type StockHistory = {
  readonly id: string
  readonly operation: 'assemble' | 'position'
  readonly rule: 'S01' | Move['rule']
  readonly reason?: Move['reason']
  readonly selection: StockSelection
  readonly sequence: number
  readonly stockLength: number
  readonly start: Readonly<Vector3Tuple>
  readonly end: Readonly<Vector3Tuple>
  readonly parent?: StockHistory
}
export type HistoricStock = { [STOCK_HISTORY]?: StockHistory }
const point = (value: Readonly<Vector3Tuple>): Readonly<Vector3Tuple> => Object.freeze([...value]) as Readonly<Vector3Tuple>
function freeze(record: StockHistory): StockHistory {
  return Object.freeze({ ...record, start: point(record.start), end: point(record.end) })
}
/** Record the real selected sequence once; each purchased piece shares this choice. */
export function stockSelection(member: ScaffoldMember & { [STOCK_DEMAND]?: string }, stocks: readonly number[], overlap: number, effectiveLength: number, excessLength: number): StockSelection {
  const memberConstructionId = member[STOCK_DEMAND] ?? historyOf(member).id
  return Object.freeze({ id: new SemanticIdentities().of('stock-selection', [memberConstructionId, stocks, overlap, member.length]),
    memberConstructionId, stockLengths: Object.freeze([...stocks]), requiredLength: member.length, effectiveLength, excessLength, overlap })
}
export function stockBirth(pipe: PipeSegment, selection: StockSelection): StockHistory {
  return freeze({ id: new SemanticIdentities().of('stock-piece', [selection.id, pipe.sequence]), operation: 'assemble', rule: 'S01',
    selection, sequence: pipe.sequence, stockLength: pipe.stockLength, start: pipe.start, end: pipe.end })
}
/** Called for each real move, before publishing the resulting position. */
export function stockMoved(pipe: PipeSegment, move: Move): StockHistory | undefined {
  const parent = pipe[STOCK_HISTORY]
  if (!parent) return undefined // Hand-written policy fixtures may have no construction metadata.
  if (parent.start.every((value, axis) => value === pipe.start[axis]) && parent.end.every((value, axis) => value === pipe.end[axis])) return parent
  return freeze({ ...parent, id: new SemanticIdentities().of('stock-position', [parent.id, move.rule, move.reason, pipe.start, pipe.end]),
    operation: 'position', rule: move.rule, reason: move.reason, start: pipe.start, end: pipe.end, parent })
}
/** Coordinate adapters do not create new stock or positioning decisions. */
export function stockHistoryTransformer(move: (point: Vector3Tuple) => Vector3Tuple) {
  const cache = new WeakMap<StockHistory, StockHistory>()
  const visit = (node: StockHistory): StockHistory => {
    const previous = cache.get(node)
    if (previous) return previous
    const next = freeze({ ...node, start: move([...node.start]), end: move([...node.end]), parent: node.parent && visit(node.parent) })
    cache.set(node, next)
    return next
  }
  return (pipe: HistoricStock): HistoricStock => pipe[STOCK_HISTORY] ? { [STOCK_HISTORY]: visit(pipe[STOCK_HISTORY]) } : {}
}
