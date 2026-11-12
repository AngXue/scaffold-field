import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const project = JSON.parse(await readFile(new URL('../docs/fixtures/user-wall-stroke.json', import.meta.url), 'utf8'))
const output = process.env.SITE_QA_OUTPUT || '/tmp/scaffold-wall-qa'
const url = process.env.SITE_URL || 'http://127.0.0.1:5182'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
const errors = [], checks = []
const panel = async (page, open) => {
  const toggle = page.locator('.site-panel-toggle')
  if ((await toggle.getAttribute('aria-expanded') === 'true') !== open) await toggle.click()
}
const point = async (page, x, z) => {
  const canvas = page.locator('svg.site-plan'), box = await canvas.boundingBox()
  const transform = await canvas.locator(':scope > g[transform]').getAttribute('transform')
  const [, tx, tz, k] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(transform)
  const result = { x: box.x + Number(tx) + x * Number(k), y: box.y + Number(tz) + z * Number(k) }
  assert(result.x > box.x && result.x < box.x + box.width && result.y > box.y && result.y < box.y + box.height)
  return result
}
const stored = async page => {
  await page.getByRole('button', { name: '保存', exact: true }).click()
  return page.evaluate(() => JSON.parse(localStorage.getItem('scaffold-project.v07')))
}
const clearance = page => page.getByText('内排中心距墙 0.30 m，外排位于离墙一侧。', { exact: true }).waitFor()
const csv = async page => {
  await page.getByRole('button', { name: /材料结果/ }).click()
  const button = page.getByRole('button', { name: /导出 Excel CSV/ })
  assert(await button.isEnabled())
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  const text = await readFile(await download.path(), 'utf8')
  assert.match(text, /型钢,槽钢,15,根/)
  return text
}
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1152, height: 680 }, { width: 720, height: 1110 }]) {
    const context = await browser.newContext({ viewport, hasTouch: viewport.width !== 1440, deviceScaleFactor: 1 })
    await context.addInitScript(value => localStorage.setItem('scaffold-project.v07', JSON.stringify(value)), project)
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', dialog => { void dialog.accept() })
    await page.goto(url)
    await panel(page, true)
    await page.getByLabel('选择对象').selectOption('S1')
    await clearance(page)
    const restored = await stored(page)
    assert.deepEqual(restored.scene, project.scene, 'opening and saving keeps authored coordinates and flags')
    const originalCsv = await csv(page)
    await page.reload()
    await page.getByRole('button', { name: /三维绘图/ }).click()
    await panel(page, true)
    await page.getByLabel('选择对象').selectOption('S1')
    await clearance(page)
    // Switching to automatic support and back to explicit ground must retain clearance.
    await page.getByLabel('架段落脚面').selectOption('automatic')
    await clearance(page)
    await page.getByLabel('架段落脚面').selectOption('ground')
    await clearance(page)
    await page.getByRole('button', { name: '脚手架笔', exact: true }).click()
    if (viewport.width === 1440) {
      await panel(page, false)
      const a = await point(page, 25.8, 0.7), b = await point(page, 27.8, 0.72)
      await page.mouse.move(a.x, a.y); await page.mouse.down()
      await page.mouse.move(b.x, b.y, { steps: 10 }); await page.mouse.up()
      await panel(page, true)
      await clearance(page)
      const edited = await stored(page)
      assert.equal(edited.scene.sections[0].start.z, 0.7)
      assert.equal(edited.scene.sections[0].end.z, 0.7)
      assert.equal(edited.scene.sections[0].end.x, 27.8)
      await page.getByRole('button', { name: '撤销', exact: true }).click()
      await page.getByLabel('选择对象').selectOption('S1')
    }
    // Draw a fresh wall stroke in reverse, inspecting preview before release.
    await page.getByRole('button', { name: '删除选中对象' }).click()
    await panel(page, false)
    const a = await point(page, 25.8, 0.7), b = await point(page, 1.8, 0.7)
    const touch = viewport.width === 1440 ? undefined : await context.newCDPSession(page)
    if (!touch) {
      await page.mouse.move(a.x, a.y); await page.mouse.down()
      await page.mouse.move(b.x, b.y, { steps: 10 })
    } else {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] })
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x, y: b.y }] })
    }
    const strip = page.locator('svg.site-plan polygon.site-strip').last()
    const zCoordinates = (await strip.getAttribute('points')).split(' ').filter(Boolean).map(pair => Number(pair.split(',')[1]))
    assert.deepEqual(new Set(zCoordinates), new Set([1, 1.9]), 'preview uses the same two offset rows')
    await page.screenshot({ path: `${output}/wall-preview-${viewport.width}.png` })
    if (!touch) await page.mouse.up()
    else {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await panel(page, true)
    await clearance(page)
    const drawn = await stored(page)
    assert.equal(drawn.scene.sections.length, 1)
    assert.equal(drawn.scene.sections[0].automatic, true)
    assert.equal(drawn.scene.sections[0].start.z, 0.7)
    assert.equal(drawn.scene.sections[0].end.z, 0.7)
    assert.equal(await csv(page), originalCsv, 'redrawing reversed wall keeps quantities')
    await page.getByRole('button', { name: /三维检查/ }).click()
    const canvas = page.locator('[data-testid="scaffold-canvas"] canvas')
    await canvas.waitFor(); await page.waitForTimeout(1000)
    assert(await canvas.evaluate(el => el.width > 0 && el.height > 0))
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: `${output}/wall-3d-${viewport.width}.png` })
    checks.push(`${viewport.width}x${viewport.height}: original restore/save/reopen, ground/automatic switch, reverse wall drawing, CSV parity, 3D and overflow`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(`${output}/report.json`, JSON.stringify({ url, checks, errors }, null, 2))
  console.log(checks.join('\n'))
} finally { await browser.close() }
