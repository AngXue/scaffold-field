import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),
  headless: true, args: ['--enable-unsafe-swiftshader'],
})
const base = process.env.SITE_URL || 'http://127.0.0.1:5182/'
const output = resolve(process.env.SITE_QA_OUTPUT || resolve(tmpdir(), 'scaffold-site-qa'))
await mkdir(output, { recursive: true })
const report = { url: base, checks: [] }
const errors = []
const watch = page => {
  page.on('pageerror', e => errors.push(e.message))
  page.on('dialog', d => { void d.accept() })
}
const plan = page => page.getByRole('button', { name: /三维绘图/ })
const model = page => page.getByRole('button', { name: /三维检查/ })
const materials = page => page.getByRole('button', { name: /材料结果/ })
const pick = page => page.getByLabel('选择对象')
const load = async (page, id) => {
  await plan(page).click()
  const accordion = page.locator('details.site-demos')
  if ((await accordion.getAttribute('open')) === null) await accordion.locator('summary').click()
  await page.getByLabel('验收 Demo', { exact: true }).selectOption(id)
  await page.getByRole('button', { name: '载入 Demo' }).click()
}
const inside = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor()
const setNumber = async (page, label, value) => {
  const input = page.getByLabel(label, { exact: true })
  await input.fill(String(value))
  await input.press('Enter')
}
const canvas = page => page.locator('svg.site-plan')
const point = async (page, x, z) => {
  const c = canvas(page), b = await c.boundingBox()
  const transform = await c.locator(':scope > g[transform]').getAttribute('transform')
  const [, tx, tz, scale] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(transform)
  const at = { x: b.x + Number(tx) + x * Number(scale), y: b.y + Number(tz) + z * Number(scale) }
  assert(at.x > b.x && at.x < b.x + b.width && at.y > b.y && at.y < b.y + b.height, 'drawing point is in canvas')
  return at
}
const drag = async (page, x, z, tx, tz) => {
  const a = await point(page, x, z), b = await point(page, tx, tz)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
}
const clickPoint = async (page, x, z) => {
  const at = await point(page, x, z)
  await page.mouse.click(at.x, at.y)
}
const save = page => page.getByRole('button', { name: '保存', exact: true }).click()
const downloadText = async (page, locator) => {
  const [file] = await Promise.all([page.waitForEvent('download'), locator.click()])
  return readFile(await file.path(), 'utf8')
}
const assertNoOverflow = async page => assert(await page.evaluate(() =>
  document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1))

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await desktop.newPage(); watch(page)
  await page.goto(base)
  await canvas(page).waitFor()
  await page.getByRole('button', { name: '房屋笔' }).click()
  await drag(page, -3, -2, 3, 2)
  await inside(page, '体块 B1')
  await setNumber(page, '高度 (m)', 3.5)
  await page.getByRole('button', { name: '在此顶面绘制' }).click()
  await page.getByRole('button', { name: '脚手架笔' }).click()
  await drag(page, -2, -1, -0.2, -1)
  assert.equal(await page.getByLabel('作业层数', { exact: true }).inputValue(), '4')
  await inside(page, '0.26 m')
  await inside(page, '9.40 m')
  await save(page)
  await page.reload()
  await pick(page).selectOption('S1')
  await inside(page, '0.26 m')
  report.checks.push('Desktop: draw a house, edit height, choose its roof, draw a 4-lift run, save and reload')

  await page.getByRole('button', { name: '房屋笔' }).click()
  await page.getByRole('button', { name: '辅助线', exact: true }).click()
  await page.getByLabel('落脚面', { exact: true }).selectOption('B1')
  for (const [x, z, tx, tz] of [[-2, -1.5, 2, -1.5], [2, -1.5, 2, 1.5], [2, 1.5, -2, 1.5], [-2, 1.5, -2, -1.5]]) {
    await drag(page, x, z, tx, tz)
  }
  for (const [x, z] of [[0, -1.5], [2, 0], [0, 1.5], [-2, 0]]) await clickPoint(page, x, z)
  await page.getByRole('button', { name: '把四条边转为体块' }).click()
  await inside(page, '体块 B2')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  assert.equal(await page.locator('[data-site-object^="G"]').count(), 4)
  await page.getByRole('button', { name: '重做', exact: true }).click()
  assert.equal(await page.locator('[data-site-object="B2"]').count(), 1)
  report.checks.push('Four selected guide edges convert to a stacked block; undo and redo keep the source edges')

  await load(page, 'aligned')
  await pick(page).selectOption('S2')
  await inside(page, '3.76 m · 全局第 2 层')
  await page.screenshot({ path: resolve(output, 'desktop-drawing.png') })
  await page.getByRole('button', { name: '浏览', exact: true }).click()
  await page.locator('[data-testid="scaffold-canvas"] canvas').waitFor()
  await model(page).click()
  await page.locator('[data-testid="scaffold-canvas"] canvas').waitFor()
  const houses = page.getByRole('checkbox', { name: '房屋', exact: true })
  await houses.uncheck(); await houses.check()
  await page.screenshot({ path: resolve(output, 'desktop-3d.png') })
  assert(await page.locator('[data-testid="scaffold-canvas"] canvas').evaluate(el => el.width > 0 && el.height > 0))
  await materials(page).click()
  await inside(page, '294')
  const csv = await downloadText(page, page.getByRole('button', { name: /导出 Excel CSV/ }))
  assert.match(csv, /扣件,十字扣,294,个/)
  assert.match(csv, /铺设材料,钢笆片,64,片/)
  assert.match(csv, /铺设材料,钢笆覆盖面积,41\.4,m²/)
  assert.match(csv, /型钢,槽钢,9,根/)
  await page.getByLabel('导出项目数据', { exact: true }).click()
  const scene = JSON.parse(await downloadText(page, page.getByRole('button', { name: /导出场景 JSON/ })))
  assert.equal(scene.version, '0.7')
  assert.equal(scene.scene.blocks.length, 2)
  assert.equal(scene.layout.materials.connectorSummary.cross, 294)
  assert(await page.getByRole('button', { name: /导出 OA 兼容/ }).isDisabled())
  await page.getByLabel('导出项目数据', { exact: true }).click()
  report.checks.push('3D canvas and house visibility; hand-checked aligned materials match CSV and 0.7 JSON')

  await load(page, 'roof')
  await pick(page).selectOption('S1')
  await inside(page, '0.26 m')
  await materials(page).click()
  const roofCsv = await downloadText(page, page.getByRole('button', { name: /导出 Excel CSV/ }))
  for (const row of ['钢管,3m,4,根', '钢管,2m,6,根', '钢管,1.2m,8,根', '扣件,十字扣,28,个', '型钢,槽钢,2,根', '铺设材料,钢笆片,2,片']) {
    assert(roofCsv.includes(row), row)
  }
  await plan(page).click()
  await pick(page).selectOption('S1')
  await setNumber(page, '作业层数', 3)
  await inside(page, '7.52 m')
  await materials(page).click()
  assert.match(await downloadText(page, page.getByRole('button', { name: /导出 Excel CSV/ })), /扣件,对接扣,4,个/)
  report.checks.push('One roof bay matches the independent stock and connector counts; three lifts add exactly four butt couplers')

  await load(page, 'exact')
  await pick(page).selectOption('S1')
  await inside(page, '5.64 m · 全局第 3 层')
  for (const [id, issue] of [['step', /超出或跨越.*定位/], ['sweep', /扫地杆与首层冲突.*定位/],
    ['penetration', /穿入房屋体块.*定位/], ['overlap', /发生实体重叠.*定位/]]) {
    await load(page, id)
    await page.getByRole('button', { name: issue }).first().click()
    assert.equal(await pick(page).inputValue(), 'S1')
    await materials(page).click()
    await inside(page, '整图材料清单暂不可用')
    assert.equal(await page.getByRole('button', { name: /导出 Excel CSV/ }).count(), 0)
  }
  report.checks.push('Exact layer boundary and four additional invalid drawings have the expected levels or blocking reasons')

  await load(page, 'narrow')
  await page.getByRole('button', { name: /超出或跨越.*定位/ }).click()
  await inside(page, '3.76 m · 全局第 2 层')
  await materials(page).click()
  await inside(page, '整图材料清单暂不可用')
  assert.equal(await page.getByRole('button', { name: /导出 Excel CSV|打印 \/ PDF/ }).count(), 0)
  await page.getByLabel('导出项目数据', { exact: true }).click()
  const draft = JSON.parse(await downloadText(page, page.getByRole('button', { name: /导出场景 JSON/ })))
  assert.equal(draft.scene.sections.length, 1)
  assert.equal(draft.layout, undefined)
  await page.getByLabel('导出项目数据', { exact: true }).click()
  await plan(page).click(); await pick(page).selectOption('B1')
  await page.getByRole('button', { name: '删除选中对象' }).click()
  await inside(page, '此体块仍有架段、辅助线或叠放体块，请先换面或移除依赖。')
  await setNumber(page, '宽度 (m)', 2)
  await materials(page).click()
  await inside(page, '28')
  report.checks.push('Invalid footing blocks materials/print/CSV, draft still exports; fixing width restores totals')

  await load(page, 'stack')
  await pick(page).selectOption('B1')
  await setNumber(page, '高度 (m)', 3.5)
  await pick(page).selectOption('S1')
  await inside(page, '11.28 m')
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await pick(page).selectOption('S1')
  await inside(page, '9.40 m')
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await save(page)
  await page.reload()
  await pick(page).selectOption('S1')
  await inside(page, '11.28 m')
  assert.equal(await page.getByLabel('作业层数', { exact: true }).inputValue(), '4')
  await load(page, 'legacy')
  await inside(page, '周长 14.40 m')
  report.checks.push('Parent height recalculates four lifts after undo and save/reload; closed legacy Demo retains its perimeter')

  const legacy = await desktop.newPage(); watch(legacy)
  await legacy.addInitScript(() => {
    localStorage.removeItem('scaffold-project.v07')
    localStorage.setItem('scaffold-project', JSON.stringify({
      version: '0.6', points: [{ id: 'P1', x: 100, y: 125 }, { id: 'P2', x: 190, y: 125 }],
      segments: [{ id: 'S1', start: 'P1', end: 'P2' }], lengths: [1.8], parameters: { layerCount: 3 }, adjustments: {},
    }))
  })
  await legacy.goto(base)
  await pick(legacy).selectOption('S1')
  await inside(legacy, '5.64 m')
  await legacy.getByLabel('导出项目数据', { exact: true }).click()
  const old = JSON.parse(await downloadText(legacy, legacy.getByRole('button', { name: /导出 OA 兼容/ })))
  assert.equal(old.version, '0.6')
  assert.equal(old.parameters.layerCount, 3)
  assert.deepEqual(old.lengths, [1.8])
  report.checks.push('Old 0.6 local project opens on ground and retains its count in OA export')
  await desktop.close()

  for (const viewport of [{ width: 1152, height: 680 }, { width: 720, height: 1110 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 1 })
    const tablet = await context.newPage(); watch(tablet)
    await tablet.goto(base)
    await canvas(tablet).waitFor()
    const cdp = await context.newCDPSession(tablet)
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points })
    const a = await point(tablet, -2, 0), b = await point(tablet, 0, 0)
    await touch('touchStart', [{ ...a, id: 1 }])
    await touch('touchMove', [{ ...b, id: 1 }])
    await touch('touchEnd', [])
    assert.equal(await tablet.locator('[data-site-object="S1"]').count(), 1)
    const p1 = await point(tablet, -2, -1), p2 = await point(tablet, 1, -1)
    await touch('touchStart', [{ ...p1, id: 1 }])
    await touch('touchMove', [{ x: p1.x + 20, y: p1.y, id: 1 }])
    await touch('touchStart', [{ x: p1.x + 20, y: p1.y, id: 1 }, { ...p2, id: 2 }])
    await touch('touchMove', [{ ...p1, id: 1 }, { x: p2.x + 20, y: p2.y, id: 2 }])
    await touch('touchEnd', [])
    assert.equal(await tablet.locator('[data-site-object^="S"]').count(), 1, 'pinch never commits a stroke')
    await load(tablet, 'aligned')
    await pick(tablet).selectOption('S2')
    await inside(tablet, '0.26 m')
    await assertNoOverflow(tablet)
    await tablet.screenshot({ path: resolve(output, `tablet-${viewport.width}-drawing.png`) })
    await model(tablet).click()
    await tablet.locator('[data-testid="scaffold-canvas"] canvas').waitFor()
    await assertNoOverflow(tablet)
    await materials(tablet).click()
    await inside(tablet, '294')
    await assertNoOverflow(tablet)
    report.checks.push(`Tablet ${viewport.width}×${viewport.height}: touch drawing, pinch cancellation, 3D and BOM fit`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  report.status = 'passed'
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ ...report, output }, null, 2))
} catch (error) {
  const context = browser.contexts().at(-1)
  await context?.pages().at(-1)?.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser.close()
}
