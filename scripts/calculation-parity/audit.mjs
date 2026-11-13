import './loader.mjs'
import { rollbackEvidence } from './rollback-evidence.mjs'
import { registeredSteps } from './registry.mjs'
import { checkRuleDocuments } from './rule-documents.mjs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { performanceEvidence } from './performance-evidence.mjs'
import { acceptanceEvidence } from './acceptance-evidence.mjs'
import { verificationFingerprint } from './verification-fingerprint.mjs'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../..')
const { RULES } = await import('../../src/domain/rules/catalog.ts')
const markdown = readFileSync(resolve(root, 'docs/规则清单.md'), 'utf8')
const ids = [...markdown.matchAll(/^\| ([IGMPSCVO]\d{2}) \|/gm)].map(match => match[1]).sort()
assert.deepEqual(RULES.map(rule => rule.id).sort(), ids, 'Code and documented inventories differ')
for (const rule of RULES) {
  assert(rule.source.length && rule.cases.length && rule.title)
  assert(Number.isInteger(rule.revision) && rule.revision > 0)
  if (rule.implementation !== 'legacy-adapter') {
    for (const source of rule.source) assert(existsSync(resolve(root, source)), `${rule.id}: missing implementation ${source}`)
    for (const test of rule.cases.filter(test => test.endsWith('.ts'))) assert(existsSync(resolve(root, test)), `${rule.id}: missing test ${test}`)
  }
}

const executed = new Set(), steps = new Set()
const registered = await registeredSteps()
for (const { step } of registered) {
  steps.add(step.id); executed.add(step.ruleId)
}
checkRuleDocuments(registered)
// Pure numeric/lift policies are deliberately reusable before entity stages.
const { getSectionLevels } = await import('../../src/domain/rules/policies/levels.ts')
const precision = await import('../../src/domain/rules/facts/precision.ts')
assert.equal(typeof getSectionLevels, 'function')
assert.equal(precision.NUMERIC_POLICY.revision, 1)
executed.add('I02'); executed.add('I04')
assert([...executed].every(id => RULES.some(rule => rule.id === id && rule.status === 'active')), 'Unregistered execution owner')
assert.deepEqual([...executed].filter(id => RULES.find(rule => rule.id === id).implementation === 'native').sort(), RULES.filter(rule => rule.implementation === 'native').map(rule => rule.id).sort(), 'Native registration lacks a live rule step or declared pure policy')
const project = await import('../../src/domain/project.ts'), parameters = await import('../../src/domain/rules/boundaries/parameters.ts')
const scaffold = await import('../../src/domain/scaffold.ts'), adjustments = await import('../../src/domain/rules/boundaries/adjustments.ts')
assert.equal(project.restoreParameters, parameters.restoreParameters)
for (const name of ['materialQuantity', 'materialAdjustmentStep', 'stockMaterialRows']) assert.equal(scaffold[name], adjustments[name])
const site = await import('../../src/domain/site.ts'), files = await import('../../src/domain/rules/boundaries/sceneFiles.ts')
const history = await import('../../src/domain/history.ts'), historyBoundary = await import('../../src/domain/rules/boundaries/history.ts')
for (const name of ['readSite', 'siteFromLegacy', 'siteFromSnapshot', 'legacySiteDrawing', 'legacySnapshot', 'drawingFromSections']) assert.equal(site[name], files[name])
for (const name of ['addHistoryRecord', 'parseHistory', 'serialiseHistory', 'sameSnapshot']) assert.equal(history[name], historyBoundary[name])
const { ENGINE_REVISION } = await import('../../src/domain/rules/diagnostics/build.ts')
const baseline = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/manifest.json'), 'utf8')).baseline
const large = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/performance/manifest.json'), 'utf8'))
const fixtures = ['roof', 'corridor', 'adjacent-houses', 'wall-stroke', ...large.cases].map(id => {
  const input = readFileSync(resolve(root, `fixtures/rules/${large.cases.includes(id) ? 'performance/' : ''}${id}.json`), 'utf8')
  return { id, hash: createHash('sha256').update(input).digest('hex'), sections: JSON.parse(input).scene.sections.length }
})
const reportPath = resolve(root, 'artifacts/rule-migration/latency.json')
const performanceAcceptance = performanceEvidence(existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : undefined,
  { engineRevision: ENGINE_REVISION, baseline, fixtures })
