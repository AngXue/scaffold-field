import type { ScaffoldLayout, ScaffoldParameters, Vector3Tuple } from '../../src/domain/scaffold.ts'
import type { Shape } from './fixtures.ts'

export type Finding = { code: string; count: number; examples: unknown[] }
const close = (a: number, b: number) => Math.abs(a - b) < 0.005
const pointKey = (p: number[]) => p.map((n) => n.toFixed(3)).join(',')
const lineKey = (a: number[], b: number[]) => [pointKey(a), pointKey(b)].sort().join('|')

function pointOnLine(p: Vector3Tuple, a: Vector3Tuple, b: Vector3Tuple) {
  const dx = b[0] - a[0], dz = b[2] - a[2]
  const length = Math.hypot(dx, dz)
  if (length < 0.001) return false
  const along = ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / length
  return along > -0.005 && along < length + 0.005
    && Math.abs((p[0] - a[0]) * dz - (p[2] - a[2]) * dx) / length < 0.005
}

/** Exact union area for the axis-aligned rectangles in these orthogonal layouts. */
export function rectangleUnionArea(rects: Array<[number, number, number, number]>) {
  const xs = [...new Set(rects.flatMap(([x0, , x1]) => [x0, x1]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 1; i < xs.length; i++) {
    const mid = (xs[i - 1] + xs[i]) / 2
    const intervals = rects.filter(([x0, , x1]) => x0 < mid && mid < x1).map(([, z0, , z1]) => [z0, z1]).sort((a, b) => a[0] - b[0])
    let end = -Infinity, total = 0
    for (const [z0, z1] of intervals) {
      total += Math.max(0, z1 - Math.max(end, z0))
      end = Math.max(end, z1)
    }
    area += (xs[i] - xs[i - 1]) * total
  }
  return area
}

export function inspect(shape: Shape, layout: ScaffoldLayout, parameters: ScaffoldParameters): Finding[] {
  const findings: Finding[] = []
  const add = (code: string, examples: unknown[], count = examples.length) => {
    if (!count) return
    const existing = findings.find((finding) => finding.code === code)
    if (existing) {
      existing.count += count
      existing.examples = [...existing.examples, ...examples].slice(0, 4)
    } else findings.push({ code, count, examples: examples.slice(0, 4) })
  }
  const duplicates = <T,>(items: T[], key: (item: T) => string) => {
    const seen = new Set<string>()
    return items.filter((item) => { const k = key(item); if (seen.has(k)) return true; seen.add(k); return false })
  }
  const posts = layout.members.filter((m) => m.type === 'post')
  add('duplicate-pipes', duplicates(layout.pipeSegments, (m) => lineKey(m.start, m.end)).map((m) => m.id))
  add('duplicate-connectors', duplicates(layout.connectors, (c) => pointKey(c.position)).map((c) => c.id))
  add('unbased-posts', posts.filter((p) => !layout.baseChannels.some((b) => pointOnLine(p.start, b.start, b.end))).map((p) => ({ id: p.id, at: p.start })))

  const deckLayers = [...new Set(layout.decks.map((d) => d.layer))]
  let coveredArea = 0
  for (const layer of deckLayers) {
    const decks = layout.decks.filter((d) => d.layer === layer)
    const rectangles = decks.flatMap((d) => (d.coverage ?? [d.corners]).map(corners => [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[2])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[2]))] as [number, number, number, number]))
    const nominal = rectangles.reduce((sum, [x0,z0,x1,z1]) => sum + (x1-x0)*(z1-z0), 0)
    const union = rectangleUnionArea(rectangles)
    coveredArea += union
    const envelope = rectangleUnionArea(decks.map(d => [Math.min(...d.corners.map(p => p[0])), Math.min(...d.corners.map(p => p[2])), Math.max(...d.corners.map(p => p[0])), Math.max(...d.corners.map(p => p[2]))]))
    if (Math.abs(envelope - union) > 0.01) add('deck-coverage-hole', [{ layer, expected: envelope, actual: union }])
    if (nominal - union > 0.01) add('deck-overlap', [{ layer, overlapArea: +(nominal-union).toFixed(3), nominalArea: +nominal.toFixed(3), unionArea: +union.toFixed(3) }])
  }
  if (Math.abs(coveredArea - layout.materials.deckArea) > 0.01) add('deck-area-mismatch', [{ expected: coveredArea, actual: layout.materials.deckArea }])

  // Consecutive posts on a real longitudinal row are neighbours, including mitres.
  const byId = new Map(layout.members.map((m) => [m.id, m]))
  const seams = new Map(posts.map((post) => [post.id, layout.connectors.filter((c) => c.type === 'butt' && c.memberId === post.id).map((c) => c.position[1])]))
  const adjacent = new Map<string, [string, string]>()
  for (const member of layout.members.filter((m) => (m.type === 'longitudinal' || m.type === 'transverse') && m.layer === 1)) {
    const candidates = posts.filter((p) => pointOnLine(p.start, member.start, member.end)).sort((a, b) => Math.hypot(a.start[0]-member.start[0],a.start[2]-member.start[2])-Math.hypot(b.start[0]-member.start[0],b.start[2]-member.start[2]))
    for (let i=1;i<candidates.length;i++) adjacent.set([candidates[i-1].id,candidates[i].id].sort().join(':'), [candidates[i-1].id,candidates[i].id])
  }
  add('splice-stagger', [...adjacent.values()].filter(([a,b]) => seams.get(a)!.some((y) => seams.get(b)!.some((z) => Math.abs(y-z) < 0.499))).map(([a,b]) => ({ posts: [byId.get(a)!.start,byId.get(b)!.start], joints: [seams.get(a),seams.get(b)] })))

  // A collinear node is still a post station; it cannot silently lose its crossbar.
  const origin = shape.points[0]
  const missing = []
  for (let i=1;i<shape.points.length-1;i++) {
    const a=shape.points[i-1], b=shape.points[i], c=shape.points[i+1]
    const ab=[b[0]-a[0],b[1]-a[1]], bc=[c[0]-b[0],c[1]-b[1]]
    if (Math.abs(ab[0]*bc[1]-ab[1]*bc[0])>0.001 || ab[0]*bc[0]+ab[1]*bc[1] <= 0) continue
    const x=b[0]-origin[0], z=b[1]-origin[1]
    if (!layout.members.some((m) => m.type==='transverse' && m.layer===1 && m.connectionPoints.some((p)=>close(p[0],x)&&close(p[2],z)))) missing.push({ node:i+1, at:[x,z] })
  }
  add('missing-collinear-transverse', missing)

  const oneLegCorners = []
  for (let i = 1; i < shape.points.length - 1; i++) {
    const a = shape.points[i - 1], b = shape.points[i], c = shape.points[i + 1]
    const ab = [b[0] - a[0], b[1] - a[1]], bc = [c[0] - b[0], c[1] - b[1]]
    const al = Math.hypot(...ab), bl = Math.hypot(...bc)
    if (ab[0] * bc[1] - ab[1] * bc[0] <= 0 || Math.min(al, bl) >= parameters.width) continue
    const x = b[0] - origin[0] + parameters.width * (-ab[1] / al - bc[1] / bl)
    const z = b[1] - origin[1] + parameters.width * (ab[0] / al + bc[0] / bl)
    const post = posts.find((p) => close(p.start[0], x) && close(p.start[2], z))
    if (!post?.cornerJunctions?.includes(i - 1)) {
      if (!layout.warnings.some(w => w.id === `short-corner-${i - 1}`)) add('unhandled-short-corner', [{ node: i + 1 }])
      continue
    }
    const runs = layout.connectors.filter((tie) => tie.type === 'cross' && tie.connectedMemberId === post.id)
      .map((tie) => byId.get(tie.memberId)!)
      .filter((m) => m.type === 'longitudinal' && m.layer === 1)
    if (runs.length < 2) oneLegCorners.push({ node: i + 1, post: post.start, connectedSegments: runs.map((m) => m.pathSegment) })
  }
  add('one-leg-mitre', oneLegCorners)
  if (shape.kind === 'invalid' && !layout.warnings.some((warning) => /自交|重叠|折返/.test(warning.message))) {
    add('invalid-path-unwarned', [shape.id])
  }


  // Every closed corner must be treated in the same way, including last→first.
  const closed = shape.points.length > 2 && shape.points[0].every((v,i) => close(v,shape.points.at(-1)![i]))
  if (closed && shape.kind !== 'invalid') {
    const p=shape.points[0], prev=shape.points.at(-2)!, next=shape.points[1]
    const incoming=[p[0]-prev[0],p[1]-prev[1]], outgoing=[next[0]-p[0],next[1]-p[1]]
    const il=Math.hypot(...incoming), ol=Math.hypot(...outgoing)
    const cross=incoming[0]*outgoing[1]-incoming[1]*outgoing[0]
    if (Math.abs(cross)>0.001 && il>=parameters.width && ol>=parameters.width) {
      const expected: Vector3Tuple = [parameters.width*(-incoming[1]/il-outgoing[1]/ol),0,parameters.width*(incoming[0]/il+outgoing[0]/ol)]
      if (!posts.some((post)=>close(post.start[0],expected[0])&&close(post.start[2],expected[2]))) add('missing-closure-mitre', [{ expected }])
    }
  }

  const finite = layout.pipeSegments.every((p) => [...p.start,...p.end,p.stockLength].every(Number.isFinite))
    && layout.connectors.every((c)=>c.position.every(Number.isFinite))
  add('nonfinite-output', finite ? [] : ['NaN or Infinity'])
  const expectedPerimeter = shape.points.slice(1).reduce((sum, [x, z], index) => sum + Math.hypot(x - shape.points[index][0], z - shape.points[index][1]), 0)
  add('perimeter-mismatch', Math.abs(layout.perimeter - expectedPerimeter) > 0.005 ? [{ actual: layout.perimeter, expected: expectedPerimeter }] : [])
  add('stock-length-mismatch', layout.pipeSegments.filter((pipe) => Math.abs(Math.hypot(...pipe.end.map((value, index) => value - pipe.start[index])) - pipe.stockLength) > 0.002).map((pipe) => pipe.id))
  const materials = layout.materials
  const sumStock = Object.values(materials.stockSummary).reduce((a,b)=>a+b,0)
  add('summary-mismatch', [
    sumStock !== layout.pipeSegments.length ? 'stock count' : null,
    materials.deckCount !== layout.decks.length ? 'deck count' : null,
    materials.connectorSummary.cross !== layout.connectors.filter((c)=>c.type==='cross').length ? 'cross count' : null,
    materials.connectorSummary.butt !== layout.pipeSegments.length-layout.members.length ? 'butt count' : null,
  ].filter(Boolean))
  return findings
}
