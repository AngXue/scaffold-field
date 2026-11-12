import { mm, sectionLayerCount, surfaceElevation, resolveBlocks, type Site, type SiteSection, type ResolvedBlock, type SectionLevels } from '../../site.ts'
import type { ScaffoldParameters } from '../../scaffold.ts'
const m = (millimetres: number) => millimetres / 1000

/** I04/I05: global millimetre lift grid and independent/following layer targets. */
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
