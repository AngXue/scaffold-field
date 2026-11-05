import { scaffoldTransverseLength, type ScaffoldParameters } from './scaffold.ts'
import { footprintCells, footprintContains, footprintOutline } from './siteFootprints.ts'
import { signedArea } from './polygons.ts'
import { GROUND, MIN_SECTION_LENGTH, roundSite, getSectionLevels, type ResolvedBlock, type SitePoint, type SiteSection } from './site.ts'

type Axis = 'x' | 'z'
export type WallEdge = { axis: Axis; at: number; low: number; high: number; outward: -1 | 1 }
export type RoutedSpan = { sourceId: string; line: SiteSection; wall: boolean; wallClearance?: number }
export type SiteTransition = { before: SiteSection; after: SiteSection; boundary: number }
const EPS = 0.001
const other = (axis: Axis): Axis => axis === 'x' ? 'z' : 'x'

export function siteWallEdges(blocks: ResolvedBlock[]) {
  const edges = blocks.flatMap(block => {
    const points = footprintOutline(block)
    const orientation = Math.sign(signedArea(points.map(p => [p.x, p.z])))
    return points.map((a, i): WallEdge => {
      const b = points[(i + 1) % points.length], vertical = a.x === b.x
      const axis = vertical ? 'x' : 'z', along = other(axis)
      return { axis, at: a[axis], low: Math.min(a[along], b[along]), high: Math.max(a[along], b[along]),
        outward: (vertical ? Math.sign(b.z - a.z) : -Math.sign(b.x - a.x)) * orientation as -1 | 1 }
    })
  })
  // Collinear vertices belong to one wall (a partial outline can add extra vertices).
  const merged: WallEdge[] = []
  for (const edge of edges.sort((a, b) => a.low - b.low)) {
    const existing = merged.find(e => e.axis === edge.axis && e.at === edge.at && e.outward === edge.outward && edge.low <= e.high + EPS)
    if (existing) existing.high = Math.max(existing.high, edge.high)
    else merged.push({ ...edge })
  }
  return merged
}

export function snapScaffoldStroke(start: SitePoint, end: SitePoint, edges: WallEdge[], tolerance: number) {
  const axis = Math.abs(start.x - end.x) >= Math.abs(start.z - end.z) ? 'z' : 'x'
  const along = other(axis)
  const low = Math.min(start[along], end[along]), high = Math.max(start[along], end[along])
  const edge = edges.filter(e => e.axis === axis && low >= e.low - tolerance && high <= e.high + tolerance
      && Math.abs(start[axis] - e.at) <= tolerance && Math.abs(end[axis] - e.at) <= tolerance)
    .sort((a, b) => Math.abs(start[axis] - a.at) - Math.abs(start[axis] - b.at)
      || (b.high - b.low) - (a.high - a.low))[0]
  const project = (p: SitePoint) => edge ? { ...p, [axis]: edge.at,
    [along]: Math.abs(p[along] - edge.low) <= tolerance ? edge.low
      : Math.abs(p[along] - edge.high) <= tolerance ? edge.high : p[along] } : p
  return { start: project(start), end: project(end), edge }
}

export function wallStandOff(settings: ScaffoldParameters) {
  const excess = Math.max(0, scaffoldTransverseLength(settings) - settings.width) / 2
  return roundSite(Math.max(0.30, excess + settings.pipeDiameter / 2 + 0.05))
}