const readEvidence = name => {
  const path = resolve(root, `artifacts/rule-migration/${name}.json`)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
}
const acceptanceManifest = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/acceptance-matrix.json'), 'utf8'))
const matrixAcceptance = acceptanceEvidence(acceptanceManifest,
  readEvidence('acceptance-tests'), readEvidence('acceptance-browser'),
  { root, sourceFingerprint: verificationFingerprint(), engineRevision: ENGINE_REVISION, rules: RULES.map(rule => rule.id) })
const globalTitles = [
  'all frozen and large scenes execute globally ordered S0-S9 steps',
  'ordinary and traced sessions reject backwards stages before evaluation (false)',
  'ordinary and traced sessions reject backwards stages before evaluation (true)',
  'a caught rule failure cannot be hidden by returning a successful nested calculation',
]
const globalOrchestrationAcceptance = { accepted: matrixAcceptance.domainAccepted && globalTitles.every(title =>
  acceptanceManifest.rows.find(row => row.id === 'T15')?.assertions.some(assertion => assertion.file === 'src/domain/rules/globalStages.test.ts' && assertion.title === title && assertion.count === 1)),
  scope: 'all 26 frozen/large fixtures plus ordinary/traced fail-before-evaluation and no-publication-after-failure contracts' }
const allAssertions = acceptanceManifest.rows.flatMap(row => row.assertions)
const ordinary = JSON.parse(readFileSync(resolve(root, 'fixtures/rules/manifest.json'), 'utf8')).cases
const registeredAssertion = (file, title) => allAssertions.some(assertion => assertion.file === file && assertion.title === title && assertion.count === 1)
const identityAcceptance = { accepted: matrixAcceptance.domainAccepted
  && registeredAssertion('src/domain/rules/constructionIdentity.test.ts', 'changing display labels cannot change native stock, connections or material contributions')
  && [...ordinary, ...large.cases].every(id => registeredAssertion('src/domain/rules/facts/entityGraph.test.ts', `${id} retains every final material entity including blocked drafts`)),
  scope: 'all 26 scenes: native keys, actual construction/stock/part/station history, reciprocal lineage and unique material contributions' }
const bundleFingerprint = directory => {
  const walk = path => readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)])
  return createHash('sha256').update(JSON.stringify(walk(directory).sort().map(path => [path.slice(directory.length + 1),
    createHash('sha256').update(readFileSync(path)).digest('hex')]))).digest('hex')
}
let rollbackAcceptance
try {
  const build = readEvidence('rollback-build')
  rollbackAcceptance = rollbackEvidence(readEvidence('rollback'), { baseline, engineRevision: ENGINE_REVISION, sourceFingerprint: verificationFingerprint(),
    bundles: { current: bundleFingerprint(resolve(root, 'dist')), frozen: bundleFingerprint(resolve(build.directory, 'dist')) } })
} catch (error) { rollbackAcceptance = { accepted: false, pending: [error.message] } }
const summary = { rules: RULES.length, native: RULES.filter(rule => rule.implementation === 'native').length,
  boundaries: RULES.filter(rule => rule.implementation === 'boundary').length,
  adaptersRemaining: RULES.filter(rule => rule.implementation === 'legacy-adapter').length, liveSteps: steps.size, partialRuleOwners: [...executed].filter(id => RULES.find(rule => rule.id === id).implementation === 'legacy-adapter'),
  scope: 'native S0-S9 production rules, entity lineage and verified compatibility boundary', globalOrchestrationAcceptance, identityAcceptance, performanceAcceptance, matrixAcceptance, rollbackAcceptance,
  pendingAcceptance: [...(!globalOrchestrationAcceptance.accepted ? ['global S0-S9 orchestration without compatibility rebuilds'] : []), ...(!identityAcceptance.accepted ? ['stable entity identities and full derivedFrom/replacedBy lineage'] : []),
    ...(!matrixAcceptance.accepted ? ['complete T01-T15 combination evidence'] : []), ...(!performanceAcceptance.accepted ? ['paired representative-scene latency and memory budgets'] : []), ...(!rollbackAcceptance.accepted ? ['rollback rehearsal for final production build'] : [])] }
console.log(JSON.stringify(summary, null, 2))
if (process.argv.includes('--complete')) {
  assert.equal(summary.adaptersRemaining, 0, 'Complete migration gate: legacy calculation adapters remain')
  assert.equal(summary.pendingAcceptance.length, 0, 'Complete migration gate: native inventory alone does not complete the approved design')
}
