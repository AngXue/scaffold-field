import './loader.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { RULES } = await import('../../src/domain/rules/catalog.ts')
const markdown = readFileSync(new URL('../../docs/规则清单.md', import.meta.url), 'utf8')
const ids = [...markdown.matchAll(/^\| ([IGMPS CVO]\d{2}) \|/gm)].map(match => match[1]).sort()
assert.deepEqual(RULES.map(rule => rule.id).sort(), ids, 'Code and documented inventories differ')
for (const rule of RULES) {
  assert(rule.source.length && rule.cases.length && rule.title)
  assert(Number.isInteger(rule.revision) && rule.revision > 0)
}
console.log(JSON.stringify({ rules: RULES.length, native: RULES.filter(rule => rule.implementation === 'native').length,
  adaptersRemaining: RULES.filter(rule => rule.implementation === 'legacy-adapter').length }, null, 2))