export function routeSiteSections(sections: SiteSection[], blocks: ResolvedBlock[], settings: ScaffoldParameters) {
  const edges = siteWallEdges(blocks)
  const walls = sections.map(s => s.automatic && s.surfaceId === GROUND ? snapScaffoldStroke(s.start, s.end, edges, EPS).edge : undefined)
  const clearances = sections.map(() => wallStandOff(settings))
  const sharedEnds = new Map<number, { high: number; low: number }>()
  walls.forEach((wall, i) => {
    if (!wall) return
    walls.forEach((other, j) => {
      if (!other || i === j || wall.axis !== other.axis || wall.outward === other.outward || (sections[j].layers < sections[i].layers || sections[j].layers === sections[i].layers && j > i)) return
      const gap = (other.at - wall.at) * wall.outward
      const overlap = Math.min(wall.high, other.high) - Math.max(wall.low, other.low)
      const clearance = wallStandOff(settings)
      if (overlap <= EPS || gap < settings.width + 2 * clearance - EPS || gap >= 2 * settings.width + 2 * clearance - EPS) return
      // A lower end meets the higher frame's existing pair of posts. The lower
      // face stands a little farther from its wall instead of duplicating rows.
      const along = other.axis === 'x' ? 'z' : 'x'
      const a = Math.min(sections[i].start[along], sections[i].end[along])
      const b = Math.max(sections[i].start[along], sections[i].end[along])
      if (a < other.low - clearance && b <= other.high + EPS || b > other.high + clearance && a >= other.low - EPS) {
        clearances[i] = roundSite(gap - clearance - settings.width)
        sharedEnds.set(i, { low: other.low - clearance, high: other.high + clearance })
      }
    })
  })
  const spans: RoutedSpan[] = [], transitions: SiteTransition[] = []
  const errors: Array<{ id: string; message: string }> = []
  const takenIds = new Set(sections.map(section => section.id))
  sections.forEach((source, index) => {
    if (!source.automatic || source.surfaceId !== GROUND || source.start.x !== source.end.x && source.start.z !== source.end.z) {
      spans.push({ sourceId: source.id, line: source, wall: false }); return
    }
    const wall = walls[index]
    const cross = source.start.x === source.end.x ? 'x' : 'z', along = other(cross)
    let { start, end } = source
    if (wall) {
      const snapEnd = (p: SitePoint) => ({ ...p, [along]: Math.abs(p[along] - wall.low) <= 0.101 ? wall.low
        : Math.abs(p[along] - wall.high) <= 0.101 ? wall.high : p[along] })
      start = snapEnd(start); end = snapEnd(end)
    }
    const clearance = clearances[index]
    if (wall) {
      const shift = (point: SitePoint) => {
        const adjacentIndex = walls.findIndex((candidate, i) => candidate && candidate.axis === along
          && Math.abs(candidate.at - point[along]) < EPS && Math.abs(point[cross] - wall.at) < EPS
          && point[cross] >= Math.min(sections[i].start[cross], sections[i].end[cross]) - EPS
          && point[cross] <= Math.max(sections[i].start[cross], sections[i].end[cross]) + EPS)
        return { ...point, [cross]: roundSite(wall.at + wall.outward * clearance),
          [along]: roundSite(point[along] + (walls[adjacentIndex]?.outward ?? 0) * (clearances[adjacentIndex] ?? clearance)) }
      }
      start = shift(start); end = shift(end)
      const sign = cross === 'x' ? -wall.outward : wall.outward
      if (Math.sign(end[along] - start[along]) !== sign) [start, end] = [end, start]
    }
    const shared = sharedEnds.get(index)
    if (shared) {
      const low = Math.min(start[along], end[along]), high = Math.max(start[along], end[along])
      const trim = (p: SitePoint) => ({ ...p, [along]: low < shared.low ? Math.min(p[along], shared.low) : high > shared.high ? Math.max(p[along], shared.high) : p[along] })
      start = trim(start); end = trim(end)
    }
    const sign = Math.sign(end[along] - start[along])
    if (!sign) { spans.push({ sourceId: source.id, line: source, wall: false }); return }
    const low = Math.min(start[along], end[along]), high = Math.max(start[along], end[along])
    const row = start[cross] + (cross === 'x' ? -sign : sign) * settings.width
    const overhang = Math.max(settings.pipeDiameter / 2, (scaffoldTransverseLength(settings) - settings.width) / 2)
    const outsideLow = Math.min(start[cross], row) - overhang, outsideHigh = Math.max(start[cross], row) + overhang
    const run = (b: ResolvedBlock) => [b[along], b[along] + (along === 'x' ? b.width : b.depth)]
    const candidates = blocks.filter(b => b[cross] <= outsideLow + EPS
      && b[cross] + (cross === 'x' ? b.width : b.depth) >= outsideHigh - EPS && run(b)[0] < high && run(b)[1] > low)
    const cuts = [...new Set([low, high, ...candidates.flatMap(block => footprintCells(block).flatMap(cell => [cell[along], cell[along] + (along === 'x' ? cell.width : cell.depth)])).filter(at => at > low + EPS && at < high - EPS).map(roundSite)])].sort((a, b) => a - b)
    const intervals: Array<{ low: number; high: number; block?: ResolvedBlock }> = []
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], middle = (a + b) / 2
      const support = along === 'x' ? { x: a, z: outsideLow, width: b - a, depth: outsideHigh - outsideLow }
        : { x: outsideLow, z: a, width: outsideHigh - outsideLow, depth: b - a }
      const block = candidates.filter(item => run(item)[0] < middle && middle < run(item)[1] && footprintContains(item, support)).sort((p, q) => q.top - p.top)[0]
      const previous = intervals.at(-1)
      if (previous && previous.block?.id === block?.id) previous.high = b
      else intervals.push({ low: a, high: b, block })
    }
    const setback = (here: number, there: number) => Math.max(here < there ? 0.30 : 0.15,
      settings.tubeEndExtension + settings.pipeDiameter + (here < there ? 0.1 : 0))
    const boundarySetback = (at: number, base: number, next: number) => Math.max(setback(base, next),
      ...(base < next ? walls.flatMap((edge, i) => edge?.axis === along && Math.abs(edge.at - at) < EPS ? [clearances[i]] : []) : []))
    const placements = intervals.map((interval, i) => {
      const base = interval.block?.top ?? 0
      const limits = interval.block && run(interval.block)
      const a = interval.low + (i ? boundarySetback(interval.low, base, intervals[i - 1].block?.top ?? 0)
        : limits ? Math.max(0, limits[0] + 0.15 - interval.low) : 0)
      const b = interval.high - (i + 1 < intervals.length ? boundarySetback(interval.high, base, intervals[i + 1].block?.top ?? 0)
        : limits ? Math.max(0, interval.high - limits[1] + 0.15) : 0)
      return { a: roundSite(a), b: roundSite(b), base }
    })
    // When both sides stand lower, count the crossing bays from the two lower end
    // stations. The upper surface needs only the stations that fall between them.
    for (let i = 1; i + 1 < placements.length; i++) {
      const low = placements[i - 1], high = placements[i], far = placements[i + 1]
      if (high.base <= Math.max(low.base, far.base)) continue
      const roof = intervals[i], inset = Math.max(0.20, settings.tubeEndExtension + settings.pipeDiameter + 0.05)
      const nearOptions = [[low.b, far.a], [roundSite(roof.low - inset), roundSite(roof.high + inset)]]
      let stationCount = Math.ceil(roundSite(high.b - high.a) / settings.postSpacing - 1e-9) + 1
      let placement: { start: number; end: number; a: number; b: number } | undefined
      for (const [start, end] of nearOptions) {
        const pitch = roundSite((end - start) / Math.max(3, Math.ceil(roundSite(end - start) / settings.postSpacing - 1e-9)))
        const a = roundSite(start + pitch), b = roundSite(end - pitch)
        const count = Math.ceil(roundSite(b - a) / settings.postSpacing - 1e-9) + 1
        if (count >= stationCount || pitch > settings.postSpacing || b - a < MIN_SECTION_LENGTH - EPS
          || a < high.a - EPS || b > high.b + EPS || start - low.a < MIN_SECTION_LENGTH || far.b - end < MIN_SECTION_LENGTH) continue
        placement = { start, end, a, b }
        stationCount = count
      }
      if (placement) { low.b = placement.start; high.a = placement.a; high.b = placement.b; far.a = placement.end }
    }
    const parts = placements.map(({ a, b, base }, i) => {
      const interval = intervals[i]
      const layers = source.layers - getSectionLevels(base, settings.liftHeight, 1).firstLayer + 1
      if (layers < 1 || b - a < MIN_SECTION_LENGTH - EPS) {
        errors.push({ id: source.id, message: layers < 1 ? '目标作业层低于经过的顶面，请提高目标层或调整路线。' : '高差边界附近没有足够的柱脚位置，请调整路线。' })
        return undefined
      }
      const point = (value: number): SitePoint => ({ ...start, [along]: roundSite(value) })
      let id = source.id
      if (intervals.length > 1) {
        id = `${source.id}/auto-${i + 1}`
        while (takenIds.has(id)) id += '-'
        takenIds.add(id)
      }
      return { id, automatic: true, surfaceId: interval.block?.id ?? GROUND, layers, start: point(sign > 0 ? a : b), end: point(sign > 0 ? b : a) }
    })
    if (sign < 0) parts.reverse()
    parts.forEach((line, i) => {
      if (!line) return
      spans.push({ sourceId: source.id, line, wall: !!wall, ...(wall && { wallClearance: clearances[index] }) })
      const before = parts[i - 1]
      if (before) {
        const boundary = sign > 0 ? intervals[i].low : intervals[intervals.length - i - 1].high
        transitions.push({ before, after: line, boundary })
      }
    })
  })
  return { spans, transitions, errors }
}
