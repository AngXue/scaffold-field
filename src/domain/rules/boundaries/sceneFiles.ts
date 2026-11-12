import { GROUND, EMPTY_SITE, sectionLayerCount, type Site, type SitePoint, type SiteLine, type SiteBlock, type SiteSection } from '../../site.ts'
import { readDrawing, normalizeDrawing, measureDrawing, PIXELS_PER_METER, type PlanDrawing } from '../../plan.ts'
import { mm } from '../facts/precision.ts'
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

