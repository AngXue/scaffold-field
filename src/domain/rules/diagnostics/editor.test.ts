import { expect, it } from 'vitest'
import { SITE_DEMOS } from '../../siteDemos'
import { calculateForEditor, CALCULATION_FAILURE } from './editor'
import { RuleFailure } from '../contracts'
import { exportSceneProject, exportOAProject, readProject } from '../boundaries/projects'
import { calculateSite } from '../../site'
it('keeps the editable draft and rejects all material export on a rule failure, without showing stale entities', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!, before = JSON.stringify(demo.site)
  const valid = calculateForEditor(demo.site, demo.parameters)
  expect(valid.pipeSegments.length).toBeGreaterThan(0)
  const failed = calculateForEditor(demo.site, demo.parameters, () => { throw new RuleFailure('P05.links', 'missing support') })
  expect(failed[CALCULATION_FAILURE]).toMatchObject({ step: 'P05.links', message: 'P05.links: missing support' })
  expect(failed.canExportMaterials).toBe(false)
  expect(failed.pipeSegments).toEqual([])
  expect(failed.blocks.map(block => block.id)).toEqual(demo.site.blocks.map(block => block.id))
  expect(failed.issues).toMatchObject([{ code: 'calculation-failure', blocking: true }])
  const saved = exportSceneProject(demo.site, demo.parameters, { cross: 30 }, failed)
  expect(saved).not.toHaveProperty('layout')
  expect(readProject(JSON.stringify(saved))!.scene).toEqual(demo.site)
  expect(exportOAProject(demo.site, demo.parameters, {}, failed)).toBeUndefined()
  expect(JSON.stringify(demo.site)).toBe(before)
  expect(calculateForEditor(demo.site, demo.parameters)).toEqual(calculateSite(demo.site, demo.parameters))
})
it('unexpected failures also leave the draft usable and cannot masquerade as a zero-material success', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!
  const failed = calculateForEditor(demo.site, demo.parameters, () => { throw new Error('unexpected') })
  expect(failed[CALCULATION_FAILURE]?.message).toBe('unexpected')
  expect(failed.canExportMaterials).toBe(false)
  expect(failed.issues[0].message).toContain('草图仍可编辑和保存')
  expect(failed.materials.connectorSummary.swivel).toBeNull()
})
