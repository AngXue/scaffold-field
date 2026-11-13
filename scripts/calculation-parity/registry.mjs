import './loader.mjs'
import assert from 'node:assert/strict'
import { RULES } from '../../src/domain/rules/catalog.ts'

// The audit and generated maintenance documents load the same production packages.
export const RULE_PACKAGES = [
  ['scene', 'SCENE_STEPS'], ['routing', 'ROUTING_STEPS'], ['groups', 'GROUP_STEPS'],
  ['topology', 'TOPOLOGY_STEPS'], ['heights', 'HEIGHT_STEPS'], ['frameRows', 'FRAME_ROW_STEPS'], ['bands', 'BAND_STEPS'], ['decks', 'DECK_STEPS'], ['components', 'COMPONENT_STEPS'], ['posts', 'POST_STEPS'], ['bases', 'BASE_STEPS'], ['transitions', 'TRANSITION_STEPS'], ['guardRemovals', 'GUARD_REMOVAL_STEPS'], ['placement', 'PLACEMENT_STEPS'], ['pathValidation', 'PATH_VALIDATION_STEPS'], ['sectionValidation', 'SECTION_VALIDATION_STEPS'], ['siteValidation', 'SITE_VALIDATION_STEPS'], ['sharedMembers', 'MERGE_STEPS'], ['sharedMembers', 'CANDIDATE_STEPS'], ['stock', 'STOCK_STEPS'], ['stock', 'COMMITTED_STOCK_STEPS'], ['connections', 'CONTACT_STEPS'], ['connections', 'CONNECTION_STEPS'], ['materials', 'MATERIAL_STEPS'],
]

export async function registeredSteps() {
  const entries = []
  for (const [name, exported] of RULE_PACKAGES) {
    const module = await import(`../../src/domain/rules/${name}.ts`)
    for (const step of module[exported]) entries.push({ step, source: `src/domain/rules/${name}.ts`, exported })
  }
  const ids = new Map(entries.map(entry => [entry.step.id, entry.step]))
  assert.equal(ids.size, entries.length, 'Duplicate execution step across packages')
  for (const { step } of entries) {
    assert(RULES.some(rule => rule.id === step.ruleId), `Unregistered step owner: ${step.id}`)
    for (const dependency of step.after) {
      const previous = ids.get(dependency)
      assert(previous, `Missing execution dependency: ${step.id} -> ${dependency}`)
      assert(previous.phase <= step.phase, `Backwards execution dependency: ${step.id}`)
    }
  }
  return entries.sort((a, b) => a.step.phase - b.step.phase || a.step.id.localeCompare(b.step.id))
}
