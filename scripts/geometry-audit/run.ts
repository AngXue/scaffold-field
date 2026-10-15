import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import process from 'node:process'
import { calculateScaffold, DEFAULT_PARAMETERS, countMembers, type ScaffoldLayout, type Vector3Tuple } from '../../src/domain/scaffold.ts'
import { CONFIGURATIONS, SHAPES, generatedShapes, planInput, type Shape, type XY } from './fixtures.ts'
import { inspect } from './checks.ts'

const output = new URL('../../docs/geometry-audit/', import.meta.url)
const source = await readFile(new URL('../../src/domain/scaffold.ts', import.meta.url), 'utf8')
const sourceHash = createHash('sha256').update(source).digest('hex')
const allShapes = [...SHAPES, ...generatedShapes()]
const layouts = new Map<string, ScaffoldLayout>()
const cases = allShapes.flatMap((shape) => CONFIGURATIONS.map((config) => {
  // Catch accidental diagonal edges in the test generator itself.
  for (let i = 1; i < shape.points.length; i++) {
    const [x, z] = shape.points[i], [px, pz] = shape.points[i - 1]
    if ((x === px) === (z === pz)) throw new Error(`Non-orthogonal or zero-length edge: ${shape.id}:${i}`)
  }
  const input = planInput(shape)
  const parameters = { ...DEFAULT_PARAMETERS, ...config.parameters }
  const layout = calculateScaffold(input.points, input.lengths, parameters)
  if (config.id === 'default') layouts.set(shape.id, layout)
  return {
    shape: shape.id, configuration: config.id, findings: inspect(shape, layout, parameters),
    summary: { ...countMembers(layout), pipes: layout.pipeSegments.length, decks: layout.materials.deckCount,
      deckArea: layout.materials.deckArea, channels: layout.baseChannels.length, connectors: layout.materials.connectorSummary },
    warnings: layout.warnings,
  }
}))

const canonical = (layout: ScaffoldLayout, transform: (p: Vector3Tuple) => Vector3Tuple = (p) => p) => {
  const key = (p: Vector3Tuple) => transform(p).map((n) => (Math.round((n + 1e-8) * 1000) / 1000).toFixed(3)).join(',')
  return JSON.stringify({
    members: layout.members.map((m) => `${m.type}:${m.layer}:${[key(m.start), key(m.end)].sort().join('|')}`).sort(),
    decks: layout.decks.flatMap((d) => (d.coverage ?? [d.corners]).map(face => face.map(key).sort().join('|'))).sort(),
    channels: layout.baseChannels.map((b) => [key(b.start), key(b.end)].sort().join('|')).sort(),
    quantities: [Object.entries(layout.materials.stockSummary).sort(), layout.materials.deckCount, layout.materials.deckArea, layout.materials.connectorSummary],
  })
}
const calculate = (shape: Shape, overrides = {}) => {
  const input = planInput(shape)
  return calculateScaffold(input.points, input.lengths, { ...DEFAULT_PARAMETERS, ...overrides })
}
const transformations: Array<{ shape: string; configuration: string; operation: string; passed: boolean; details?: unknown }> = []
for (const shape of SHAPES) for (const config of CONFIGURATIONS) {
  const layout = calculate(shape, config.parameters)
  const moved = calculate({ ...shape, points: shape.points.map(([x,z]) => [x+20,z-13] as XY) }, config.parameters)
  transformations.push({ shape: shape.id, configuration: config.id, operation: 'translate', passed: canonical(layout) === canonical(moved) })
  const rotated = calculate({ ...shape, points: shape.points.map(([x,z]) => [-z,x] as XY) }, config.parameters)
  transformations.push({ shape: shape.id, configuration: config.id, operation: 'rotate-90', passed: canonical(layout) === canonical(rotated, ([x,y,z]) => [z,y,-x]) })
  const vertices = shape.points.slice(0, -1)
  if (shape.kind === 'invalid' || shape.points[0].some((v,i) => v !== shape.points.at(-1)![i])) continue
  for (let index=1; index<vertices.length; index++) {
    const points = [...vertices.slice(index), ...vertices.slice(0,index)]
    points.push(points[0])
    const changed = calculate({ ...shape, points }, config.parameters)
    const origin = points[0], first = shape.points[0]
    transformations.push({ shape: shape.id, configuration: config.id, operation: `closed-start-${index+1}`,
      passed: canonical(layout, ([x,y,z]) => [x+first[0],y,z+first[1]]) === canonical(changed, ([x,y,z]) => [x+origin[0],y,z+origin[1]]),
      details: { before: { posts: countMembers(layout).post, decks: layout.materials.deckCount, cross: layout.materials.connectorSummary.cross },
        after: { posts: countMembers(changed).post, decks: changed.materials.deckCount, cross: changed.materials.connectorSummary.cross } },
    })
  }
}
const summary = {
  handDrawnShapes: SHAPES.length, generatedShapes: allShapes.length-SHAPES.length, configurations: CONFIGURATIONS.length,
  cases: cases.length, casesWithFindings: cases.filter((c) => c.findings.length > 0).length,
  findingsByCode: Object.fromEntries([...new Set(cases.flatMap((c) => c.findings.map((f) => f.code)))].sort().map((code) => [code, cases.filter((c) => c.findings.some((f) => f.code === code)).length])),
  transformations: transformations.length, failedTransformations: transformations.filter((t) => !t.passed).length,
}

