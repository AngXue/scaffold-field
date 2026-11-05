import { measureDrawing, normalizeDrawing, PIXELS_PER_METER, readDrawing, type PlanDrawing } from './plan.ts'
import { BASE_CHANNEL_HEIGHT, BASE_CHANNEL_WIDTH, calculateMaterials, calculateScaffold, calculateScaffoldPlan, type ScaffoldLayout, type ScaffoldParameters, type Vector3Tuple } from './scaffold.ts'
import { signedArea, subtractCoverage, type PlanPolygon } from './polygons.ts'
import { footprintCells, footprintContains, footprintContainsPoint, footprintCoversPolygon, footprintFromOutline, footprintSupportsSegment, footprintsOverlap } from './siteFootprints.ts'
import { fitStockBesideWalls, guardFacesWall } from './siteWallFit.ts'
import { routeSiteSections, wallStandOff, type RoutedSpan } from './siteRouting.ts'
import { connectSiteTransitions, fitTransitionStock, isWallEndGuard, type JoinedLift, type TransitionEnd } from './siteTransitions.ts'

/** Horizontal site coordinates and vertical heights are all measured in metres. */
export type SitePoint = { x: number; z: number }
export type Footprint = { x: number; z: number; width: number; depth: number; outline?: SitePoint[] }
export type SiteBlock = Footprint & { id: string; parentId: string; height: number }
export type SiteLine = { id: string; surfaceId: string; start: SitePoint; end: SitePoint }
export type SiteSection = SiteLine & { layers: number; automatic?: boolean; followGlobal?: boolean; groupId?: string }
export type Site = { blocks: SiteBlock[]; guides: SiteLine[]; sections: SiteSection[] }
export type ResolvedBlock = SiteBlock & { base: number; top: number }
export type SiteIssue = { code: string; blocking: boolean; message: string; sectionIds: string[]; blockId?: string }
export type SectionLevels = { firstLayer: number; levels: number[]; firstClearance: number; top: number }
export type SectionSummary = SectionLevels & { id: string; base: number; length: number }
export type SiteLayout = ScaffoldLayout & {
  blocks: ResolvedBlock[]
  sections: SectionSummary[]
  issues: SiteIssue[]
  canExportMaterials: boolean
  spans?: RoutedSpan[]
  joinedLifts?: JoinedLift[]
}

export const GROUND = 'ground'
export const MIN_SECTION_LENGTH = 0.1
export const EMPTY_SITE: Site = { blocks: [], guides: [], sections: [] }
export const mm = (metres: number) => Math.round(metres * 1000)
const m = (millimetres: number) => millimetres / 1000
export const roundSite = (metres: number) => m(mm(metres))
export const siteLength = (line: SiteLine) => roundSite(Math.hypot(line.end.x - line.start.x, line.end.z - line.start.z))
const EPS = 0.001
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
export const sectionLayerCount = (n: number) => Number.isFinite(n) ? clamp(Math.round(n), 1, 20) : 5

export function getSectionLevels(base: number, step: number, layers: number): SectionLevels {
  const groundMm = mm(base), stepMm = Math.max(1, mm(step))
  const firstLayer = Math.floor(groundMm / stepMm) + 1
  const levels = Array.from({ length: sectionLayerCount(layers) }, (_, i) => m((firstLayer + i) * stepMm))
  return { firstLayer, levels, firstClearance: m(mm(levels[0]) - groundMm), top: levels.at(-1)! }
}

export function defaultSectionLayers(base: number, step: number, target: number) {
  const { firstLayer } = getSectionLevels(base, step, 1)
  return { layers: Math.max(1, sectionLayerCount(target) - firstLayer + 1), aboveTarget: firstLayer > sectionLayerCount(target) }
}

export function surfaceElevation(blocks: ResolvedBlock[], id: string) {
  return id === GROUND ? 0 : blocks.find(block => block.id === id)?.top
}

export function containsPoint(rect: Footprint, p: SitePoint, tolerance = EPS) {
  return footprintContainsPoint(rect, p, tolerance)
}

function containsRect(parent: Footprint, child: Footprint) {
  return footprintContains(parent, child)
}

