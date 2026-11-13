import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const input = JSON.parse(await readFile(new URL('../fixtures/rules/adjacent-houses.json', import.meta.url), 'utf8'))
const build = await readFile(new URL('../src/domain/rules/diagnostics/build.ts', import.meta.url), 'utf8')
const engineRevision = /['"]([a-f0-9]{64})['"]/.exec(build)[1]
const output = process.env.SITE_QA_OUTPUT || '/tmp/scaffold-rule-diagnostics'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
const report = { engineRevision, checks: [] }
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 1152, height: 680 }, { width: 720, height: 1110 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width !== 1440 })
    await context.addInitScript(project => localStorage.setItem('scaffold-project.v07', JSON.stringify(project)), input)
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => { errors.push(dialog.message()); void dialog.dismiss() })
    await page.goto(process.env.SITE_URL || 'http://127.0.0.1:5183')
    await page.getByRole('button', { name: /材料结果/ }).click()
    await page.getByText('标准钢管', { exact: true }).first().waitFor()
    const saved = await page.evaluate(() => localStorage.getItem('scaffold-project.v07'))
    await page.getByLabel('导出项目数据', { exact: true }).click()
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出计算诊断' }).click()
    const file = await downloading
    const diagnostic = JSON.parse(await readFile(await file.path(), 'utf8'))
    assert.equal(diagnostic.diagnosticVersion, 2)
    assert.equal(diagnostic.meta.engineRevision, engineRevision)
    assert.deepEqual(diagnostic.input.scene, input.scene)
    const graph = diagnostic.graph
    assert.equal(graph.identityVersion, 1)
    assert.equal(graph.pipes.length, 731)
    assert.equal(graph.ledger.entries.filter(entry => entry.category === 'cross').length, 1485)
    assert.equal(graph.ledger.entries.filter(entry => entry.category === 'butt').length, 222)
    assert(graph.retired.some(record => record.rule === 'P06' && record.reason === 'transition-cap'))
    assert(graph.replacements.length > 0)
    assert(graph.members.every(member => member.id.startsWith('member:') && member.legacyId && member.useIds.length))
    const lineage = new Set(graph.lineage.map(record => record.id))
    assert(graph.ledger.entries.every(entry => lineage.has(entry.id) && lineage.has(entry.entityId)))
    assert.equal(await page.evaluate(() => localStorage.getItem('scaffold-project.v07')), saved, 'diagnostic export leaves saved input untouched')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `${output}/diagnostics-${viewport.width}.png` })
    if (viewport.width === 1440) await file.saveAs(`${output}/adjacent-houses-diagnostic-v2.json`)
    report.checks.push({ viewport, pipes: graph.pipes.length, lineage: graph.lineage.length, retired: graph.retired.length, replacements: graph.replacements.length, passed: true })
    await context.close()
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await browser.close() }
