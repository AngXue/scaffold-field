import type { DeckPanel, ScaffoldMember } from '../../scaffold.ts'
export type JoinedLift = { before: string; after: string; levels: number[] }
export type TransitionEnd = { axis: 0 | 2; boundary: number; roof: number; station: number; towardRoof: number; wall: boolean }
export type Bridge = { left: number; right: number; rails: ScaffoldMember[]; decks: DeckPanel[] }
export type CapCut = { axis: 0 | 2; low: number; high: number }
