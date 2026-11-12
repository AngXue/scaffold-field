import type { Site, SiteLayout } from '../../site.ts'
import { siteWithTargetLayers } from '../policies/levels.ts'
import { calculateScaffoldPlan, type ScaffoldParameters, type MaterialAdjustments, type Point2D } from '../../scaffold.ts'
import { measureDrawing, type PlanSegment } from '../../plan.ts'
import { readSite, siteFromSnapshot, legacySiteDrawing } from './sceneFiles.ts'
import { restoreParameters } from './parameters.ts'
export type StoredProject = { scene: Site; parameters: ScaffoldParameters; adjustments: MaterialAdjustments }
/** Persistence is data-only; browsers and native hosts choose where to store it. */
export function readProject(raw: string): StoredProject | null {
  try {
    const snapshot = JSON.parse(raw) as { scene?: unknown; points?: Point2D[]; segments?: PlanSegment[];
      parameters?: Partial<ScaffoldParameters>; adjustments?: MaterialAdjustments }
    const parameters = restoreParameters(snapshot.parameters)
    const scene = snapshot.scene === undefined && Array.isArray(snapshot.points)
      ? siteFromSnapshot({ ...snapshot, scene: undefined, parameters }) : readSite(snapshot.scene)
    return scene ? { scene, parameters, adjustments: snapshot.adjustments ?? {} } : null
  } catch { return null }
}
export function projectSnapshot(scene: Site, parameters: ScaffoldParameters, adjustments: MaterialAdjustments) {
  return { version: '0.7' as const, scene, parameters, adjustments }
}
export function compatibleDrawing(site: Site, settings: ScaffoldParameters) {
  return site.blocks.length ? undefined : legacySiteDrawing(siteWithTargetLayers(site, settings, []))
}
export function exportSceneProject(site: Site, settings: ScaffoldParameters, adjustments: MaterialAdjustments, layout: SiteLayout) {
  return { ...projectSnapshot(site, settings, adjustments), ...(layout.canExportMaterials ? { layout } : {}) }
}
export function exportOAProject(site: Site, settings: ScaffoldParameters, adjustments: MaterialAdjustments, layout: SiteLayout) {
  const legacy = compatibleDrawing(site, settings)
  if (!legacy || !layout.canExportMaterials) return undefined
  const lengths = measureDrawing(legacy.drawing), parameters = { ...settings, layerCount: legacy.layers ?? settings.layerCount }
  return { version: '0.6' as const, ...legacy.drawing, lengths, parameters, adjustments, layout: calculateScaffoldPlan(legacy.drawing, parameters) }
}
