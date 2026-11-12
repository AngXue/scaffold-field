import type { ScaffoldMember, DeckPanel, BaseChannel, LayoutWarning, ScaffoldParameters, PathDimension, MaterialResult, ScaffoldLayout, PipeAssemblyPlan } from '../../scaffold.ts'
/** Logical construction product. It deliberately has no pipes, fittings or material totals. */
export type ScaffoldDraft = {
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
  assemblyPlans: PipeAssemblyPlan[]
  postHeights: MaterialResult['postHeights']
}