export function resolveBlocks(site: Site): { blocks: ResolvedBlock[]; issues: SiteIssue[] } {
  const byId = new Map(site.blocks.map(block => [block.id, block]))
  const resolved = new Map<string, ResolvedBlock>()
  const issues: SiteIssue[] = []
  const failed = new Set<string>()
  const visiting = new Set<string>()
  const fail = (id: string, message: string) => {
    if (!failed.has(id)) issues.push({ code: 'block-placement', blocking: true, message, sectionIds: [], blockId: id })
    failed.add(id)
  }
  const visit = (id: string): ResolvedBlock | undefined => {
    if (resolved.has(id)) return resolved.get(id)
    if (failed.has(id)) return
    const block = byId.get(id)
    if (!block) return
    if (visiting.has(id)) { fail(id, '体块的叠放关系形成了循环。'); return }
    if (![block.width, block.depth, block.height].every(value => Number.isFinite(value) && value >= 0.001)) {
      fail(id, '体块的长、宽和高度必须大于 0。'); return
    }
    if (block.outline) {
      const shape = footprintFromOutline(block.outline)
      if (!shape || [shape.x - block.x, shape.z - block.z, shape.width - block.width, shape.depth - block.depth].some(n => Math.abs(n) > EPS)) {
        fail(id, '房屋轮廓须为闭合、无自交的水平垂直线。'); return
      }
    }
    visiting.add(id)
    const parent = block.parentId === GROUND ? undefined : visit(block.parentId)
    visiting.delete(id)
    if (block.parentId !== GROUND && (!parent || !containsRect(parent, block))) {
      fail(id, '体块须完整落在父体块顶面。'); return
    }
    const base = parent?.top ?? 0
    const result = { ...block, base, top: roundSite(base + block.height) }
    resolved.set(id, result)
    return result
  }
  const blocks = site.blocks.flatMap(block => {
    const result = visit(block.id)
    return result ? [result] : []
  })
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j]
    if (Math.min(a.top, b.top) - Math.max(a.base, b.base) > EPS &&
        footprintsOverlap(a, b)) {
      fail(b.id, '两个房屋体块在空间内重叠，请移开或叠放。')
    }
  }
  return { blocks, issues }
}

export function blockHasDependents(site: Site, id: string) {
  return site.blocks.some(block => block.parentId === id)
    || site.sections.some(section => section.surfaceId === id)
    || site.guides.some(guide => guide.surfaceId === id)
}

export function rectangleFromGuides(guides: SiteLine[]): Footprint | undefined {
  if (guides.length !== 4 || guides.some(guide => guide.surfaceId !== guides[0].surfaceId)) return
  const points = guides.flatMap(line => [line.start, line.end])
  const xs = [...new Set(points.map(p => mm(p.x)))].sort((a, b) => a - b)
  const zs = [...new Set(points.map(p => mm(p.z)))].sort((a, b) => a - b)
  if (xs.length !== 2 || zs.length !== 2) return
  const edges = new Set<string>()
  for (const { start, end } of guides) {
    const a = [mm(start.x), mm(start.z)], b = [mm(end.x), mm(end.z)]
    if ((a[0] === b[0]) === (a[1] === b[1])) return
    edges.add([a.join(':'), b.join(':')].sort().join('|'))
  }
  return edges.size === 4 ? { x: m(xs[0]), z: m(zs[0]), width: m(xs[1] - xs[0]), depth: m(zs[1] - zs[0]) } : undefined
}

export function siteFromLegacy(drawing: PlanDrawing, layers: number): Site {
  const points = new Map(drawing.points.map(p => [p.id, { x: p.x / PIXELS_PER_METER, z: p.y / PIXELS_PER_METER }]))
  return { ...EMPTY_SITE, sections: drawing.segments.map(line => ({
    id: line.id, surfaceId: GROUND, layers: sectionLayerCount(layers), start: points.get(line.start)!, end: points.get(line.end)!,
  })) }
}

export function drawingFromSections(sections: SiteSection[]): PlanDrawing {
  const points = new Map<string, PlanDrawing['points'][number]>()
  const pointId = (point: SitePoint) => {
    const id = `${mm(point.x)}:${mm(point.z)}`
    if (!points.has(id)) points.set(id, { id, x: point.x * PIXELS_PER_METER, y: point.z * PIXELS_PER_METER })
    return id
  }
  const segments = sections.map(line => ({ id: line.id, start: pointId(line.start), end: pointId(line.end) }))
  return normalizeDrawing({ points: [...points.values()], segments })
}

