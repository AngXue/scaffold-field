import { expect, it } from 'vitest'
import { calculateSite, GROUND, siteFromSnapshot, legacySnapshot } from '../../site'
import { DEFAULT_PARAMETERS, calculateScaffoldPlan } from '../../scaffold'
import { SITE_DEMOS } from '../../siteDemos'
import { addHistoryRecord, parseHistory, serialiseHistory } from '../../history'
import { readProject, projectSnapshot, compatibleDrawing, exportSceneProject, exportOAProject } from './projects'
import { sourcePerimeter } from './dimensions'

it('saves invalid drafts with original references and manual deltas, but cannot export an OA material result', () => {
  const site = { blocks: [], guides: [], sections: [{ id: 'S1', surfaceId: 'missing', layers: 3, start: { x: 0, z: 0 }, end: { x: 4, z: 0 } }] }
  const layout = calculateSite(site, DEFAULT_PARAMETERS), delta = { 'pipe-6': 2, cross: 30 }
  expect(layout.canExportMaterials).toBe(false)
  const document = exportSceneProject(site, DEFAULT_PARAMETERS, delta, layout)
  expect(Object.keys(document)).toEqual(['version', 'scene', 'parameters', 'adjustments'])
  expect(readProject(JSON.stringify(document))).toEqual({ scene: site, parameters: DEFAULT_PARAMETERS, adjustments: delta })
  expect(exportOAProject(site, DEFAULT_PARAMETERS, delta, layout)).toBeUndefined()
})
it('exports only the existing OA whitelist and reproduces the legacy kernel output', () => {
  const site = { blocks: [], guides: [], sections: [{ id: 'S1', surfaceId: GROUND, layers: 2, followGlobal: false, start: { x: -2, z: 3 }, end: { x: 2, z: 3 } }] }
  const layout = calculateSite(site, DEFAULT_PARAMETERS), project = exportOAProject(site, DEFAULT_PARAMETERS, {}, layout)!
  expect(Object.keys(project)).toEqual(['version', 'points', 'segments', 'lengths', 'parameters', 'adjustments', 'layout'])
  expect(project.version).toBe('0.6')
  expect(project.parameters.layerCount).toBe(2)
  expect(project.layout).toEqual(calculateScaffoldPlan({ points: project.points, segments: project.segments }, project.parameters))
  const restored = readProject(JSON.stringify(project))!
  expect(restored.scene.sections[0]).toMatchObject({ surfaceId: GROUND, layers: 2, start: { x: -2, z: 3 }, end: { x: 2, z: 3 } })
})
it('uses the same 0.7 boundary for projects and defaults; history retains height dependencies and independent layer choices', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'corridor')!
  const site = { ...demo.site, sections: demo.site.sections.map(section => ({ ...section, followGlobal: false, layers: 3 })) }
  const delta = { cross: 30 }, snapshot = projectSnapshot(site, demo.parameters, delta)
  const restored = readProject(JSON.stringify(snapshot))!
  expect(restored).toEqual({ scene: site, parameters: demo.parameters, adjustments: delta })
  const history = parseHistory(serialiseHistory(addHistoryRecord([], { ...legacySnapshot(site), ...restored }, { now: 1, id: 'H1' })))
  expect(siteFromSnapshot(history[0])).toEqual(site)
  expect(history[0].adjustments).toEqual(delta)
  expect(compatibleDrawing(site, demo.parameters)).toBeUndefined()
  const layout = calculateSite(site, demo.parameters)
  expect(sourcePerimeter(site.sections)).toBe(18)
  expect(layout.perimeter).toBe(18)
  expect(layout.pathDimensions.map(dimension => dimension.labelIndex)).toEqual(['1', '2.1', '2.2', '2.3'])
  expect(calculateSite({ ...site, sections: site.sections.map((section, i) => ({ ...section, groupId: `independent-${i}` })) }, demo.parameters).materials).toEqual(layout.materials)
})
