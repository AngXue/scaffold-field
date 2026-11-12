/// <reference types="node" />
import { explainSite } from './explain'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { sha256, fingerprint } from './fingerprint'
import { calculateSite, EMPTY_SITE } from '../../site'
import { DEFAULT_PARAMETERS } from '../../scaffold'
import { SITE_DEMOS } from '../../siteDemos'
import { CALCULATION_META, CALCULATION_TRACE, calculationSession, RULESET_MANIFEST } from './session'
import { ENGINE_REVISION } from './build'
it.each(['', 'abc', 'a'.repeat(1000), '架算：房屋和脚手架 🏠'])('portable fingerprints match an independent SHA-256 implementation', text => {
  expect(sha256(text)).toBe(createHash('sha256').update(text).digest('hex'))
})
it('fingerprints ignore object property order but retain array order and absent-vs-undefined fields', () => {
  expect(fingerprint({ a: 1, b: 2 })).toBe(fingerprint({ b: 2, a: 1 }))
  expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 1, b: undefined }))
  expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]))
})
it('records a fixed input and implementation version without changing the existing project JSON', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!
  const normal = calculateSite(demo.site, demo.parameters), traced = calculateSite(demo.site, demo.parameters, { trace: true })
  expect(normal[CALCULATION_TRACE]).toBeUndefined()
  expect(traced[CALCULATION_TRACE]!.length).toBeGreaterThan(20)
  expect(traced[CALCULATION_TRACE]!.every(event => event.ruleRevision > 0 && event.invocation > 0)).toBe(true)
  expect(traced[CALCULATION_TRACE]!.some(event => event.step === 'O01.quantities')).toBe(true)
  expect(JSON.stringify(traced)).toBe(JSON.stringify(normal))
  expect(traced[CALCULATION_META]).toEqual(normal[CALCULATION_META])
  expect(normal[CALCULATION_META].engineRevision).toBe(ENGINE_REVISION)
  expect(RULESET_MANIFEST.rules).toHaveLength(45)
  expect(Object.isFrozen(normal[CALCULATION_META])).toBe(true)
})
it('height, width, inventory and layer changes invalidate the complete input fingerprint', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!
  const base = calculateSite(demo.site, demo.parameters)[CALCULATION_META].inputFingerprint
  for (const parameters of [{ ...demo.parameters, width: 0.8 }, { ...demo.parameters, layerCount: 6 },
    { ...demo.parameters, stockLengths: [6, 4, 3, 2, 1.2] }]) {
    expect(calculateSite(demo.site, parameters)[CALCULATION_META].inputFingerprint).not.toBe(base)
  }
  const changed = { ...demo.site, blocks: demo.site.blocks.map(block => ({ ...block, height: block.height + 0.5 })) }
  expect(calculateSite(changed, demo.parameters)[CALCULATION_META].inputFingerprint).not.toBe(base)
})
it('a failed or nested calculation cannot leak tracing into the next request', () => {
  expect(() => calculationSession(EMPTY_SITE, DEFAULT_PARAMETERS, () => { throw new Error('failed') }, true)).toThrow('failed')
  expect(calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS)[CALCULATION_TRACE]).toBeUndefined()
  const outer = calculationSession(EMPTY_SITE, DEFAULT_PARAMETERS, () => {
    calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS, { trace: true })
    return calculateSite(EMPTY_SITE, DEFAULT_PARAMETERS)
  }, true)
  expect(outer[CALCULATION_TRACE]).toEqual([])
})

it('explicit local diagnostics contain the entity-to-material chain and remain separate from project formats', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'corridor')!
  const report = explainSite(demo.site, demo.parameters)
  expect('failure' in report).toBe(false)
  if (!('graph' in report)) throw new Error('Expected a successful diagnostic graph')
  expect(report.meta?.inputFingerprint).toHaveLength(64)
  expect(report.graph!.members.length).toBeGreaterThan(0)
  expect(report.graph!.ledger.entries.every(entry => entry.entityId && entry.rule)).toBe(true)
  expect(report.trace.some(event => event.step === 'P05.links')).toBe(true)
  const json = JSON.parse(JSON.stringify(report))
  expect(json.diagnosticVersion).toBe(1)
  expect(json.meta.engineRevision).toBe(ENGINE_REVISION)
})