export function legacySiteDrawing(site: Site): { drawing: PlanDrawing; layers?: number } | undefined {
  const layers = site.sections[0]?.layers
  if (site.blocks.length || site.guides.length || site.sections.some(line => line.surfaceId !== GROUND || line.layers !== layers)) return
  const drawing = drawingFromSections(site.sections)
  return { drawing, layers }
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
function readPoint(value: unknown): SitePoint | undefined {
  const p = object(value)
  return p && number(p.x) && number(p.z) ? { x: p.x, z: p.z } : undefined
}
function readLine(value: unknown): SiteLine | undefined {
  const line = object(value), start = readPoint(line?.start), end = readPoint(line?.end)
  return line && id(line.id) && id(line.surfaceId) && start && end ? { id: line.id, surfaceId: line.surfaceId, start, end } : undefined
}

/** Missing references are retained for diagnostics, never silently moved to ground. */
export function readSite(value: unknown): Site | undefined {
  const raw = object(value)
  if (!raw || !Array.isArray(raw.blocks) || !Array.isArray(raw.guides) || !Array.isArray(raw.sections)) return
  const blocks = raw.blocks.map(value => {
    const b = object(value)
    const outline = b?.outline === undefined ? undefined : Array.isArray(b.outline) ? b.outline.map(readPoint) : null
    if (outline === null || outline?.some(p => !p)) return undefined
    return b && id(b.id) && b.id !== GROUND && id(b.parentId) && number(b.x) && number(b.z)
      && number(b.width) && number(b.depth) && number(b.height)
      ? { id: b.id, parentId: b.parentId, x: b.x, z: b.z, width: b.width, depth: b.depth, height: b.height, ...(outline && { outline: outline as SitePoint[] }) } : undefined
  })
  const guides = raw.guides.map(readLine)
  const sections = raw.sections.map(value => {
    const line = readLine(value), fields = object(value), layers = fields?.layers
    return line && number(layers) ? { ...line, layers: sectionLayerCount(layers),
      ...(fields?.automatic === true && { automatic: true }),
      ...(id(fields?.groupId) && { groupId: fields!.groupId as string }),
      ...(typeof fields?.followGlobal === 'boolean' && { followGlobal: fields.followGlobal }) } : undefined
  })
  const all = [...blocks, ...guides, ...sections]
  if (all.some(item => !item) || new Set(all.map(item => item?.id)).size !== all.length) return
  return { blocks: blocks as SiteBlock[], guides: guides as SiteLine[], sections: sections as SiteSection[] }
}

export function siteFromSnapshot(snapshot: { scene?: Site; points?: PlanDrawing['points']; segments?: PlanDrawing['segments']; parameters?: { layerCount?: number } }): Site {
  return snapshot.scene ?? siteFromLegacy(readDrawing(snapshot.points ?? [], snapshot.segments), snapshot.parameters?.layerCount ?? 5)
}

export function legacySnapshot(site: Site) {
  const drawing = drawingFromSections(site.sections)
  return { ...drawing, lengths: measureDrawing(drawing) }
}

type AxisBox = { min: Vector3Tuple; max: Vector3Tuple }
function entersBox(a: Vector3Tuple, b: Vector3Tuple, box: AxisBox) {
  let start = 0, end = 1
  for (let axis = 0; axis < 3; axis++) {
    const d = b[axis] - a[axis], low = box.min[axis], high = box.max[axis]
    if (Math.abs(d) < 1e-9) {
      if (a[axis] <= low || a[axis] >= high) return false
    } else {
      const u = (low - a[axis]) / d, v = (high - a[axis]) / d
      start = Math.max(start, Math.min(u, v)); end = Math.min(end, Math.max(u, v))
      if (start >= end) return false
    }
  }
  return start < end
}
function planEnters(a: SitePoint, b: SitePoint, block: Footprint) {
  return footprintCells(block).some(cell => entersBox([a.x, 0, a.z], [b.x, 0, b.z], {
    min: [cell.x + EPS, -1, cell.z + EPS], max: [cell.x + cell.width - EPS, 1, cell.z + cell.depth - EPS],
  }))
}
const footprintPolygon = (r: Footprint): PlanPolygon =>
  [[r.x, r.z], [r.x + r.width, r.z], [r.x + r.width, r.z + r.depth], [r.x, r.z + r.depth]]
const coveredArea = (polygons: PlanPolygon[]) => polygons.reduce((total, face) => total + Math.abs(signedArea(face)), 0)

function pipeEntersBlock(a: Vector3Tuple, b: Vector3Tuple, block: ResolvedBlock, radius: number) {
  const vertical = Math.abs(a[0] - b[0]) < EPS && Math.abs(a[2] - b[2]) < EPS
  // Uprights have flat ends: bearing on the top is permitted, penetration is not.
  if (vertical && Math.min(a[1], b[1]) >= block.top - EPS) return false
  const delta = a.map((value, i) => Math.abs(value - b[i]))
  const axis = delta.indexOf(Math.max(...delta))
  const padding = (i: number) => i === axis ? 0 : radius
  return footprintCells(block).some(cell => entersBox(a, b, {
    min: [cell.x - padding(0) + EPS, block.base - padding(1) + EPS, cell.z - padding(2) + EPS],
    max: [cell.x + cell.width + padding(0) - EPS, block.top + padding(1) - EPS, cell.z + cell.depth + padding(2) - EPS],
  }))
}

function meetOnPlan(a: SiteSection, b: SiteSection) {
  const on = (p: SitePoint, line: SiteSection) => {
    const dx = line.end.x - line.start.x, dz = line.end.z - line.start.z
    const length = Math.hypot(dx, dz)
    if (length < EPS) return false
    const x = p.x - line.start.x, z = p.z - line.start.z
    const along = (x * dx + z * dz) / length
    return Math.abs(x * dz - z * dx) / length <= EPS && along >= -EPS && along <= length + EPS
  }
  return on(a.start, b) || on(a.end, b) || on(b.start, a) || on(b.end, a)
}

function footingStations(s: SiteSection, width: number) {
  const length = siteLength(s), dx = -(s.end.z-s.start.z)/length*width, dz = (s.end.x-s.start.x)/length*width
  return [s.start,s.end].map(p=>[p,{x:p.x+dx,z:p.z+dz}])
}
function sharedFootingPair(a: SiteSection, b: SiteSection, width: number) {
  return footingStations(a,width).some(pair=>footingStations(b,width).some(other=>pair.every(p=>other.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<EPS))))
}
function componentGroups(sections: SiteSection[], wallIds = new Set<string>(), width = 0) {
  const groups: SiteSection[][] = []
  const indices = new Map(sections.map((section, i) => [section.id, i]))
  const remaining = new Set(sections)
  for (const first of sections) {
    if (!remaining.delete(first)) continue
    const group = [first]
    for (const current of group) for (const candidate of remaining) {
      if (candidate.surfaceId === current.surfaceId && (candidate.layers === current.layers || candidate.automatic && current.automatic)
        && wallIds.has(candidate.id) === wallIds.has(current.id) && (meetOnPlan(current, candidate) || width > 0 && wallIds.has(current.id) && sharedFootingPair(current, candidate, width))) {
        group.push(candidate); remaining.delete(candidate)
      }
    }
    groups.push(group.sort((a, b) => indices.get(a.id)! - indices.get(b.id)!))
  }
  return groups
}

