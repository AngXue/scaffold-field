import type { ScaffoldAssembly } from './rules/facts/draft.ts'
import { resolveHeightStages } from './rules/heights.ts'
import { normalizeKernelParameters } from './rules/boundaries/parameters.ts'
import { calculationSession, type DiagnosedLayout } from './rules/diagnostics/session.ts'
import { sectionDimension, sourceDimensions, sourcePerimeter } from './rules/boundaries/dimensions.ts'
import { legacySiteDrawing, drawingFromSections } from './rules/boundaries/sceneFiles.ts'
export { siteFromLegacy, drawingFromSections, legacySiteDrawing, readSite, siteFromSnapshot, legacySnapshot } from './rules/boundaries/sceneFiles.ts'
import { validateSectionInputs } from './rules/sectionValidation.ts'
import { independentPipeScopes } from './rules/policies/siteValidation.ts'
import { splitLengthIssues } from './rules/policies/sectionValidation.ts'
import { validatePhysicalChecks, validateIndependentGroups, validateBridges } from './rules/siteValidation.ts'
import type { PhysicalCheck, ElementBounds, PhysicalGroup } from './rules/policies/siteValidation.ts'
import { stockBounds, deckBounds, type AxisBox } from './rules/policies/collisionGeometry.ts'
import { appendIssue, sourcedIssue, mapIssueSources } from './rules/facts/issues.ts'
import { resolveGuardRemovals } from './rules/guardRemovals.ts'
import { mm, metresFromMm as m, roundSite, SITE_EPS as EPS } from './rules/facts/precision.ts'
import { componentGroups } from './rules/groups.ts'
import { meetOnPlan, footingStations } from './rules/policies/groups.ts'
import { CONNECTOR_CONTACT } from './rules/facts/connections.ts'
import { MEMBER_USES, transformUses, memberUses } from './rules/facts/memberUses.ts'
import { resolveBlocks } from './rules/policies/blocks.ts'
export { resolveBlocks } from './rules/policies/blocks.ts'
export { getSectionLevels, defaultSectionLayers, sectionTargetLayer, siteWithTargetLayers } from './rules/policies/levels.ts'
import { prepareScene } from './rules/scene.ts'
import { measureDrawing, PIXELS_PER_METER } from './plan.ts'
import { BASE_CHANNEL_HEIGHT, BASE_CHANNEL_WIDTH, publishScaffoldAssembly, finishPreparedScaffoldAssembly, prepareScaffoldPlan, prepareScaffoldAssembly, type ScaffoldLayout, type ScaffoldParameters, type Vector3Tuple } from './scaffold.ts'
import type { PlanPolygon } from './polygons.ts'
import { footprintContainsPoint } from './siteFootprints.ts'
import { positionSiteStock } from './siteWallFit.ts'
import { routeSiteSections, wallStandOff, type RoutedSpan } from './siteRouting.ts'
import { connectSiteTransitions, type JoinedLift, type TransitionEnd } from './siteTransitions.ts'

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
export { mm, roundSite } from './rules/facts/precision.ts'
export const siteLength = (line: SiteLine) => roundSite(Math.hypot(line.end.x - line.start.x, line.end.z - line.start.z))

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
export const sectionLayerCount = (n: number) => Number.isFinite(n) ? clamp(Math.round(n), 1, 20) : 5





export function surfaceElevation(blocks: ResolvedBlock[], id: string) {
  return id === GROUND ? 0 : blocks.find(block => block.id === id)?.top
}

