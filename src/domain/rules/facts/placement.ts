import type { ScaffoldLayout, Vector3Tuple } from '../../scaffold.ts'
import type { PlanPolygon } from '../../polygons.ts'
import type { TransitionEnd } from './transitions.ts'
export type Interval = [number, number]
export type GuardObstacle = { polygon: PlanPolygon; base: number; top: number }
export type WallCell = { x: number; z: number; width: number; depth: number; base: number; top: number }
export type PlacementLayout = Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors'> & Partial<Pick<ScaffoldLayout, 'decks'>>
export type PlacementEnvironment = { transitions: [number, TransitionEnd[]][]; cells: WallCell[]; obstacles: GuardObstacle[]; radius: number; walkway: boolean }
export type AxialRange = { axis: 0 | 2; allowed: Interval[] }
export type Walkway = { memberId: string; direction: Vector3Tuple; origin: Vector3Tuple; length: number; occupied: Interval[] }
export type Move = { rule: 'S04' | 'P08'; reason: 'transition' | 'wall' | 'walkway'; delta: Vector3Tuple }
export type PlacementDecision = { memberId: string; moves: Move[]; feasible: boolean; constraints: string[]; searchConstraints?: string[]; searchFeasible?: boolean; intrusion?: { before: number; after: number } }