export function reverseSectionGroup(site: Site, id: string): Site {
  const group = componentGroups(site.sections).find(items => items.some(s => s.id === id))
  if (!group) return site
  const ids = new Set(group.map(s => s.id))
  const reversed = [...group].reverse().map(s => ({ ...s, start: s.end, end: s.start }))
  let i = 0
  return { ...site, sections: site.sections.map(s => ids.has(s.id) ? reversed[i++] : s) }
}

function stockBounds(a: Vector3Tuple, b: Vector3Tuple, radius: number): AxisBox {
  // The model's tubes have flat ends. For axis-aligned tubes the dominant axis
  // needs no padding, so two end-to-end runs aren't mistaken for overlap.
  const delta = a.map((v, i) => Math.abs(v - b[i]))
  const axis = delta.indexOf(Math.max(...delta))
  const padding = (i: number) => i === axis ? 0 : radius
  return {
    min: a.map((v, i) => Math.min(v, b[i]) - padding(i)) as Vector3Tuple,
    max: a.map((v, i) => Math.max(v, b[i]) + padding(i)) as Vector3Tuple,
  }
}
function overlapBoxes(a: AxisBox, b: AxisBox) {
  return a.min.every((v, i) => Math.min(a.max[i], b.max[i]) - Math.max(v, b.min[i]) > EPS)
}

function deckBounds(corners: Vector3Tuple[]): AxisBox {
  return { min: [Math.min(...corners.map(p => p[0])), corners[0][1], Math.min(...corners.map(p => p[2]))],
    max: [Math.max(...corners.map(p => p[0])), corners[0][1] + 0.004, Math.max(...corners.map(p => p[2]))] }
}

