import { GRID_SIZE, PIXELS_PER_METER } from './plan.ts'
import { roundSite, type Footprint, type SiteLine, type SitePoint } from './site.ts'

export type AlignmentGuide = { axis: 'x' | 'z'; at: number; from: number; to: number }
const grid = GRID_SIZE / PIXELS_PER_METER

/** Find the nearest edge or midpoint alignment independently on each axis. */
export function alignSiteBlock(block: Footprint, position: SitePoint, blocks: Footprint[],
  lines: Pick<SiteLine, 'start' | 'end'>[], tolerance: number) {
  const targets = [...blocks, ...lines.map(({ start, end }) => ({
    x: Math.min(start.x, end.x), z: Math.min(start.z, end.z),
    width: Math.abs(start.x - end.x), depth: Math.abs(start.z - end.z),
  }))]
  const next = { x: roundSite(Math.round(position.x / grid) * grid), z: roundSite(Math.round(position.z / grid) * grid) }
  const alignments: Array<{ axis: AlignmentGuide['axis']; target: Footprint; at: number }> = []

  for (const axis of ['x', 'z'] as const) {
    const size = axis === 'x' ? 'width' : 'depth'
    const offsets = [0, block[size] / 2, block[size]]
    let best: { target: Footprint; at: number; distance: number; offset: number } | undefined
    for (const target of targets) {
      for (const at of [target[axis], target[axis] + target[size] / 2, target[axis] + target[size]]) {
        for (const offset of offsets) {
          const distance = Math.abs(at - position[axis] - offset)
          if (distance <= tolerance && (!best || distance < best.distance)) best = { target, at, distance, offset }
        }
      }
    }
    if (best) {
      next[axis] = roundSite(best.at - best.offset)
      alignments.push({ axis, target: best.target, at: best.at })
    }
  }

  const guides = alignments.map(({ axis, target, at }): AlignmentGuide => {
    const along = axis === 'x' ? 'z' : 'x', size = axis === 'x' ? 'depth' : 'width'
    return { axis, at, from: Math.min(next[along], target[along]), to: Math.max(next[along] + block[size], target[along] + target[size]) }
  })
  return { position: next, guides }
}
