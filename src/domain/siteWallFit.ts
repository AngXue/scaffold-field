import { positionStock } from './rules/placement.ts'
import type { PlacementLayout } from './rules/facts/placement.ts'
import type { TransitionEnd } from './rules/facts/transitions.ts'
import type { ResolvedBlock } from './site.ts'
import { footprintCells } from './siteFootprints.ts'
export { guardFacesWall } from './rules/policies/guardRemovals.ts'

export function positionSiteStock(layout: PlacementLayout, blocks: ResolvedBlock[], radius: number,
  transitions: Map<number, TransitionEnd[]> = new Map(), besideWalls = true, walkway = true) {
  const cells = blocks.flatMap(block => footprintCells(block).map(cell => ({ ...cell, base: block.base, top: block.top })))
  return positionStock(layout, { transitions: [...transitions], cells: besideWalls ? cells : [], radius, walkway,
    obstacles: cells.map(cell => ({ base: cell.base, top: cell.top,
      polygon: [[cell.x, cell.z], [cell.x + cell.width, cell.z], [cell.x + cell.width, cell.z + cell.depth], [cell.x, cell.z + cell.depth]] })) })
}
export function fitStockBesideWalls(layout: PlacementLayout, blocks: ResolvedBlock[], radius: number) {
  positionSiteStock(layout, blocks, radius, new Map(), true, false)
}
export function fitSceneGuardrails(layout: PlacementLayout, blocks: ResolvedBlock[], radius: number) {
  positionSiteStock(layout, blocks, radius, new Map(), false, true)
}