function calculateSiteSpans(site: Site, settings: ScaffoldParameters, wallIds = new Set<string>(), transitionEnds = new Map<number, TransitionEnd[]>()): SiteLayout {
  const { blocks, issues } = resolveBlocks(site)
  const summaries: SectionSummary[] = []
  const flat = legacySiteDrawing(site)
  const layout = calculateScaffold([], [], settings)
  layout.warnings = []
  const indexById = new Map(site.sections.map((line, index) => [line.id, index]))
  type ElementBounds = { bounds: AxisBox; sectionId: string; deck?: PlanPolygon[] }
  const physicalGroups: Array<{ bounds: AxisBox; elements: ElementBounds[] }> = []
  let measuredLength = 0
  const minimumLength = flat ? 0.01 : MIN_SECTION_LENGTH
  const label = (sectionId: string) => `第 ${indexById.get(sectionId)! + 1} 段`
  const addIssue = (code: string, sectionIds: string[], message: string, blocking = true) => {
    if (!issues.some(issue => issue.code === code && issue.sectionIds.join('|') === sectionIds.join('|'))) {
      issues.push({ code, sectionIds, message, blocking })
    }
  }
  for (const section of site.sections) {
    const base = surfaceElevation(blocks, section.surfaceId)
    if (base === undefined) {
      addIssue('missing-surface', [section.id], `${label(section.id)}的落脚面不可用，请重新选面。`)
      continue
    }
    const levels = getSectionLevels(base, settings.liftHeight, section.layers)
    summaries.push({ ...levels, id: section.id, base, length: siteLength(section) })
    if (siteLength(section) < minimumLength) addIssue('short-section', [section.id], `${label(section.id)}太短，请调整端点。`)
    const sweep = settings.sweepBarHeight
    if (sweep > 0 && (sweep >= settings.liftHeight || mm(levels.firstClearance) - mm(sweep) < mm(settings.pipeDiameter))) {
      addIssue('sweep-conflict', [section.id], `${label(section.id)}的扫地杆与首层冲突，请调整扫地杆高度或落脚标高。`)
    }
  }
  const eligible = new Set(summaries.filter(summary => summary.length >= minimumLength).map(summary => summary.id))
  const groups = componentGroups(site.sections.filter(s => eligible.has(s.id)), wallIds, settings.width)
  const groupBySection = new Map(groups.flatMap((group, i) => group.map(s => [s.id, i] as const)))
  for (let i = 0; i < site.sections.length; i++) for (let j = i + 1; j < site.sections.length; j++) {
    const a = site.sections[i], b = site.sections[j]
    if (groupBySection.get(a.id) !== groupBySection.get(b.id) && meetOnPlan(a, b)) {
      addIssue('independent-junction', [a.id, b.id], `${label(a.id)}与${label(b.id)}条件不同，交界各自估算，请复核。`, false)
    }
  }
  groups.forEach((group, groupIndex) => {
    const section = group.reduce((highest, line) => line.layers > highest.layers ? line : highest)
    const summary = summaries.find(item => item.id === section.id)!
    const base = summary.base, surface = blocks.find(block => block.id === section.surfaceId)
    const followsWall = wallIds.has(section.id)
    const first = followsWall ? group.find(s => !group.some(other => Math.hypot(other.end.x - s.start.x, other.end.z - s.start.z) < EPS)) : undefined
    const drawing = drawingFromSections(first ? [first, ...group.filter(s => s !== first)] : group)
    if (!drawing.points.length) return
    const owner = (path: number | undefined) => {
      const id = path === undefined ? undefined : drawing.segments[path]?.id
      return group.find(s => s.id === id)?.id ?? group.filter(s => id?.startsWith(s.id + '.')).sort((a, b) => b.id.length - a.id.length)[0]?.id ?? section.id
    }
    if (!flat) {
      const lengths = measureDrawing(drawing, 3)
      const short = [...new Set(lengths.flatMap((length, i) => length < MIN_SECTION_LENGTH ? [owner(i)] : []))]
      if (short.length) {
        for (const id of short) addIssue('short-section', [id], `${label(id)}在交点处分出不足 0.10 m 的短段，请调整端点。`)
        measuredLength += lengths.reduce((total, length) => total + length, 0)
        return
      }
    }
    const localLifts = summary.levels.map(y => roundSite(y - base))
    const swapInnerOuter = followsWall || settings.swapInnerOuter
    const deckLayerOffset = group.some(s => s.automatic) ? summary.firstLayer - 1 : 0
    const variedLayers = group.some(line => line.layers !== section.layers)
      ? drawing.segments.map((_, index) => group.find(line => line.id === owner(index))!.layers) : undefined
    const part = calculateScaffoldPlan(drawing, { ...settings, layerCount: section.layers, swapInnerOuter }, flat ? undefined : localLifts, deckLayerOffset, variedLayers, followsWall)
    measuredLength += part.perimeter
    const prefix = `R${groupIndex + 1}/`
    const elements: ElementBounds[] = []
    const world = ([x, y, z]: Vector3Tuple): Vector3Tuple =>
      [x + drawing.points[0].x / PIXELS_PER_METER, roundSite(y + base), z + drawing.points[0].y / PIXELS_PER_METER]
    const pathIndex = (path: number | undefined) => indexById.get(owner(path))!
    const obstructing = blocks.filter(block => block.id !== surface?.id && block.base <= base + EPS && block.top > base + EPS)
    const supported = (a: SitePoint, b: SitePoint) => {
      if (surface && !footprintSupportsSegment(surface, a, b)) return false
      return !obstructing.some(block =>
        containsPoint(block, a, -EPS) || containsPoint(block, b, -EPS) || planEnters(a, b, block))
    }
    const xz = (p: Vector3Tuple) => ({ x: p[0], z: p[2] })
    const supportIssue = (sid: string, element: string) => addIssue('off-surface', [sid],
      `${label(sid)}的${element}超出或跨越所选落脚面，请调整位置或分段。`)
    const penetration = (sid: string) => addIssue('house-penetration', [sid], `${label(sid)}的架体穿入房屋体块，请调整架段位置。`)
    const memberOwners = new Map(part.members.map(member => [member.id, owner(member.pathSegment)]))
    const radius = settings.pipeDiameter / 2
    for (const line of group) if (!supported(line.start, line.end)) supportIssue(line.id, '绘制线')
    const sharedStations = group.flatMap((a,i)=>group.slice(i+1).flatMap(b=>
      footingStations(a,settings.width).filter(pair=>footingStations(b,settings.width).some(other=>pair.every(p=>other.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<EPS))))
        .map(points=>({points,layers:Math.min(a.layers,b.layers)}))))
    const removed = new Set<string>()
    const members = part.members.map(member => ({ ...member, start: world(member.start), end: world(member.end),
      connectionPoints: member.connectionPoints.map(world), pathSegment: pathIndex(member.pathSegment), cornerJunctions: member.cornerJunctions?.map(pathIndex) }))
      .filter(member => {
        const sharedCap = member.type === 'guardrail' && sharedStations.some(station => (member.layer ?? Infinity) <= station.layers
          && member.connectionPoints.every(p=>station.points.some(q=>Math.hypot(p[0]-q.x,p[2]-q.z)<EPS)))
        const skip = sharedCap || isWallEndGuard(member, transitionEnds.get(member.pathSegment) ?? []) || followsWall && guardFacesWall(member, blocks, Math.max(settings.width, wallStandOff(settings)))
        if (skip) removed.add(member.id)
        return !skip
      })
    const pipeSegments = part.pipeSegments.filter(pipe => !removed.has(pipe.memberId))
      .map(pipe => ({ ...pipe, start: world(pipe.start), end: world(pipe.end) }))
    const connectors = part.connectors.filter(c => !removed.has(c.memberId) && (!c.connectedMemberId || !removed.has(c.connectedMemberId)))
      .map(c => ({ ...c, position: world(c.position) }))
    fitTransitionStock({ members, pipeSegments, connectors }, transitionEnds, radius)
    if (followsWall) fitStockBesideWalls({members, pipeSegments, connectors}, blocks, radius)
    for (const member of members) {
      const start = member.start
      if (member.type === 'post') {
        const { x, z } = xz(start)
        const rim = [{ x: x - radius, z }, { x: x + radius, z }, { x, z: z - radius }, { x, z: z + radius }]
        if (rim.some(p => !supported(p, p))) supportIssue(memberOwners.get(member.id)!, '立杆柱脚')
      }
      layout.members.push({ ...member, id: prefix + member.id })
    }
    for (const beam of part.baseChannels) {
      const start = world(beam.start), end = world(beam.end)
      const half = BASE_CHANNEL_WIDTH / 2
      const dx = -(end[2] - start[2]) / beam.length * half, dz = (end[0] - start[0]) / beam.length * half
      const footprint: PlanPolygon = [[start[0] + dx, start[2] + dz], [end[0] + dx, end[2] + dz],
        [end[0] - dx, end[2] - dz], [start[0] - dx, start[2] - dz]]
      if ((surface && !footprintCoversPolygon(surface, footprint)) || obstructing.some(block =>
        coveredArea([footprint]) - coveredArea(subtractCoverage([footprint], footprintCells(block).map(footprintPolygon))) > 1e-6)) {
        supportIssue(owner(beam.pathSegment), '底座')
      }
      const bounds: AxisBox = {
        min: [Math.min(...footprint.map(p => p[0])), start[1], Math.min(...footprint.map(p => p[1]))],
        max: [Math.max(...footprint.map(p => p[0])), start[1] + BASE_CHANNEL_HEIGHT, Math.max(...footprint.map(p => p[1]))],
      }
      elements.push({ bounds, sectionId: owner(beam.pathSegment) })
      layout.baseChannels.push({ ...beam, id: prefix + beam.id, start, end, pathSegment: pathIndex(beam.pathSegment) })
    }
    for (const pipe of pipeSegments) {
      const { start, end } = pipe, sid = memberOwners.get(pipe.memberId) ?? section.id
      if (blocks.some(block => pipeEntersBlock(start, end, block, radius))) penetration(sid)
      layout.pipeSegments.push({ ...pipe, id: prefix + pipe.id, memberId: prefix + pipe.memberId })
      elements.push({ bounds: stockBounds(start, end, radius), sectionId: sid })
    }
    for (const deck of part.decks) {
      const corners = deck.corners.map(world) as typeof deck.corners
      const coverage = deck.coverage?.map(face => face.map(world))
      const polygons = (coverage ?? [corners]).map(face => face.map(([x, , z]) => [x, z] as [number, number]))
      for (const block of blocks) {
        if (corners[0][1] > block.base + EPS && corners[0][1] < block.top - EPS
            && coveredArea(polygons) - coveredArea(subtractCoverage(polygons, footprintCells(block).map(footprintPolygon))) > 1e-6) penetration(owner(deck.pathSegment))
      }
      elements.push({ sectionId: owner(deck.pathSegment), deck: polygons, bounds: deckBounds(coverage?.flat() ?? corners) })
      layout.decks.push({ ...deck, id: prefix + deck.id, corners, coverage, pathSegment: pathIndex(deck.pathSegment) })
    }
    if (elements.length) physicalGroups.push({
      bounds: elements.reduce<AxisBox>((acc, item) => ({
        min: acc.min.map((v, i) => Math.min(v, item.bounds.min[i])) as Vector3Tuple,
        max: acc.max.map((v, i) => Math.max(v, item.bounds.max[i])) as Vector3Tuple,
      }), elements[0].bounds),
      elements: elements.sort((a, b) => a.bounds.min[0] - b.bounds.min[0]),
    })
    layout.connectors.push(...connectors.map(c => ({ ...c, id: prefix + c.id,
      memberId: prefix + c.memberId, connectedMemberId: c.connectedMemberId ? prefix + c.connectedMemberId : undefined })))
    layout.materials.assemblyPlans.push(...part.materials.assemblyPlans.filter(p => !removed.has(p.memberId))
      .map(p => ({ ...p, memberId: prefix + p.memberId, segmentIds: p.segmentIds.map(id => prefix + id) })))
    for (const d of part.pathDimensions) {
      const index = pathIndex(d.index)
      if (layout.pathDimensions.some(dimension => dimension.index === index)) continue
      const s = site.sections[index]
      const dx = s.end.x - s.start.x, dz = s.end.z - s.start.z, length = siteLength(s)
      // Follow the direction chosen by the path traversal, even for reversed strokes.
      const sign = (d.end[0] - d.start[0]) * dx + (d.end[2] - d.start[2]) * dz < 0 ? -1 : 1
      const offset = sign * (swapInnerOuter ? settings.width + 1.2 : -1.2)
      layout.pathDimensions.push({ index, length, start: [sign > 0 ? s.start.x : s.end.x, base, sign > 0 ? s.start.z : s.end.z], end: [sign > 0 ? s.end.x : s.start.x, base, sign > 0 ? s.end.z : s.start.z],
        labelPosition: [(s.start.x + s.end.x) / 2 - dz / length * offset, base + 0.015, (s.start.z + s.end.z) / 2 + dx / length * offset] })
    }
    layout.warnings.push(...part.warnings.map(w => ({ ...w, id: prefix + w.id,
      message: w.message.replace(/第 (\d+) 段/g, (_, index) => label(owner(Number(index) - 1))) })))
    if (groupIndex === 0) layout.materials.postHeights = part.materials.postHeights
  })
  for (let i = 0; i < physicalGroups.length; i++) for (let j = i + 1; j < physicalGroups.length; j++) {
    const left = physicalGroups[i], right = physicalGroups[j]
    if (!overlapBoxes(left.bounds, right.bounds)) continue
    const colliding = new Set<string>()
    for (const a of left.elements) for (const b of right.elements) {
      if (b.bounds.min[0] >= a.bounds.max[0] - EPS) break
      if (!overlapBoxes(a.bounds, b.bounds)) continue
      if (a.deck && b.deck && coveredArea(a.deck) - coveredArea(subtractCoverage(a.deck, b.deck)) < 1e-6) continue
      colliding.add(a.sectionId); colliding.add(b.sectionId)
    }
    if (colliding.size) {
      const ids = [...colliding].sort((a, b) => indexById.get(a)! - indexById.get(b)!)
      addIssue('independent-overlap', ids, `${ids.map(label).join('、')}的独立架体发生实体重叠，请移开柱脚或调整架段。`)
    }
  }
  layout.pathDimensions.sort((a, b) => a.index - b.index)
  layout.perimeter = roundSite(flat ? measureDrawing(flat.drawing).reduce((sum, length) => sum + length, 0)
    : measuredLength + site.sections.filter(line => !groupBySection.has(line.id)).reduce((sum, line) => sum + siteLength(line), 0))
  layout.materials = calculateMaterials(layout.members, layout.pipeSegments, layout.decks, layout.connectors,
    layout.baseChannels, settings, layout.materials.assemblyPlans, layout.materials.postHeights)
  return { ...layout, blocks, sections: summaries, issues, canExportMaterials: !issues.some(issue => issue.blocking) }
}

