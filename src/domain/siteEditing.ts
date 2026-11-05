import { footprintCells, footprintContainsPoint, footprintFromOutline, footprintOutline, footprintsOverlap } from './siteFootprints'
import { GROUND, type Footprint, type Site, type SitePoint, type SiteSection } from './site'
const same = (a: SitePoint, b: SitePoint) => Math.hypot(a.x-b.x,a.z-b.z)<0.001
const onEdge = (p: SitePoint,a: SitePoint,b: SitePoint) => Math.abs((b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x))<0.00001 && p.x>=Math.min(a.x,b.x)-0.001 && p.x<=Math.max(a.x,b.x)+0.001 && p.z>=Math.min(a.z,b.z)-0.001 && p.z<=Math.max(a.z,b.z)+0.001

/** Close a new addition along an existing wall, retaining only non-overlapping candidates. */
export function closeAlongHouse(points: SitePoint[], houses: Footprint[]): Footprint | undefined {
  if(points.length<3) return
  const candidates: Footprint[]=[]
  for(const house of houses) for(const boundary of [footprintOutline(house), [...footprintOutline(house)].reverse()]) {
    const first=points[0], last=points.at(-1)!
    const start=boundary.findIndex((a,i)=>onEdge(last,a,boundary[(i+1)%boundary.length]))
    if(start<0) continue
    const closing: SitePoint[]=[]
    for(let k=0;k<boundary.length;k++) {
      const a=k===0?last:boundary[(start+k)%boundary.length], b=boundary[(start+k+1)%boundary.length]
      if(onEdge(first,a,b)) {
        const shape=footprintFromOutline([...points,...closing])
        if(shape && !houses.some(other=>footprintsOverlap(shape,other))) candidates.push(shape)
        break
      }
      if(!same(b,last)) closing.push(b)
    }
  }
  return candidates.sort((a,b)=>footprintCells(a).reduce((s,c)=>s+c.width*c.depth,0)-footprintCells(b).reduce((s,c)=>s+c.width*c.depth,0))[0]
}

