import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const fixture = JSON.parse(await readFile(new URL('../docs/fixtures/user-adjacent-houses.json', import.meta.url), 'utf8'))
const output = process.env.SITE_QA_OUTPUT || '/tmp/scaffold-adjacent-qa'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] })
const errors=[]
const ctx=await browser.newContext({viewport:{width:1440,height:1000}})
const project={...fixture,scene:{...fixture.scene,blocks:[fixture.scene.blocks[0]],sections:[]}}
await ctx.addInitScript(p=>localStorage.setItem('scaffold-project.v07',JSON.stringify(p)),project)
const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message))
const point=async(x,z)=>{
 const el=page.locator('svg.site-plan'),box=await el.boundingBox(),transform=await el.locator(':scope > g[transform]').getAttribute('transform')
 const [,tx,tz,k]=/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(transform)
 const p={x:box.x+Number(tx)+x*Number(k),y:box.y+Number(tz)+z*Number(k)}
 assert(p.x>box.x&&p.x<box.x+box.width&&p.y>box.y&&p.y<box.y+box.height,'point fits canvas');return p
}
const setNumber=async(label,n)=>{const input=page.getByLabel(label,{exact:true});await input.fill(String(n));await input.press('Enter')}
const snapshot=async()=>{await page.getByRole('button',{name:'保存',exact:true}).click();return page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-project.v07')))}
try {
 await page.goto(process.env.SITE_URL||'http://127.0.0.1:5182')
 await page.getByRole('button',{name:'房屋笔',exact:true}).click()
 await page.getByLabel('选择对象').selectOption('B1')
 assert.equal(await page.locator('[data-dimension-for="B1"]').count(),11)
 await page.getByRole('button',{name:'缩小',exact:true}).click();await page.getByRole('button',{name:'缩小',exact:true}).click()
 await page.getByRole('button',{name:'轮廓',exact:true}).click()
 for(const p of fixture.scene.blocks[1].outline.slice(0,5)){const at=await point(p.x,p.z);await page.mouse.click(at.x,at.y)}
 await page.getByRole('button',{name:'借墙闭合',exact:true}).click()
 let saved=await snapshot();assert.equal(saved.scene.blocks.length,2);assert.equal(saved.scene.blocks[1].outline.length,6)
 await page.getByLabel('选择对象').selectOption('')
 assert((await page.locator('[data-dimension-for="B1"] text').allTextContents()).includes('1.00 m'))
 await page.screenshot({path:output+'/borrowed-outline.png'})
 await page.getByRole('button',{name:'脚手架笔',exact:true}).click()
 await page.getByRole('button',{name:'沿外墙围一圈',exact:true}).click()
 saved=await snapshot();assert.equal(saved.scene.sections.length,14)
 await setNumber('整组目标层数',2)
 saved=await snapshot();assert(saved.scene.sections.every(s=>s.layers===2&&s.followGlobal===false))
 await page.getByRole('button',{name:'单段',exact:true}).click();await setNumber('本面目标层数',3)
 saved=await snapshot();assert.equal(saved.scene.sections.filter(s=>s.layers===3).length,1)
 const target=saved.scene.sections.find(s=>Math.hypot(s.end.x-s.start.x,s.end.z-s.start.z)>5)
 await page.getByLabel('选择对象').selectOption(target.id)
 await page.getByRole('button',{name:'划分选段',exact:true}).click()
 const at=t=>point(target.start.x+(target.end.x-target.start.x)*t,target.start.z+(target.end.z-target.start.z)*t)
 const a=await at(.25),b=await at(.75);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up()
 saved=await snapshot();assert.equal(saved.scene.sections.length,16);assert.equal(saved.scene.sections.filter(s=>!s.groupId).length,1)
 await page.screenshot({path:output+'/split-range.png'})
 // Inspect the supplied scene separately, without touching the user's browser storage.
 const original=await browser.newContext({viewport:{width:1440,height:1000}})
 await original.addInitScript(p=>localStorage.setItem('scaffold-project.v07',JSON.stringify(p)),fixture)
 const demo=await original.newPage();demo.on('pageerror',e=>errors.push(e.message));await demo.goto(process.env.SITE_URL||'http://127.0.0.1:5182')
 await demo.getByLabel('选择对象').selectOption('S14');await demo.getByText('内排中心距墙 0.45 m，外排位于离墙一侧。',{exact:true}).waitFor()
 await demo.getByRole('button',{name:/三维检查/}).click();await demo.locator('[data-testid="scaffold-canvas"] canvas').waitFor();await demo.waitForTimeout(1500)
 await demo.screenshot({path:output+'/original-demo-3d.png'})
 assert.deepEqual(errors,[])
 console.log('Passed: actual contour labels, B2 borrowed closure, outer group, independent lift target, dragged partial range, original Demo 3D and 0.45 m wall clearance')
} finally {await browser.close()}