/** Target lift number measured from the lowest ground, including independent faces. */
export function sectionTargetLayer(section: SiteSection, settings: ScaffoldParameters, blocks: ResolvedBlock[]): number {
  if (section.automatic) return sectionLayerCount(section.followGlobal === false ? section.layers : settings.layerCount)
  const base = surfaceElevation(blocks, section.surfaceId) ?? 0
  const first = getSectionLevels(base, settings.liftHeight, 1).firstLayer
  const count = section.followGlobal ? defaultSectionLayers(base, settings.liftHeight, settings.layerCount).layers : section.layers
  return first + count - 1
}

export function siteWithTargetLayers(site: Site, settings: ScaffoldParameters, blocks = resolveBlocks(site).blocks): Site {
  return { ...site, sections: site.sections.map(section => {
    if (section.automatic) return { ...section, layers: sectionTargetLayer(section, settings, blocks) }
    if (section.followGlobal) {
      const base = surfaceElevation(blocks, section.surfaceId)
      if (base !== undefined) return { ...section, layers: defaultSectionLayers(base, settings.liftHeight, settings.layerCount).layers }
    }
    return section
  }) }
}

export function calculateSite(input: Site, settings: ScaffoldParameters): SiteLayout {
  const { blocks } = resolveBlocks(input)
  const site = siteWithTargetLayers(input, settings, blocks)
  if (!site.blocks.length || !site.sections.some(section => section.automatic)) return calculateSiteSpans(site, settings)
  const { spans, transitions, errors } = routeSiteSections(site.sections, blocks, settings)
  const wallIds = new Set(spans.filter(span => span.wall).map(span => span.line.id))
  const sourceIds = new Map(spans.map(span => [span.line.id, span.sourceId]))
  const indices = new Map(spans.map((span, index) => [span.line.id, index]))
  const transitionEnds = new Map<number, TransitionEnd[]>()
  for (const { before, after, boundary } of transitions) {
    const leftBase = surfaceElevation(blocks, before.surfaceId) ?? 0, rightBase = surfaceElevation(blocks, after.surfaceId) ?? 0
    if (mm(leftBase) === mm(rightBase)) continue
    const axis = before.start.x === before.end.x ? 2 : 0
    const coordinate = (point: SitePoint) => axis === 2 ? point.z : point.x
    const lowFirst = leftBase < rightBase, low = lowFirst ? before : after
    const station = coordinate(lowFirst ? before.end : after.start)
    const roofStation = coordinate(lowFirst ? after.start : before.end)
    const index = indices.get(low.id)!
    const ends = transitionEnds.get(index) ?? []
    ends.push({ axis, boundary, station, roof: Math.max(leftBase, rightBase), towardRoof: Math.sign(roofStation - station), wall: wallIds.has(low.id) })
    transitionEnds.set(index, ends)
  }
  const spanLayout = calculateSiteSpans({ ...site, sections: spans.map(span => span.line) }, settings, wallIds, transitionEnds)
  const labels = new Map(site.sections.map((line, i) => [line.id, i + 1]))
  const issues = spanLayout.issues.map(issue => ({ ...issue,
    message: issue.message.replace(/第 (\d+) 段/g, (_, index) => `第 ${labels.get(spans[Number(index) - 1]?.sourceId) ?? index} 段`),
    sectionIds: [...new Set(issue.sectionIds.map(id => sourceIds.get(id) ?? id))],
  }))
  for (const error of errors) issues.push({ code: 'automatic-route', blocking: true, sectionIds: [error.id],
    message: `第 ${labels.get(error.id)} 段${error.message}` })
  const result = connectSiteTransitions(spanLayout, spans, spanLayout.sections, transitions, settings)
  if (result.layout !== spanLayout) {
    fitTransitionStock(result.layout, transitionEnds, settings.pipeDiameter / 2)
    fitStockBesideWalls(result.layout, blocks, settings.pipeDiameter / 2)
  }
  for (const { before, after } of result.failed) {
    const ids = [...new Set([before.id, after.id].map(id => sourceIds.get(id) ?? id))]
    issues.push({ code: 'unjoined-transition', blocking: true, sectionIds: ids,
      message: `第 ${labels.get(ids[0])} 段高差交界的同层杆件无法接通，请检查排距、跨距和落脚面。` })
  }
  if (result.joined.length) {
    const memberById = new Map(result.layout.members.map(member => [member.id, member]))
    const penetrations = new Set<string>()
    const radius = settings.pipeDiameter / 2
    const physical = result.layout.pipeSegments.map(pipe => ({
      index: memberById.get(pipe.memberId)?.pathSegment, bounds: stockBounds(pipe.start, pipe.end, radius),
    }))
    physical.push(...result.layout.decks.map(deck => ({ index: deck.pathSegment, bounds: deckBounds(deck.coverage?.flat() ?? deck.corners) })))
    physical.push(...result.layout.baseChannels.map(beam => {
      const bounds = stockBounds(beam.start, beam.end, BASE_CHANNEL_WIDTH / 2)
      bounds.min[1] = beam.start[1]; bounds.max[1] = beam.start[1] + BASE_CHANNEL_HEIGHT
      return { index: beam.pathSegment, bounds }
    }))
    for (const pipe of result.layout.pipeSegments) {
      if (!blocks.some(block => pipeEntersBlock(pipe.start, pipe.end, block, radius))) continue
      const span = spans[memberById.get(pipe.memberId)?.pathSegment ?? -1]
      if (span) penetrations.add(span.sourceId)
    }
    for (const bridge of result.bridges) {
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
      if (overlapping.size) issues.push({ code: 'bridge-overlap', blocking: true, sectionIds: [...new Set([sourceId, ...overlapping])],
        message: `第 ${labels.get(sourceId)} 段的高差接通区与其他架体重叠，请调整路线。` })
    }
    for (const id of penetrations) if (!issues.some(issue => issue.code === 'house-penetration' && issue.sectionIds.includes(id))) {
      issues.push({ code: 'house-penetration', blocking: true, sectionIds: [id], message: `第 ${labels.get(id)} 段接通后的杆件穿入体块，请调整路线。` })
    }
  }
  const pathDimensions = result.layout.pathDimensions.map(dimension => {
    const span = spans[dimension.index]
    const siblings = spans.filter(item => item.sourceId === span.sourceId)
    const labelIndex = String(labels.get(span.sourceId)) + (siblings.length > 1 ? `.${siblings.indexOf(span) + 1}` : '')
    return { ...dimension, labelIndex }
  })
  return { ...result.layout, pathDimensions, blocks, sections: spanLayout.sections, spans, joinedLifts: result.joined, issues,
    perimeter: roundSite(site.sections.reduce((total, line) => total + siteLength(line), 0)),
    canExportMaterials: !issues.some(issue => issue.blocking) }
}
