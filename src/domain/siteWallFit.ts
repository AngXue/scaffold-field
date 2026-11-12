import { fitGuardrailStock } from './guardrails.ts'
import type { ScaffoldLayout } from './scaffold.ts'
import type { ResolvedBlock } from './site.ts'
import { footprintCells } from './siteFootprints.ts'

export { guardFacesWall } from './rules/policies/guardRemovals.ts'
/** Slide excess stock along its own axis, preserving the design member and all ties. */
export function fitStockBesideWalls(layout: Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors'>, blocks: ResolvedBlock[], radius: number) {
  for (const member of layout.members) {
    if (member.type === 'post' || member.start[1] !== member.end[1]) continue
    const axis = member.start[0] === member.end[0] ? 2 : 0, cross = axis === 0 ? 2 : 0
    if (member.start[cross] !== member.end[cross]) continue
    const pipes = layout.pipeSegments.filter(p => p.memberId === member.id)
    if (!pipes.length) continue
    const low = Math.min(...pipes.flatMap(p => [p.start[axis], p.end[axis]])), high = Math.max(...pipes.flatMap(p => [p.start[axis], p.end[axis]]))
    let ranges = [[Math.max(member.start[axis], member.end[axis]) - high, Math.min(member.start[axis], member.end[axis]) - low]]
    for (const block of blocks) {
      if (member.start[1] + radius <= block.base || member.start[1] - radius >= block.top) continue
      for (const cell of footprintCells(block)) {
        const c = cross === 0 ? cell.x : cell.z, size = cross === 0 ? cell.width : cell.depth
        if (member.start[cross] + radius <= c || member.start[cross] - radius >= c + size) continue
        const a = (axis === 0 ? cell.x : cell.z) - high - 0.002
        const b = (axis === 0 ? cell.x + cell.width : cell.z + cell.depth) - low + 0.002
        ranges = ranges.flatMap(([l, r]) => b <= l || a >= r ? [[l, r]] : [[l, Math.min(r, a)], [Math.max(l, b), r]].filter(([lo, hi]) => hi >= lo))
      }
    }
    const shifts = ranges.filter(([l,r])=>l<=r).map(([l,r])=>Math.max(l,Math.min(0,r))).sort((a,b)=>Math.abs(a)-Math.abs(b))
    const shift = shifts[0]
    if (shift === undefined || Math.abs(shift)<1e-6) continue
    for (const pipe of pipes) {pipe.start[axis]+=shift;pipe.end[axis]+=shift}
    for (const connector of layout.connectors) if(connector.type==='butt' && connector.memberId===member.id) connector.position[axis]+=shift
  }
}

/** Apply the same surplus rule after scene translation, wall fitting and bridges. */
export function fitSceneGuardrails(layout: Pick<ScaffoldLayout, 'members' | 'pipeSegments' | 'connectors' | 'decks'>, blocks: ResolvedBlock[], radius: number) {
  fitGuardrailStock(layout, blocks.flatMap(block => footprintCells(block).map(cell => ({
    base: block.base, top: block.top,
    polygon: [[cell.x,cell.z],[cell.x+cell.width,cell.z],[cell.x+cell.width,cell.z+cell.depth],[cell.x,cell.z+cell.depth]] as [number,number][],
  }))), radius)
}