const xml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const labels: Record<string,string> = {
  'missing-collinear-transverse':'漏横向杆', 'missing-closure-mitre':'漏闭合角柱', 'deck-overlap':'钢笆面积重复',
  'splice-stagger':'接头未错开', 'one-leg-mitre':'短边角柱仅连一段', 'duplicate-pipes':'钢管实体重复',
  'invalid-path-unwarned':'缺少输入告警', 'unbased-posts':'柱底无槽钢',
}
function drawing(shape: Shape, x: number, y: number, width: number, height: number, showModel = false) {
  const layout = layouts.get(shape.id)!
  const base = shape.points[0]
  const modelPoints = showModel ? layout.decks.filter((d)=>d.layer===1).flatMap((d)=>d.corners.map((p)=>[p[0]+base[0],p[2]+base[1]] as XY)) : []
  const postPoints = showModel ? layout.members.filter((m) => m.type === 'post').map((m) => [m.start[0] + base[0], m.start[2] + base[1]] as XY) : []
  const all = [...shape.points,...modelPoints,...postPoints]
  const minX=Math.min(...all.map((p)=>p[0])), maxX=Math.max(...all.map((p)=>p[0]))
  const minZ=Math.min(...all.map((p)=>p[1])), maxZ=Math.max(...all.map((p)=>p[1]))
  const scale=Math.min((width-48)/Math.max(1,maxX-minX),(height-48)/Math.max(1,maxZ-minZ))
  const px=(v:number)=>x+width/2+(v-(minX+maxX)/2)*scale
  const py=(v:number)=>y+height/2+(v-(minZ+maxZ)/2)*scale
  let result=''
  if(showModel) for(const deck of layout.decks.filter((d)=>d.layer===1)) for(const face of deck.coverage ?? [deck.corners]) {
    result+=`<polygon points="${face.map((p)=>`${px(p[0]+base[0])},${py(p[2]+base[1])}`).join(' ')}" fill="#5b646b" fill-opacity="0.2" stroke="#9aa1a6" stroke-width="0.5"/>`
  }
  if(showModel) for(const member of layout.members.filter((m)=>m.type==='transverse'&&m.layer===1)) {
    result+=`<line x1="${px(member.start[0]+base[0])}" y1="${py(member.start[2]+base[1])}" x2="${px(member.end[0]+base[0])}" y2="${py(member.end[2]+base[1])}" stroke="#555" stroke-width="1.5"/>`
  }
  result+=`<polyline points="${shape.points.map(([a,b])=>`${px(a)},${py(b)}`).join(' ')}" fill="none" stroke="#16191b" stroke-width="2.5" stroke-linejoin="round"/>`
  if(showModel) for(const post of layout.members.filter((m)=>m.type==='post')) result+=`<circle cx="${px(post.start[0]+base[0])}" cy="${py(post.start[2]+base[1])}" r="3.3" fill="#16191b" stroke="white" stroke-width="0.8"/>`
  for(let i=0;i<shape.points.length-1;i++) {
    const [a,b]=shape.points[i], [c,d]=shape.points[i+1]
    if(!showModel) result+=`<text x="${px((a+c)/2)+(a===c?8:0)}" y="${py((b+d)/2)+(b===d?-8:4)}" text-anchor="${a===c?'start':'middle'}" font-size="10" paint-order="stroke" stroke="white" stroke-width="3">${+Math.hypot(c-a,d-b).toFixed(2)}</text>`
  }
  const [sx,sz]=shape.points[0]
  result+=`<circle cx="${px(sx)}" cy="${py(sz)}" r="4.5" fill="white" stroke="#16191b" stroke-width="2"/><text x="${px(sx)-8}" y="${py(sz)-9}" font-size="10" text-anchor="end">起点</text>`
  if(showModel) {
    const highlight: Record<string, XY> = {
      'line-split': [3.6, 0.45], 'rectangle-in': [0.9, 0.9], 'rectangle-out': [-0.9, -0.9],
      'l-inside': [6.75, 0.45], 'short-start': [-0.4, 0.9], 'width-u': [2.4, 0.45],
    }
    const point=highlight[shape.id]
    if(point) result+=`<circle cx="${px(point[0])}" cy="${py(point[1])}" r="16" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="4 3"/>`
  }
  return result
}
const columns=4, cardW=330, cardH=245
const cards = SHAPES.map((shape,index)=> {
  const x=24+(index%columns)*cardW, y=104+Math.floor(index/columns)*cardH
  const record=cases.find((c)=>c.shape===shape.id&&c.configuration==='default')!
  const codes=record.findings.map((f)=>labels[f.code]??f.code)
  const lines = [codes.slice(0, 2).join(' / ') || (record.warnings.length ? '检查通过 · 有路径/布置提示' : '检查通过'), codes.slice(2).join(' / ')]
  return `<g><rect x="${x}" y="${y}" width="314" height="229" rx="8" fill="white" stroke="#ccd2d4"/><text x="${x+14}" y="${y+24}" font-size="14" font-weight="700">${String(index+1).padStart(2,'0')} ${xml(shape.name)}</text><text x="${x+14}" y="${y+43}" font-size="10" fill="#5c6467">${shape.id} · 单位 m</text>${drawing(shape,x+5,y+45,304,145)}${lines.map((line, row) => `<text x="${x+14}" y="${y+201+row*15}" font-size="10" fill="#444">${xml(line)}</text>`).join('')}</g>`
}).join('')
const atlas=`<svg xmlns="http://www.w3.org/2000/svg" width="1368" height="${130+Math.ceil(SHAPES.length/columns)*cardH}" viewBox="0 0 1368 ${130+Math.ceil(SHAPES.length/columns)*cardH}"><rect width="100%" height="100%" fill="#f1f3f4"/><g font-family="Arial, Noto Sans SC, Microsoft YaHei, sans-serif" fill="#16191b"><text x="24" y="42" font-size="25" font-weight="700">正交路径算法测试图册</text><text x="24" y="71" font-size="14">${SHAPES.length} 张案例图 · 全部水平 / 垂直线段 · 标签为默认参数下的检查结果</text>${cards}</g></svg>`
const detailIds=['line-split','rectangle-in','rectangle-out','l-inside','short-start','width-u']
const detailCaptions = ['中点横向杆恢复，连续直杆共用', '首尾偏移排角柱闭合', '首尾延伸和角块补齐', '覆盖区只计一次：9.99 m² / 层', '保留短边站位并提示，无异常角柱', '共用直杆合并，钢笆覆盖不重复']
const details=detailIds.map((id,index)=>{
 const shape=SHAPES.find((s)=>s.id===id)!, x=24+(index%3)*420,y=108+Math.floor(index/3)*330
 return `<g><rect x="${x}" y="${y}" width="404" height="314" fill="white" stroke="#ccd2d4"/><text x="${x+16}" y="${y+27}" font-size="17" font-weight="700">${xml(shape.name)}</text><text x="${x+16}" y="${y+49}" font-size="12" fill="#5c6467">${detailCaptions[index]}</text>${drawing(shape,x+12,y+56,380,238,true)}</g>`
}).join('')
const detailSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="1308" height="792"><rect width="100%" height="100%" fill="#f1f3f4"/><g font-family="Arial, Noto Sans SC, Microsoft YaHei, sans-serif" fill="#16191b"><text x="24" y="42" font-size="25" font-weight="700">修复后俯视图 · 六个回归案例</text><text x="24" y="73" font-size="14">黑线：路径 · 细线：横向杆 · 黑点：立杆 · 灰面：首层钢笆 · 虚线圈：复核区域</text>${details}</g></svg>`
await mkdir(output, { recursive:true })
await writeFile(new URL('results.json',output), JSON.stringify({ date:'2026-10-15',sourceHash,seed:'0x20261015',summary,configurations:CONFIGURATIONS,shapes:allShapes,cases,transformations },null,2)+'\n')
await writeFile(new URL('atlas.svg',output),atlas)
await writeFile(new URL('details.svg',output),detailSvg)
await writeFile(new URL('projects.json',output),JSON.stringify(SHAPES.map((shape)=>({id:shape.id,label:shape.name,...planInput(shape),parameters:DEFAULT_PARAMETERS,adjustments:{}})),null,2)+'\n')
console.log(JSON.stringify(summary,null,2))
console.log('Reports: docs/geometry-audit/{results.json,atlas.svg,details.svg,projects.json}')
// This is an adversarial audit, not a green snapshot test: known defects stay red.
process.exitCode = summary.casesWithFindings || summary.failedTransformations ? 1 : 0
