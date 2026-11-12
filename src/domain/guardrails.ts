import { positionStock } from './rules/placement.ts'
import type { PlacementLayout, GuardObstacle } from './rules/facts/placement.ts'
export type { GuardObstacle } from './rules/facts/placement.ts'
export function fitGuardrailStock(layout: PlacementLayout, obstacles: GuardObstacle[] = [], radius = 0.024) {
  positionStock(layout, { transitions: [], cells: [], obstacles, radius, walkway: true })
}