export function containsPoint(rect: Footprint, p: SitePoint, tolerance = EPS) {
  return footprintContainsPoint(rect, p, tolerance)
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

export function reverseSectionGroup(site: Site, id: string): Site {
  const group = componentGroups(site.sections).find(items => items.some(s => s.id === id))
  if (!group) return site
  const ids = new Set(group.map(s => s.id))
  const reversed = [...group].reverse().map(s => ({ ...s, start: s.end, end: s.start }))
  let i = 0
  return { ...site, sections: site.sections.map(s => ids.has(s.id) ? reversed[i++] : s) }
}

type SiteAssembly = ScaffoldAssembly & Omit<SiteLayout, keyof ScaffoldLayout>

function prepareSiteSpans(site: Site, settings: ScaffoldParameters, wallIds = new Set<string>(), transitionEnds = new Map<number, TransitionEnd[]>(), resolution = resolveBlocks(site)) {
  const { blocks } = resolution
  const issues = [...resolution.issues]
  const flat = legacySiteDrawing(site)
  // Assembly plans and height labels are draft metadata, not a provisional BOM.
  const layout: ScaffoldAssembly = {
    pathDimensions: [], perimeter: 0, members: [], pipeSegments: [], decks: [], connectors: [], baseChannels: [], warnings: [],
    assemblyPlans: [], postHeights: { theoretical: 0, inner: 0, outer: 0 },
  }
  const indexById = new Map(site.sections.map((line, index) => [line.id, index]))
  const physicalGroups: PhysicalGroup[] = []
  const completions: Array<{ prefix: string; complete: () => Pick<ScaffoldAssembly, 'pipeSegments' | 'connectors' | 'assemblyPlans'>; release: () => void }> = []
  const validations: Array<{ groupIndex: number; validate: (physical: { checks: PhysicalCheck[]; elements: ElementBounds[] }) => void }> = []
  let measuredLength = 0
  const minimumLength = flat ? 0.01 : MIN_SECTION_LENGTH
  const label = (sectionId: string) => `第 ${indexById.get(sectionId)! + 1} 段`
  const labels = Object.fromEntries(site.sections.map(line => [line.id, label(line.id)]))
  const addIssue = (code: string, sectionIds: string[], message: string, blocking = true) => appendIssue(issues, sourcedIssue('G07', { code, sectionIds, message, blocking }))
  const inputs = validateSectionInputs(site.sections, blocks, settings, minimumLength)
  const summaries = inputs.summaries
  for (const issue of inputs.issues) appendIssue(issues, issue)
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
      const short = splitLengthIssues(lengths, lengths.map((_, i) => owner(i)), labels, MIN_SECTION_LENGTH)
      if (short.length) {
        for (const issue of short) appendIssue(issues, issue)
        measuredLength += lengths.reduce((total, length) => total + length, 0)
        return
      }
    }
    const localLifts = summary.levels.map(y => roundSite(y - base))
    const swapInnerOuter = followsWall || settings.swapInnerOuter
    const deckLayerOffset = group.some(s => s.automatic) ? summary.firstLayer - 1 : 0
    const variedLayers = group.some(line => line.layers !== section.layers)
      ? drawing.segments.map((_, index) => group.find(line => line.id === owner(index))!.layers) : undefined
    const requiredEndPairs = drawing.segments.map((segment, index): [boolean, boolean] => {
      const ends = transitionEnds.get(indexById.get(owner(index))!) ?? []
      return [segment.start, segment.end].map(id => {
        const point = drawing.points.find(p => p.id === id)!
        return ends.some(end => mm(end.station) === mm((end.axis === 0 ? point.x : point.y) / PIXELS_PER_METER))
      }) as [boolean, boolean]
    })
    const plan = prepareScaffoldPlan(drawing, { ...settings, layerCount: section.layers, swapInnerOuter }, flat ? undefined : localLifts, deckLayerOffset, variedLayers, followsWall, requiredEndPairs)
    const preparation = prepareScaffoldAssembly(plan.draft)
    const part: ScaffoldAssembly = plan.toPlan({ ...preparation.draft,
      members: preparation.draft.members.map(member => ({ ...member })),
      decks: preparation.draft.decks.map(deck => ({ ...deck })), baseChannels: preparation.draft.baseChannels.map(base => ({ ...base })),
      pathDimensions: preparation.draft.pathDimensions.map(dimension => ({ ...dimension })),
      // Only uprights exist physically before the global high/low joins are settled.
      pipeSegments: preparation.posts.flatMap(post => post.segments.map(pipe => ({ ...pipe }))), connectors: [],
      assemblyPlans: preparation.posts.map(post => post.plan),
      perimeter: roundSite(preparation.draft.pathDimensions.reduce((sum, dimension) => sum + dimension.length, 0)),
    })
    measuredLength += part.perimeter
    const prefix = `R${groupIndex + 1}/`
    const elements: ElementBounds[] = []
    const world = ([x, y, z]: Vector3Tuple): Vector3Tuple =>
      [x + drawing.points[0].x / PIXELS_PER_METER, roundSite(y + base), z + drawing.points[0].y / PIXELS_PER_METER]
    const pathIndex = (path: number | undefined) => indexById.get(owner(path))!
    const obstructing = blocks.filter(block => block.id !== surface?.id && block.base <= base + EPS && block.top > base + EPS)
    const checks: PhysicalCheck[] = group.map(line => ({ kind: 'line', sectionId: line.id, a: line.start, b: line.end }))
    const memberOwners = new Map(part.members.map(member => [member.id, owner(member.pathSegment)]))
    const radius = settings.pipeDiameter / 2
    const sharedStations = group.flatMap((a,i)=>group.slice(i+1).flatMap(b=>
      footingStations(a,settings.width).filter(pair=>footingStations(b,settings.width).some(other=>pair.every(p=>other.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<EPS))))
        .map(points=>({points,layers:Math.min(a.layers,b.layers)}))))
    const transformedMembers = part.members.map(member => ({ ...member,
      [MEMBER_USES]: transformUses(member, world, use => ({ pathSegment: pathIndex(use.pathSegment), sectionId: owner(use.pathSegment), spanId: owner(use.pathSegment) })), start: world(member.start), end: world(member.end),
      connectionPoints: member.connectionPoints.map(world), pathSegment: pathIndex(member.pathSegment), cornerJunctions: member.cornerJunctions?.map(pathIndex) }))
    const removed = new Set(resolveGuardRemovals({ members: transformedMembers, ends: [...transitionEnds], blocks,
      followsWall, clearance: Math.max(settings.width, wallStandOff(settings)), stations: sharedStations }))
    const members = transformedMembers.filter(member => !removed.has(member.id))
    const pipeSegments = part.pipeSegments.filter(pipe => !removed.has(pipe.memberId))
      .map(pipe => ({ ...pipe, start: world(pipe.start), end: world(pipe.end) }))
    const connectors = part.connectors.filter(c => !removed.has(c.memberId) && (!c.connectedMemberId || !removed.has(c.connectedMemberId)))
      .map(c => ({ ...c, position: world(c.position), ...(c[CONNECTOR_CONTACT] && { [CONNECTOR_CONTACT]: world(c[CONNECTOR_CONTACT]) }) }))
    // Validation closures outlive assembly. Keep bulky local construction facts
    // in one releasable cell rather than retaining them through shared closures.
    const pending = { value: { preparation, toPlan: plan.toPlan, members, decks: part.decks } as {
      preparation: typeof preparation; toPlan: typeof plan.toPlan; members: typeof members; decks: typeof part.decks;
    } | undefined }
    completions.push({ prefix, release: () => { pending.value = undefined }, complete: () => {
      const { preparation, toPlan, members, decks } = pending.value!
      const physical = finishPreparedScaffoldAssembly(preparation)
      // Logical world geometry was committed above. Only new physical records
      // need this coordinate conversion; do not transform every member twice.
      const completed = toPlan({ ...physical, members: [], decks: [], baseChannels: [], pathDimensions: [] })
      const finalPipes = completed.pipeSegments.filter(pipe => !removed.has(pipe.memberId)).map(pipe => ({ ...pipe, start: world(pipe.start), end: world(pipe.end) }))
      const finalConnectors = completed.connectors.filter(c => !removed.has(c.memberId) && (!c.connectedMemberId || !removed.has(c.connectedMemberId)))
        .map(c => ({ ...c, position: world(c.position), ...(c[CONNECTOR_CONTACT] && { [CONNECTOR_CONTACT]: world(c[CONNECTOR_CONTACT]) }) }))
      positionSiteStock({ members, pipeSegments: finalPipes, connectors: finalConnectors, decks: decks.map(deck => ({ ...deck, corners: deck.corners.map(world) as typeof deck.corners,
        coverage: deck.coverage?.map(face => face.map(world)) })) }, blocks, radius, transitionEnds, followsWall)
      return { pipeSegments: finalPipes.map(pipe => ({ ...pipe, id: prefix + pipe.id, memberId: prefix + pipe.memberId })),
        connectors: finalConnectors.map(c => ({ ...c, id: prefix + c.id, memberId: prefix + c.memberId, connectedMemberId: c.connectedMemberId ? prefix + c.connectedMemberId : undefined })),
        assemblyPlans: completed.assemblyPlans.filter(p => !removed.has(p.memberId)).map(p => ({ ...p, memberId: prefix + p.memberId, segmentIds: p.segmentIds.map(id => prefix + id) })) }
    } })
    for (const member of members) {
      if (member.type === 'post') checks.push({ kind: 'post', sectionId: memberOwners.get(member.id)!, point: member.start })
      layout.members.push({ ...member, id: prefix + member.id })
    }
    for (const beam of part.baseChannels) {
      const start = world(beam.start), end = world(beam.end)
      const half = BASE_CHANNEL_WIDTH / 2
      const dx = -(end[2] - start[2]) / beam.length * half, dz = (end[0] - start[0]) / beam.length * half
      const footprint: PlanPolygon = [[start[0] + dx, start[2] + dz], [end[0] + dx, end[2] + dz],
        [end[0] - dx, end[2] - dz], [start[0] - dx, start[2] - dz]]
      checks.push({ kind: 'base', sectionId: owner(beam.pathSegment), footprint })
      const bounds: AxisBox = {
        min: [Math.min(...footprint.map(p => p[0])), start[1], Math.min(...footprint.map(p => p[1]))],
        max: [Math.max(...footprint.map(p => p[0])), start[1] + BASE_CHANNEL_HEIGHT, Math.max(...footprint.map(p => p[1]))],
      }
      elements.push({ bounds, sectionId: owner(beam.pathSegment) })
      layout.baseChannels.push({ ...beam, id: prefix + beam.id, start, end, pathSegment: pathIndex(beam.pathSegment) })
    }
    for (const pipe of pipeSegments) {
      layout.pipeSegments.push({ ...pipe, id: prefix + pipe.id, memberId: prefix + pipe.memberId })
    }
    for (const deck of part.decks) {
      const corners = deck.corners.map(world) as typeof deck.corners
      const coverage = deck.coverage?.map(face => face.map(world))
      const polygons = (coverage ?? [corners]).map(face => face.map(([x, , z]) => [x, z] as [number, number]))
      checks.push({ kind: 'deck', sectionId: owner(deck.pathSegment), elevation: corners[0][1], polygons })
      elements.push({ sectionId: owner(deck.pathSegment), deck: polygons, bounds: deckBounds(coverage?.flat() ?? corners) })
      layout.decks.push({ ...deck, id: prefix + deck.id, corners, coverage, pathSegment: pathIndex(deck.pathSegment) })
    }
    validations.push({ groupIndex, validate: physical => {
      checks.push(...physical.checks)
      elements.push(...physical.elements)
      for (const issue of validatePhysicalChecks(checks, { blocks, surface, obstructing, radius, labels })) appendIssue(issues, issue)
      if (elements.length) physicalGroups.push({
        bounds: elements.reduce<AxisBox>((acc, item) => ({
          min: acc.min.map((v, i) => Math.min(v, item.bounds.min[i])) as Vector3Tuple,
          max: acc.max.map((v, i) => Math.max(v, item.bounds.max[i])) as Vector3Tuple,
        }), elements[0].bounds),
        elements: elements.sort((a, b) => a.bounds.min[0] - b.bounds.min[0]),
      })
    } })
    layout.connectors.push(...connectors.map(c => ({ ...c, id: prefix + c.id,
      memberId: prefix + c.memberId, connectedMemberId: c.connectedMemberId ? prefix + c.connectedMemberId : undefined })))
    layout.assemblyPlans.push(...part.assemblyPlans.filter(p => !removed.has(p.memberId))
      .map(p => ({ ...p, memberId: prefix + p.memberId, segmentIds: p.segmentIds.map(id => prefix + id) })))
    for (const d of part.pathDimensions) {
      const index = pathIndex(d.index)
      if (layout.pathDimensions.some(dimension => dimension.index === index)) continue
      const s = site.sections[index]
      layout.pathDimensions.push(sectionDimension(index, s, d, base, swapInnerOuter, settings.width))
    }
    layout.warnings.push(...part.warnings.map(w => ({ ...w, id: prefix + w.id,
      message: w.message.replace(/第 (\d+) 段/g, (_, index) => label(owner(Number(index) - 1))) })))
    if (groupIndex === 0) layout.postHeights = part.postHeights
  })
  layout.pathDimensions.sort((a, b) => a.index - b.index)
  layout.perimeter = roundSite(flat ? measureDrawing(flat.drawing).reduce((sum, length) => sum + length, 0)
    : measuredLength + site.sections.filter(line => !groupBySection.has(line.id)).reduce((sum, line) => sum + siteLength(line), 0))
  if (!groups.length || !layout.members.length) {
    const profile = resolveHeightStages(normalizeKernelParameters(settings), [], undefined, 0).profiles[0]
    layout.postHeights = { theoretical: profile.height.theoretical,
      inner: profile.support.rowTops[profile.height.innerRow], outer: profile.support.rowTops[profile.height.outerRow] }
  }
  const preview: SiteAssembly = { ...layout, blocks, sections: summaries, issues, canExportMaterials: !issues.some(issue => issue.blocking) }
  return { preview, finish: (resolved: ScaffoldAssembly = preview, affected: readonly string[] = []): SiteAssembly => {
    const changed = new Set(affected)
    const additions: Pick<ScaffoldAssembly, 'pipeSegments' | 'connectors' | 'assemblyPlans'>[] = []
    completions.reverse()
    while (completions.length) {
      const completion = completions.pop()!
      try { if (!changed.has(completion.prefix.slice(0, -1))) additions.push(completion.complete()) }
      finally { completion.release() }
    }
    const retained = (id: string) => changed.has(id.split('/')[0]) || (changed.size > 0 && id.startsWith('transition-'))
    const final: SiteAssembly = { ...preview, ...resolved,
      pipeSegments: [...additions.flatMap(part => part.pipeSegments), ...resolved.pipeSegments.filter(pipe => retained(pipe.memberId))],
      connectors: [...additions.flatMap(part => part.connectors), ...resolved.connectors.filter(connector => retained(connector.memberId))],
      assemblyPlans: [...additions.flatMap(part => part.assemblyPlans), ...resolved.assemblyPlans.filter(plan => retained(plan.memberId))],
    }
    if (changed.size) positionSiteStock(final, blocks, settings.pipeDiameter / 2, transitionEnds)
    const finalMembers = new Map(final.members.map(member => [member.id, member]))
    const physical = groups.map(() => ({ checks: [] as PhysicalCheck[], elements: [] as ElementBounds[] }))
    for (const pipe of final.pipeSegments) {
      const member = finalMembers.get(pipe.memberId)!
      const sectionId = site.sections[member.pathSegment ?? -1]?.id, owner = groupBySection.get(sectionId)
      if (owner !== undefined) physical[owner].checks.push({ kind: 'pipe', sectionId, start: pipe.start, end: pipe.end })
      for (const scope of independentPipeScopes(pipe, member, site.sections, groupBySection)) if (scope.group !== undefined) {
        physical[scope.group].elements.push({ bounds: stockBounds(scope.start, scope.end, settings.pipeDiameter / 2), sectionId: scope.sectionId })
      }
    }
    validations.reverse()
    while (validations.length) {
      const { groupIndex, validate } = validations.pop()!
      validate(physical[groupIndex])
      // Only compact collision bounds remain needed after this group's support
      // and penetration findings are committed. Do not retain all check scopes.
      physical[groupIndex].checks.length = 0
      physical[groupIndex].elements.length = 0
    }
    for (const issue of validateIndependentGroups(physicalGroups, site.sections.map(line => line.id), labels)) appendIssue(issues, issue)
    final.canExportMaterials = !issues.some(issue => issue.blocking)
    return final
  } }
}
function calculateSiteSpans(...args: Parameters<typeof prepareSiteSpans>): SiteAssembly {
  return prepareSiteSpans(...args).finish()
}