/** Boundary of the union: party walls are absent and collinear grid edges coalesce. */
export function outerHouseLoops(houses: Footprint[]): SitePoint[][] {
  const points=houses.flatMap(footprintOutline)
  const xs=[...new Set(points.map(p=>p.x))].sort((a,b)=>a-b), zs=[...new Set(points.map(p=>p.z))].sort((a,b)=>a-b)
  const filled=new Set<string>()
  for(let x=0;x<xs.length-1;x++) for(let z=0;z<zs.length-1;z++) if(houses.some(h=>footprintContainsPoint(h,{x:(xs[x]+xs[x+1])/2,z:(zs[z]+zs[z+1])/2},0))) filled.add(`${x},${z}`)
  const edges:{a:SitePoint;b:SitePoint}[]=[]
  for(let x=0;x<xs.length-1;x++) for(let z=0;z<zs.length-1;z++) if(filled.has(`${x},${z}`)) {
    const corners=[{x:xs[x],z:zs[z]},{x:xs[x+1],z:zs[z]},{x:xs[x+1],z:zs[z+1]},{x:xs[x],z:zs[z+1]}]
    const neighbours=[`${x},${z-1}`,`${x+1},${z}`,`${x},${z+1}`,`${x-1},${z}`]
    neighbours.forEach((key,i)=>{if(!filled.has(key)) edges.push({a:corners[i],b:corners[(i+1)%4]})})
  }
  const loops: SitePoint[][]=[]
  while(edges.length) {
    const first=edges.shift()!, loop=[first.a];let at=first.b
    while(!same(at,first.a)) {
      loop.push(at)
      const i=edges.findIndex(e=>same(e.a,at))
      if(i<0) break
      at=edges.splice(i,1)[0].b
    }
    if(!same(at,first.a)) continue
    let changed=true
    while(changed && loop.length>4) {
      changed=false
      for(let i=0;i<loop.length;i++) {
        const a=loop[(i+loop.length-1)%loop.length],b=loop[i],c=loop[(i+1)%loop.length]
        if(a.x===b.x && b.x===c.x || a.z===b.z && b.z===c.z) {loop.splice(i,1);changed=true;break}
      }
    }
    if(footprintFromOutline(loop)) loops.push(loop)
  }
  return loops
}
export function scaffoldAroundHouses(site: Site, layers: number): Site {
  const loops=outerHouseLoops(site.blocks)
  const sections=[...site.sections], taken=new Set(sections.map(s=>s.id));let n=1
  const groups=new Set(sections.map(s=>s.groupId));let group=1
  while(groups.has(`围架${group}`)) group++
  const onOuter = (line: SiteSection) => loops.some(loop=>loop.some((a,i)=>{
    const b=loop[(i+1)%loop.length],axis=a.x===b.x?'z':'x',cross=axis==='x'?'z':'x'
    return line.automatic && line.start[cross]===a[cross] && line.end[cross]===a[cross]
      && Math.min(Math.max(line.start[axis],line.end[axis]),Math.max(a[axis],b[axis]))>Math.max(Math.min(line.start[axis],line.end[axis]),Math.min(a[axis],b[axis]))
  }))
  const existing=sections.filter(onOuter), existingGroup=existing[0]?.groupId
  const groupId=existingGroup && existing.every(s=>s.groupId===existingGroup) ? existingGroup : `围架${group}`

  for(const loop of loops) for(let i=0;i<loop.length;i++) {
    const start=loop[i],end=loop[(i+1)%loop.length]
    const axis = start.x === end.x ? 'z' : 'x', cross = axis === 'x' ? 'z' : 'x'
    let ranges = [[Math.min(start[axis],end[axis]),Math.max(start[axis],end[axis])]]
    for (const line of sections) {
      if (line.start[cross] !== start[cross] || line.end[cross] !== start[cross]) continue
      const a=Math.min(line.start[axis],line.end[axis]),b=Math.max(line.start[axis],line.end[axis])
      ranges=ranges.flatMap(([l,r])=>b<=l||a>=r?[[l,r]]:[[l,Math.min(r,a)],[Math.max(l,b),r]].filter(([lo,hi])=>hi-lo>=0.099))
    }
    for (const [a,b] of ranges) {
      while(taken.has(`S${n}`)) n++
      const id=`S${n++}`;taken.add(id)
      const forward=end[axis]>start[axis]
      sections.push({id,start:{...start,[axis]:forward?a:b},end:{...end,[axis]:forward?b:a},surfaceId:GROUND,layers,automatic:true,followGlobal:true,groupId})
    }
  }
  return {...site,sections:sections.map(s=>onOuter(s)?{...s,groupId}:s)}
}
export function splitSectionRange(site: Site, section: SiteSection, from: SitePoint, to: SitePoint): {site: Site; selected?:string} {
  const length=Math.hypot(section.end.x-section.start.x,section.end.z-section.start.z)
  const t=(p:SitePoint)=>Math.max(0,Math.min(length,((p.x-section.start.x)*(section.end.x-section.start.x)+(p.z-section.start.z)*(section.end.z-section.start.z))/length))
  const a=Math.min(t(from),t(to)),b=Math.max(t(from),t(to))
  if(b-a<0.1-0.001) return {site}
  if(a>0.001&&a<0.1 || length-b>0.001&&length-b<0.1) return {site}
  const at=(n:number)=>({x:Math.round((section.start.x+(section.end.x-section.start.x)*n/length)*1000)/1000,z:Math.round((section.start.z+(section.end.z-section.start.z)*n/length)*1000)/1000})
  const parts:SiteSection[]=[];let selected:string|undefined
  for(const [start,end,independent] of [[0,a,false],[a,b,true],[b,length,false]] as const) {
    if(end-start<0.001) continue
    let id=section.id
    if(parts.length) {let n=1;while(site.sections.some(s=>s.id===`S${n}`)||parts.some(s=>s.id===`S${n}`)) n++;id=`S${n}`}
    parts.push({...section,id,start:at(start),end:at(end),...(independent?{groupId:undefined}:{})})
    if(independent) selected=id
  }
  return {site:{...site,sections:site.sections.flatMap(s=>s.id===section.id?parts:[s])},selected}
}
