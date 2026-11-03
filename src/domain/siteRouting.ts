import { scaffoldTransverseLength, type ScaffoldParameters } from './scaffold.ts'
import { GROUND, MIN_SECTION_LENGTH, roundSite, getSectionLevels, type ResolvedBlock, type SitePoint, type SiteSection } from './site.ts'

type Axis = 'x' | 'z'
export type WallEdge = { axis: Axis; at: number; low: number; high: number; outward: -1 | 1 }
export type RoutedSpan = { sourceId: string; line: SiteSection; wall: boolean }
export type SiteTransition = { before: SiteSection; after: SiteSection; boundary: number }
const EPS = 0.001
const other = (axis: Axis): Axis => axis === 'x' ? 'z' : 'x'

export function siteWallEdges(blocks: ResolvedBlock[]) {
  return blocks.flatMap((b): WallEdge[] => [
    { axis: 'x', at: b.x, low: b.z, high: b.z + b.depth, outward: -1 },
    { axis: 'x', at: b.x + b.width, low: b.z, high: b.z + b.depth, outward: 1 },
    { axis: 'z', at: b.z, low: b.x, high: b.x + b.width, outward: -1 },
    { axis: 'z', at: b.z + b.depth, low: b.x, high: b.x + b.width, outward: 1 },
  ])
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
    const clearance = wallStandOff(settings)
    if (wall) {
      const shift = (point: SitePoint) => {
        const adjacent = walls.find((candidate, i) => candidate && candidate.axis === along
          && Math.abs(candidate.at - point[along]) < EPS && Math.abs(point[cross] - wall.at) < EPS
          && [sections[i].start, sections[i].end].some(p => Math.hypot(p.x - point.x, p.z - point.z) < EPS))
        return { ...point, [cross]: roundSite(wall.at + wall.outward * clearance),
          [along]: roundSite(point[along] + (adjacent?.outward ?? 0) * clearance) }
      }
      start = shift(start); end = shift(end)
      const sign = cross === 'x' ? -wall.outward : wall.outward
      if (Math.sign(end[along] - start[along]) !== sign) [start, end] = [end, start]
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
    const cuts = [...new Set([low, high, ...candidates.flatMap(run).filter(at => at > low + EPS && at < high - EPS).map(roundSite)])].sort((a, b) => a - b)
    const intervals: Array<{ low: number; high: number; block?: ResolvedBlock }> = []
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], middle = (a + b) / 2
      const block = candidates.filter(item => run(item)[0] < middle && middle < run(item)[1]).sort((p, q) => q.top - p.top)[0]
      const previous = intervals.at(-1)
      if (previous && previous.block?.id === block?.id) previous.high = b
      else intervals.push({ low: a, high: b, block })
    }
    const setback = (here: number, there: number) => Math.max(here < there ? 0.30 : 0.15,
      settings.tubeEndExtension + settings.pipeDiameter + (here < there ? 0.1 : 0))
    const placements = intervals.map((interval, i) => {
      const base = interval.block?.top ?? 0
      const limits = interval.block && run(interval.block)
      const a = interval.low + (i ? setback(base, intervals[i - 1].block?.top ?? 0)
        : limits ? Math.max(0, limits[0] + 0.15 - interval.low) : 0)
      const b = interval.high - (i + 1 < intervals.length ? setback(base, intervals[i + 1].block?.top ?? 0)
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
      spans.push({ sourceId: source.id, line, wall: !!wall })
      const before = parts[i - 1]
      if (before) {
        const boundary = sign > 0 ? intervals[i].low : intervals[intervals.length - i - 1].high
        transitions.push({ before, after: line, boundary })
      }
    })
  })
  return { spans, transitions, errors }
}
