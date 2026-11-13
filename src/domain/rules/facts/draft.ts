import type { StockAssembly } from '../stock.ts'
import type { FittingPlan } from './fittings.ts'
import type { ScaffoldMember, DeckPanel, BaseChannel, LayoutWarning, ScaffoldParameters, PathDimension, MaterialResult, ScaffoldLayout, PipeAssemblyPlan } from '../../scaffold.ts'
export const COMMITTED_UPRIGHTS = Symbol('scaffold.committedUprights')
/** Logical construction product with an internal committed S4 upright handoff. No public pipe collection, fittings or material totals. */
export type ScaffoldDraft = {
  [COMMITTED_UPRIGHTS]?: { posts: StockAssembly[]; sequences: Record<string, number[]>; warnings: LayoutWarning[] }
  members: ScaffoldMember[]
  decks: DeckPanel[]
  baseChannels: BaseChannel[]
  warnings: LayoutWarning[]
  parameters: ScaffoldParameters
  postSequences: Record<string, number[]>
  pathDimensions: PathDimension[]
  postHeights: MaterialResult['postHeights']
}

/** Physical entities before the sole final contribution ledger is published. */
export type ScaffoldAssembly = Omit<ScaffoldLayout, 'materials'> & {
  fittingPlans: FittingPlan[]
  assemblyPlans: PipeAssemblyPlan[]
  postHeights: MaterialResult['postHeights']
}
