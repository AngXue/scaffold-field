import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fixture = JSON.parse(await readFile(new URL('../fixtures/rules/roof.json', import.meta.url), 'utf8'))
const output = process.env.SITE_QA_OUTPUT || '/tmp/scaffold-rule-failure'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await context.addInitScript(project => localStorage.setItem('scaffold-project.v07', JSON.stringify(project)), fixture)
  // Test-only network substitution in this isolated browser. Production code has
  // no fault switch, and the user's browser/storage/server are not modified.
  let injected = false
  await context.route('**/src/domain/rules/diagnostics/editor.ts*', async route => {
    const response = await route.fetch(), source = await response.text()
    assert(source.includes('engine(input, settings)'), 'fault injection reaches the editor boundary')
    injected = true
    await route.fulfill({ response, body: source.replace('engine(input, settings)',
      '(() => { if (globalThis.__ruleFailureTest) throw new Error("QA injected calculation failure"); return engine(input, settings) })()') })
  })
  const page = await context.newPage(), errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('dialog', dialog => { void dialog.accept() })
  await page.goto(process.env.SITE_URL || 'http://127.0.0.1:5182')
  await page.getByRole('button', { name: /材料结果/ }).click()
  await page.getByText('标准钢管', { exact: true }).first().waitFor()
  assert(injected)
  await page.evaluate(() => { globalThis.__ruleFailureTest = true })
  await page.getByTitle('增大全局目标层数', { exact: true }).click()
  await page.getByRole('heading', { name: '整图材料清单暂不可用' }).waitFor()
  assert.equal(await page.getByText('标准钢管', { exact: true }).count(), 0, 'old BOM is removed')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scaffold-project.v07')))
  assert.deepEqual(saved.scene, fixture.scene)
  assert.equal(saved.parameters.layerCount, fixture.parameters.layerCount + 1)
  await page.getByLabel('导出项目数据', { exact: true }).click()
  assert(await page.getByRole('button', { name: '导出 OA 兼容 JSON 0.6' }).isDisabled())
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出场景 JSON 0.7' }).click()
  const download = await pending, document = JSON.parse(await readFile(await download.path(), 'utf8'))
  assert.equal(document.version, '0.7'); assert(!Object.hasOwn(document, 'layout'))
  assert.deepEqual(document.scene, fixture.scene)
  await page.screenshot({ path: output + '/blocked-materials.png' })
  await page.getByRole('button', { name: /三维绘图/ }).click()
  await page.locator('svg.site-plan').waitFor()
  assert.equal(await page.locator('[data-site-object="B1"]').count(), 1, 'house draft remains editable')
  await page.evaluate(() => { globalThis.__ruleFailureTest = false })
  await page.getByTitle('减小全局目标层数', { exact: true }).click()
  await page.getByRole('button', { name: /材料结果/ }).click()
  await page.getByText('标准钢管', { exact: true }).first().waitFor()
  assert.equal(await page.getByRole('heading', { name: '整图材料清单暂不可用' }).count(), 0)
  if (await page.getByRole('button', { name: '导出计算诊断' }).isHidden()) await page.getByLabel('导出项目数据', { exact: true }).click()
  const diagnosticDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出计算诊断' }).click()
  const diagnosticFile = await diagnosticDownload
  const diagnostic = JSON.parse(await readFile(await diagnosticFile.path(), 'utf8'))
  assert.equal(diagnostic.meta.engineRevision.length, 64)
  assert.equal(diagnostic.ruleset.rules.length, 45)
  assert(diagnostic.trace.length > 20 && diagnostic.graph.ledger.entries.length > 0)
  assert.deepEqual(errors, [])
  console.log('Passed: failed calculation removes old BOM, preserves editable/saveable draft, blocks OA, exports input-only 0.7 recovers after correction and exports local diagnostics')
} finally { await browser.close() }