/** Target lift number measured from the lowest ground, including independent faces. */




export function calculateSite(input: Site, settings: ScaffoldParameters, options: { trace?: boolean } = {}): DiagnosedLayout {
  return calculationSession(input, settings, () => calculateScene(input, settings), options.trace)
}
function calculateScene(input: Site, settings: ScaffoldParameters): SiteLayout {
  return publishScaffoldAssembly(assembleSite(input, settings), settings)
}
function assembleSite(input: Site, settings: ScaffoldParameters): SiteAssembly {
  const prepared = prepareScene(input, settings)
  const { site, blocks } = prepared
  settings = prepared.parameters
  if (!site.blocks.length) return calculateSiteSpans(site, settings, undefined, undefined, prepared.resolution)
  const { spans, transitions, errors } = routeSiteSections(site.sections, blocks, settings)
  if (!site.sections.some(section => section.automatic) && !spans.some(span => span.wall)) return calculateSiteSpans(site, settings, undefined, undefined, prepared.resolution)
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
  const staged = prepareSiteSpans({ ...site, sections: spans.map(span => span.line) }, settings, wallIds, transitionEnds, prepared.resolution)
  const connected = connectSiteTransitions(staged.preview, spans, staged.preview.sections, transitions, settings)
  const spanLayout = staged.finish(connected.layout, connected.affected)
  const result = { ...connected, layout: spanLayout }
  const labels = new Map(site.sections.map((line, i) => [line.id, i + 1]))
  const issues = spanLayout.issues.map(issue => ({ ...mapIssueSources(issue, sourceIds),
    message: issue.message.replace(/第 (\d+) 段/g, (_, index) => `第 ${labels.get(spans[Number(index) - 1]?.sourceId) ?? index} 段`),
  }))
  for (const error of errors) issues.push(sourcedIssue('G02', { code: 'automatic-route', blocking: true, sectionIds: [error.id],
    message: `第 ${labels.get(error.id)} 段${error.message}` }))
  for (const { before, after } of result.failed) {
    const ids = [...new Set([before.id, after.id].map(id => sourceIds.get(id) ?? id))]
    issues.push(sourcedIssue('P05', { code: 'unjoined-transition', blocking: true, sectionIds: ids,
      message: `第 ${labels.get(ids[0])} 段高差交界的同层杆件无法接通，请检查排距、跨距和落脚面。` }))
  }
  if (result.joined.length) issues.push(...validateBridges({ layout: result.layout, blocks, spans, bridges: result.bridges, joined: result.joined,
    radius: settings.pipeDiameter / 2, labels: [...labels], previous: issues }))
  const pathDimensions = sourceDimensions(result.layout.pathDimensions, spans, labels)
  const members = result.layout.members.map(member => ({ ...member,
    [MEMBER_USES]: memberUses(member).map(use => ({ ...use, sectionId: spans[use.pathSegment]?.sourceId ?? use.sectionId, spanId: spans[use.pathSegment]?.line.id ?? use.spanId })),
  }))
  return { ...result.layout, members, pathDimensions, blocks, sections: spanLayout.sections, spans, joinedLifts: result.joined, issues,
    perimeter: sourcePerimeter(site.sections),
    canExportMaterials: !issues.some(issue => issue.blocking) }
}
