import { BASE_CHANNEL_HEIGHT, BASE_CHANNEL_WIDTH, type ScaffoldLayout } from '../../scaffold.ts'
import type { ResolvedBlock, SiteIssue } from '../../site.ts'
import type { RoutedSpan } from '../../siteRouting.ts'
import type { Bridge, JoinedLift } from '../facts/transitions.ts'
import { footprintCells } from '../../siteFootprints.ts'
import { subtractCoverage } from '../../polygons.ts'
import { SITE_EPS as EPS } from '../facts/precision.ts'
import { sourcedIssue } from '../facts/issues.ts'
import { stockBounds, deckBounds, pipeEntersBlock, coveredArea, footprintPolygon, overlapBoxes } from './collisionGeometry.ts'
export function bridgeIssues(layout: ScaffoldLayout, blocks: ResolvedBlock[], spans: RoutedSpan[], bridges: Bridge[], joined: JoinedLift[], radius: number,
  labelEntries: [string, number][], previous: readonly SiteIssue[]): SiteIssue[] {
  const issues = [...previous], start = issues.length, labels = new Map(labelEntries)
  if (joined.length) {
    const memberById = new Map(layout.members.map(member => [member.id, member]))
    const penetrations = new Set<string>()
    const physical = layout.pipeSegments.map(pipe => ({
      index: memberById.get(pipe.memberId)?.pathSegment, bounds: stockBounds(pipe.start, pipe.end, radius),
    }))
    physical.push(...layout.decks.map(deck => ({ index: deck.pathSegment, bounds: deckBounds(deck.coverage?.flat() ?? deck.corners) })))
    physical.push(...layout.baseChannels.map(beam => {
      const bounds = stockBounds(beam.start, beam.end, BASE_CHANNEL_WIDTH / 2)
      bounds.min[1] = beam.start[1]; bounds.max[1] = beam.start[1] + BASE_CHANNEL_HEIGHT
      return { index: beam.pathSegment, bounds }
    }))
    for (const pipe of layout.pipeSegments) {
      if (!blocks.some(block => pipeEntersBlock(pipe.start, pipe.end, block, radius))) continue
      const span = spans[memberById.get(pipe.memberId)?.pathSegment ?? -1]
      if (span) penetrations.add(span.sourceId)
    }
    for (const bridge of bridges) {
      const sourceId = spans[bridge.left].sourceId
      const bounds = [...bridge.rails.map(rail => stockBounds(rail.start, rail.end, radius)),
        ...bridge.decks.map(deck => deckBounds(deck.corners))]
      for (const deck of bridge.decks) {
        const polygon = deck.corners.map(([x, , z]) => [x, z] as [number, number])
        if (blocks.some(block => deck.corners[0][1] > block.base + EPS && deck.corners[0][1] < block.top - EPS
          && coveredArea([polygon]) - coveredArea(subtractCoverage([polygon], footprintCells(block).map(footprintPolygon))) > 1e-6)) {
          penetrations.add(sourceId)
        }
      }
      const overlapping = new Set(physical.flatMap(item => item.index === undefined || spans[item.index].sourceId === sourceId
        || !bounds.some(box => {
          if (!overlapBoxes(box, item.bounds)) return false
          const joint = bridge.rails.some(rail => [rail.start, rail.end].some(point => point.every((value, axis) =>
            Math.max(box.min[axis], item.bounds.min[axis]) >= value - radius * 2 - EPS
            && Math.min(box.max[axis], item.bounds.max[axis]) <= value + radius * 2 + EPS)))
          return !joint
        }) ? [] : [spans[item.index].sourceId]))
      if (overlapping.size) issues.push(sourcedIssue('V03', { code: 'bridge-overlap', blocking: true, sectionIds: [...new Set([sourceId, ...overlapping])],
        message: `第 ${labels.get(sourceId)} 段的高差接通区与其他架体重叠，请调整路线。` }))
    }
    for (const id of penetrations) if (!issues.some(issue => issue.code === 'house-penetration' && issue.sectionIds.includes(id))) {
      issues.push(sourcedIssue('V03', { code: 'house-penetration', blocking: true, sectionIds: [id], message: `第 ${labels.get(id)} 段接通后的杆件穿入体块，请调整路线。` }))
    }
  }

  return issues.slice(start)
}
