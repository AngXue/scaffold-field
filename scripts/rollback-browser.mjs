import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { verificationFingerprint } from './calculation-parity/verification-fingerprint.mjs'
import { resolve, extname } from 'node:path'
const root=resolve(import.meta.dirname,'..')
const sourceFingerprint=verificationFingerprint()
const expectedEngine=/['"]([a-f0-9]{64})['"]/.exec(await readFile(resolve(root,'src/domain/rules/diagnostics/build.ts'),'utf8'))[1]
const frozen=JSON.parse(await readFile(resolve(root,'artifacts/rule-migration/rollback-build.json'),'utf8'))
const oldRoot=frozen.directory
assert.equal(frozen.baseline,JSON.parse(await readFile(resolve(root,'fixtures/rules/manifest.json'),'utf8')).baseline)
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true,args:['--enable-unsafe-swiftshader']})
const output=process.env.SITE_QA_OUTPUT || resolve(root,'artifacts/rule-migration/rollback-browser');await mkdir(output,{recursive:true})
const download=async(page,button)=>{const p=page.waitForEvent('download');await button.click();return readFile(await(await p).path(),'utf8')}
const bundle = async directory => {
 const walk=async path => (await Promise.all((await readdir(path,{withFileTypes:true})).map(entry=>entry.isDirectory()?walk(resolve(path,entry.name)):[resolve(path,entry.name)]))).flat()
 const files=await walk(directory)
 return createHash('sha256').update(JSON.stringify(await Promise.all(files.sort().map(async path=>[path.slice(directory.length+1),createHash('sha256').update(await readFile(path)).digest('hex')])))).digest('hex')
}
const bundles={current:await bundle(resolve(root,'dist')),frozen:await bundle(resolve(oldRoot,'dist'))}
const report=[]
const evidencePath=resolve(root,'artifacts/rule-migration/rollback.json')
await writeFile(evidencePath,JSON.stringify({status:'running',sourceFingerprint,engineRevision:expectedEngine}))
try{
 for(const id of ['roof','stack','corridor-independent','adjacent-houses','narrow','legacy']){
  let active=resolve(root,'dist')
  const input=JSON.parse(await readFile(resolve(root,`fixtures/rules/${id}.json`),'utf8'))
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.hostname!=='scaffold-rollback.test')return route.abort()
   const path=resolve(active,'.'+(url.pathname==='/'?'/index.html':url.pathname))
   assert(path.startsWith(active+'/'))
   try{await route.fulfill({body:await readFile(path),contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'})[extname(path)]??'application/octet-stream'})}catch{await route.fulfill({status:404,body:''})}
  })
  const page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{if(!d.message().startsWith('已设为默认示例：'))errors.push(d.message());void d.accept()})
  await page.goto('http://scaffold-rollback.test/')
  await page.evaluate(project=>localStorage.setItem('scaffold-project.v07',JSON.stringify(project)),{version:'0.7',scene:input.scene,parameters:input.parameters,adjustments:{}})
  await page.reload();await page.getByRole('button',{name:/材料结果/}).click()
  if(id!=='narrow'){
   const stock=page.locator('.stock-row').filter({has:page.getByText('5m',{exact:true})})
   await stock.getByRole('button',{name:'增加数量'}).click();await stock.getByRole('button',{name:'增加数量'}).click()
   await page.locator('.connector-list > div').filter({has:page.getByText('十字扣',{exact:true})}).getByRole('button',{name:'增加1包'}).click()
  }
  await page.getByRole('button',{name:'保存',exact:true}).click()
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-project.v07')))
  assert.deepEqual(saved.scene,input.scene)
  assert.deepEqual(saved.adjustments,id==='narrow'?{}:{'stock:5m':2,'connector:cross':30})
  const history=await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-history.v07')))
  let initialCSV,initialJSON
  for(const version of ['current','frozen','restored']){
   if(version!=='current'){active=resolve(version==='frozen'?oldRoot:root,'dist');await page.reload();await page.getByRole('button',{name:/材料结果/}).click();await page.getByRole('button',{name:'保存',exact:true}).click()}
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-project.v07'))),saved)
   if(id==='narrow') { await page.getByText('整图材料清单暂不可用',{exact:true}).waitFor(); assert.equal(await page.getByRole('button',{name:/导出 Excel CSV|打印 \/ PDF/}).count(),0) }
   else{
    const csv=await download(page,page.getByRole('button',{name:/导出 Excel CSV/}))
    if(version==='current')initialCSV=csv;else assert.equal(csv,initialCSV,`${id} CSV ${version}`)
    await writeFile(resolve(output,`${id}-${version}.csv`),csv)
   }
   await page.getByLabel('导出项目数据',{exact:true}).click()
   const json=JSON.parse(await download(page,page.getByRole('button',{name:/导出场景 JSON/})))
   for(const key of ['scene','parameters','adjustments'])assert.deepEqual(json[key],saved[key],`${id} ${key} ${version}`)
   await writeFile(resolve(output,`${id}-${version}.json`),JSON.stringify(json,null,2))
   if(version==='current')initialJSON=json
   if(version!=='frozen'){
    const diagnostic=JSON.parse(await download(page,page.getByRole('button',{name:'导出计算诊断'})))
    assert.equal(diagnostic.meta.engineRevision,expectedEngine)
   }
   if(version!=='current' && id!=='narrow')assert.deepEqual(json.layout.materials.stockSummary,initialJSON.layout.materials.stockSummary)
   if(id==='narrow')assert.equal(json.layout,undefined)
   await page.getByLabel('导出项目数据',{exact:true}).click()
   await page.getByRole('button',{name:'保存',exact:true}).click()
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-history.v07'))),history)
   await page.screenshot({path:resolve(output,`${id}-${version}.png`)})
  }
  // The user confirmed defaults deliberately omit deltas. Exercise that path
  // separately: setting a default must not strip the ordinary saved project.
  await page.getByLabel('把当前图纸与参数设为默认示例',{exact:true}).click()
  const defaultProject={...saved,adjustments:{}}
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-default-demo.v07'))),defaultProject)
  assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-project.v07'))),saved)
  let defaultCSV
  for(const version of ['current','frozen','restored']){
   active=resolve(version==='frozen'?oldRoot:root,'dist')
   await page.evaluate(()=>localStorage.removeItem('scaffold-project.v07'))
   await page.reload();await page.getByRole('button',{name:/材料结果/}).click()
   if(id==='narrow'){
    await page.getByText('整图材料清单暂不可用',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:/导出 Excel CSV|打印 \/ PDF/}).count(),0)
   }else{
    const csv=await download(page,page.getByRole('button',{name:/导出 Excel CSV/}))
    if(version==='current')defaultCSV=csv;else assert.equal(csv,defaultCSV)
    if(id==='roof')assert.match(csv,/扣件,十字扣,28,个/)
    await writeFile(resolve(output,`${id}-default-${version}.csv`),csv)
   }
   await page.getByLabel('导出项目数据',{exact:true}).click()
   const json=JSON.parse(await download(page,page.getByRole('button',{name:/导出场景 JSON/})))
   for(const key of ['scene','parameters','adjustments'])assert.deepEqual(json[key],defaultProject[key])
   await writeFile(resolve(output,`${id}-default-${version}.json`),JSON.stringify(json,null,2))
   await page.getByLabel('导出项目数据',{exact:true}).click()
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-history.v07'))),history)
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('scaffold-default-demo.v07'))),defaultProject)
   await page.screenshot({path:resolve(output,`${id}-default-${version}.png`)})
  }
  assert.deepEqual(errors,[]);report.push({id,versions:['current','frozen','restored'],defaultVersions:['current','frozen','restored'],passed:true});console.log(JSON.stringify(report.at(-1)));await context.close()
 }
}catch(error){
 await browser.contexts().at(-1)?.pages().at(-1)?.screenshot({path:resolve(output,'failure.png')}).catch(()=>{})
 await writeFile(evidencePath,JSON.stringify({status:'failed',sourceFingerprint,engineRevision:expectedEngine,error:error.message,checks:report},null,2))
 throw error
}finally{await browser.close()}
assert.equal(verificationFingerprint(),sourceFingerprint,'Sources changed during rollback rehearsal')
assert.deepEqual({current:await bundle(resolve(root,'dist')),frozen:await bundle(resolve(oldRoot,'dist'))},bundles,'Build changed during rollback rehearsal')
const evidence={status:'passed',baseline:frozen.baseline,engineRevision:expectedEngine,sourceFingerprint,bundles,build:frozen,checks:report}
await writeFile(resolve(output,'report.json'),JSON.stringify(evidence,null,2))
await writeFile(resolve(root,'artifacts/rule-migration/rollback.json'),JSON.stringify(evidence,null,2))
console.log(JSON.stringify(evidence,null,2))
