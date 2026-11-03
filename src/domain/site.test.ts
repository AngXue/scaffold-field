import { describe, expect, it } from 'vitest'
import { calculateSite, defaultSectionLayers, drawingFromSections, GROUND, getSectionLevels, legacySiteDrawing,
  legacySnapshot, readSite, rectangleFromGuides, siteFromLegacy, siteFromSnapshot, blockHasDependents, type Site, type SitePoint } from './site'
import { SITE_DEMOS } from './siteDemos'
import { calculateScaffoldPlan, DEFAULT_PARAMETERS, SWEEP_BAR_LAYER, type ScaffoldParameters } from './scaffold'
import { addHistoryRecord, parseHistory, serialiseHistory } from './history'
import { readDrawing } from './plan'

const demo = (id: string) => SITE_DEMOS.find(d => d.id === id)!
const run = (id: string) => calculateSite(demo(id).site, demo(id).parameters)
const posts = (layout: ReturnType<typeof run>) => layout.members.filter(m => m.type === 'post')

describe('分段测算的独立手算验收', () => {
  it('居中走廊：前左共角，左侧三段 5 / 4 / 5 层，四段齐顶', () => {
    const { site } = demo('corridor')
    const [house, corridor] = site.blocks
    expect([house.width, house.depth, house.height]).toEqual([8, 10, 10])
    expect([corridor.depth, corridor.width, corridor.height]).toEqual([5, 4, 3.5])
    expect(corridor.x + corridor.width).toBe(house.x)
    expect(corridor.z + corridor.depth / 2).toBe(house.z + house.depth / 2)
    expect(site.sections).toHaveLength(2)
    expect(site.sections[0].end).toEqual(site.sections[1].start)
    const layout = run('corridor')
    expect(layout.issues).toEqual([])
    expect(layout.sections.map(s => [s.base, s.levels[0], s.levels.length, s.top])).toEqual([
      [0, 1.88, 5, 9.4], [0, 1.88, 5, 9.4], [3.5, 3.76, 4, 9.4], [0, 1.88, 5, 9.4],
    ])
    expect(posts(layout).filter(post => post.cornerJunctions?.length).map(post => post.start)).toEqual([[-1.25, 0, -1.25]])
    expect(layout.perimeter).toBe(18)
    expect(layout.spans?.filter(span => span.sourceId === 'S2').map(span => span.line.surfaceId)).toEqual([GROUND, 'B2', GROUND])
    expect(layout.joinedLifts?.map(join => join.levels)).toEqual(Array(2).fill([3.76, 5.64, 7.52, 9.4]))
    const spansAt = (level: number) => layout.members.filter(m => m.type === 'longitudinal' && m.start[1] === level
      && m.start[0] === m.end[0] && m.start[2] < 2.5 && m.end[2] > 7.5)
    expect(spansAt(1.88)).toHaveLength(0)
    for (const level of [3.76, 5.64, 7.52, 9.4]) expect(spansAt(level)).toHaveLength(2)
    expect(layout.decks.filter(deck => deck.id.startsWith('transition')).map(deck => deck.layer).sort()).toEqual([2, 2, 3, 3, 4, 4, 5, 5])
    expect(layout.baseChannels.filter(channel => channel.start[1] === 3.5)).toHaveLength(4)
    expect(layout.members.filter(m => m.type === 'guardrail' && m.start[1] === 4.7 && m.start[2] === m.end[2]
      && [2.2, 2.65, 7.35, 7.8].includes(m.start[2]))).toHaveLength(0)
    expect(layout.members.some(m => m.type === 'guardrail' && m.start[1] === 2.82 && m.start[2] === 2.2 && m.end[2] === 2.2)).toBe(true)
    expect(layout.canExportMaterials).toBe(true)
  })

  it('贴墙反向落笔和交换绘制顺序，仍使用同一个外侧转角', () => {
    const { site, parameters } = demo('corridor')
    const sections = [...site.sections].reverse().map(s => ({ ...s, start: s.end, end: s.start }))
    const layout = calculateSite({ ...site, sections }, parameters)
    expect(layout.issues).toEqual([])
    expect(posts(layout).filter(post => post.cornerJunctions?.length).map(post => post.start)).toEqual([[-1.25, 0, -1.25]])
    expect(layout.materials.stockSummary).toEqual(run('corridor').materials.stockSummary)
  })

  it('按全局层交替铺板时，两种落脚面在同一层铺板和接通', () => {
    const { site, parameters } = demo('corridor')
    const layout = calculateSite(site, { ...parameters, deckLiftInterval: 2 })
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.decks.filter(deck => deck.id.startsWith('transition')).map(deck => deck.layer).sort()).toEqual([2, 2, 4, 4])
    expect(new Set(layout.decks.map(deck => deck.layer))).toEqual(new Set([2, 4]))
  })

  it.each([
    [{ x: 0, z: 0 }, { x: 8, z: 0 }, 2, -1.25], [{ x: 0, z: 10 }, { x: 8, z: 10 }, 2, 11.25],
    [{ x: 0, z: 0 }, { x: 0, z: 10 }, 0, -1.25], [{ x: 8, z: 0 }, { x: 8, z: 10 }, 0, 9.25],
  ] as const)('房屋任一边的外排都在墙外', (start, end, axis, outer) => {
    const { site, parameters } = demo('corridor')
    const layout = calculateSite({ ...site, blocks: site.blocks.slice(0, 1),
      sections: [{ ...site.sections[0], start, end }] }, parameters)
    expect(layout.canExportMaterials).toBe(true)
    const sideRails = layout.members.filter(m => m.type === 'guardrail' && m.start[axis] === m.end[axis])
    expect(sideRails.length).toBeGreaterThan(0)
    expect(sideRails.every(m => m.start[axis] === outer)).toBe(true)
  })

  it('未贴墙的自动地面线也能跨越完整覆盖两排柱脚的顶面', () => {
    const { site, parameters } = demo('corridor')
    const section = { ...site.sections[1], start: { x: -1.5, z: 0 }, end: { x: -1.5, z: 10 } }
    const layout = calculateSite({ ...site, sections: [section] }, parameters)
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.spans?.map(span => span.line.surfaceId)).toEqual([GROUND, 'B2', GROUND])
    expect(layout.joinedLifts).toHaveLength(2)
    const low = calculateSite({ ...site, sections: [{ ...section, layers: 1 }] }, parameters)
    expect(low.issues).toContainEqual(expect.objectContaining({ code: 'automatic-route', blocking: true }))
    expect(low.joinedLifts).toHaveLength(0)
  })

  it('跨高差补出的杆件与独立架体相交时，定位相关笔画并拦截出量', () => {
    const { site, parameters } = demo('corridor')
    const crossing = { id: 'S3', surfaceId: GROUND, layers: 5, start: { x: -0.7, z: 2.3 }, end: { x: -3.7, z: 2.3 } }
    const layout = calculateSite({ ...site, sections: [...site.sections, crossing] }, parameters)
    expect(layout.canExportMaterials).toBe(false)
    expect(layout.issues).toContainEqual(expect.objectContaining({ code: 'bridge-overlap', sectionIds: ['S2', 'S3'] }))
  })

  it('3.50 m 屋顶单跨：按两排、两站、两道防护手算所有钢管和扣件', () => {
    const layout = run('roof')
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.sections[0]).toMatchObject({ base: 3.5, levels: [3.76], firstClearance: 0.26, top: 3.76 })
    expect(posts(layout)).toHaveLength(4)
    expect(posts(layout).every(post => post.start[1] === 3.5 && post.length === 2.74)).toBe(true)
    expect(layout.baseChannels.map(c => c.start[1])).toEqual([3.5, 3.5])
    expect(layout.members.filter(m => m.layer === SWEEP_BAR_LAYER).map(m => m.start[1])).toEqual([3.7, 3.7, 3.7, 3.7])
    expect(layout.materials).toMatchObject({ actualLength: 33.6, deckCount: 2, deckArea: 1.62,
      stockSummary: { '3m': 4, '2m': 6, '1.2m': 8 }, connectorSummary: { cross: 28, butt: 0, swivel: null },
      channelSteel: { count: 2, totalLength: 2.4 } })
    expect(Object.keys(layout.materials.stockSummary)).toHaveLength(3)
    expect(layout.pipeSegments).toHaveLength(18)
  })

  it('同一个屋顶改为 3 层：四根 6.50 m 立杆各由两段定尺管组成', () => {
    const { site, parameters } = demo('roof')
    const layout = calculateSite({ ...site, sections: [{ ...site.sections[0], layers: 3 }] }, parameters)
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.sections[0].top).toBe(7.52)
    const ids = new Set(posts(layout).map(m => m.id))
    expect(layout.materials.assemblyPlans.filter(plan => ids.has(plan.memberId))).toHaveLength(4)
    for (const plan of layout.materials.assemblyPlans.filter(plan => ids.has(plan.memberId))) {
      expect(plan.requiredLength).toBe(6.5)
      expect(plan.stockLengths).toHaveLength(2)
      expect(plan.stockLengths).not.toContain(5)
      expect(plan.effectiveLength).toBeGreaterThanOrEqual(6.5)
    }
    expect(layout.materials.connectorSummary.butt).toBe(4)
  })

  it('0 m 正面与 3.50 m 花园齐顶，独立架段的数量可相加', () => {
    const layout = run('aligned')
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.sections.map(section => [section.base, section.levels[0], section.top]))
      .toEqual([[0, 1.88, 9.4], [3.5, 3.76, 9.4]])
    expect(posts(layout)).toHaveLength(18)
    expect(layout.materials).toMatchObject({ deckCount: 64, deckArea: 41.4,
      connectorSummary: { cross: 294 }, channelSteel: { count: 9 } })
    expect(new Set(layout.pipeSegments.map(p => p.id)).size).toBe(layout.pipeSegments.length)
    const memberIds = new Set(layout.members.map(m => m.id))
    expect(layout.connectors.every(c => memberIds.has(c.memberId) && (!c.connectedMemberId || memberIds.has(c.connectedMemberId)))).toBe(true)
  })

  it('判定边界只用毫米，首层严格高于落脚面', () => {
    const cases = [3.759, 3.76, 3.761]
    expect(cases.map(b => getSectionLevels(b, 1.88, 1).levels[0])).toEqual([3.76, 5.64, 5.64])
    expect(getSectionLevels(3.759, 1.88, 1).firstClearance).toBe(0.001)
    expect(defaultSectionLayers(3.5, 1.88, 5)).toEqual({ layers: 4, aboveTarget: false })
    expect(defaultSectionLayers(9.4, 1.88, 5)).toEqual({ layers: 1, aboveTarget: true })
    expect(getSectionLevels(9.4, 1.88, 1).levels).toEqual([11.28])
  })

  it('叠放体块随父体块升高，已填写的层数不被覆盖', () => {
    const { site, parameters } = demo('stack')
    expect(blockHasDependents(site, 'B1')).toBe(true)
    expect(blockHasDependents(site, 'B2')).toBe(true)
    const updated = { ...site, blocks: site.blocks.map(b => b.id === 'B1' ? { ...b, height: 3.5 } : b) }
    const layout = calculateSite(updated, { ...parameters, layerCount: 1 })
    expect(layout.canExportMaterials).toBe(true)
    expect(layout.sections[0]).toMatchObject({ base: 4, levels: [5.64, 7.52, 9.4, 11.28], top: 11.28 })
    expect(layout.blocks.find(b => b.id === 'B2')).toMatchObject({ base: 3.5, top: 4 })
    expect(site.sections[0].layers).toBe(4)
  })

  it.each([
    ['narrow', 'off-surface'], ['step', 'off-surface'], ['sweep', 'sweep-conflict'],
    ['penetration', 'house-penetration'], ['overlap', 'independent-overlap'],
  ])('草图 %s 保留定位并阻止出量', (fixture, code) => {
    const layout = run(fixture)
    expect(layout.canExportMaterials).toBe(false)
    expect(layout.issues).toContainEqual(expect.objectContaining({ code, blocking: true, sectionIds: expect.arrayContaining(['S1']) }))
    expect(readSite(JSON.parse(JSON.stringify(demo(fixture).site)))).toEqual(demo(fixture).site)
  })

  it('修正窄顶面后恢复；扫地杆冲突仍保留原首层', () => {
    const { site, parameters } = demo('narrow')
    expect(calculateSite({ ...site, blocks: site.blocks.map(b => ({ ...b, depth: 2 })) }, parameters).canExportMaterials).toBe(true)
    expect(run('sweep').sections[0].levels).toEqual([3.76])
  })

  it('高差场景不足 0.10 m 的原段或交点碎段不会被自动拉长出量', () => {
    const { site, parameters } = demo('roof')
    const [line] = site.sections
    const splitAt = { x: line.start.x + 0.05, z: line.start.z }
    for (const sections of [
      [{ ...line, end: splitAt }],
      [line, { ...line, id: 'S2', start: splitAt, end: { ...splitAt, z: splitAt.z + 1 } }],
    ]) {
      const layout = calculateSite({ ...site, sections }, parameters)
      expect(layout.canExportMaterials).toBe(false)
      expect(layout.pipeSegments).toHaveLength(0)
      expect(layout.issues).toContainEqual(expect.objectContaining({ code: 'short-section', sectionIds: [line.id] }))
    }
  })

  it('底座中心线在屋顶内时，仍检查 48 mm 翼缘是否悬空', () => {
    const { site, parameters } = demo('roof')
    const [line] = site.sections
    const measure = (x: number) => calculateSite({ ...site, sections: [{ ...line,
      start: { ...line.start, x }, end: { ...line.end, x: x + 1.8 },
    }] }, { ...parameters, pipeDiameter: 0.02 })
    const near = measure(0.015)
    expect(near.baseChannels.every(beam => beam.start[0] > 0 && beam.end[0] > 0)).toBe(true)
    expect(near.issues).toContainEqual(expect.objectContaining({ code: 'off-surface', message: expect.stringContaining('底座') }))
    expect(measure(0.025).canExportMaterials).toBe(true)
  })

  it('关闭扫地杆也不会让紧贴顶面的作业杆穿屋而通过', () => {
    const { site, parameters } = demo('roof')
    const layout = calculateSite({ ...site, blocks: site.blocks.map(b => ({ ...b, height: 3.759 })) }, { ...parameters, sweepBarHeight: 0 })
    expect(layout.sections[0].levels[0]).toBe(3.76)
    expect(layout.issues.some(issue => issue.code === 'house-penetration')).toBe(true)
  })

  it('同一父子关系不能循环，缺失的顶面不退回地面', () => {
    const { site, parameters } = demo('stack')
    const cyclic = { ...site, blocks: [{ ...site.blocks[0], parentId: 'B2' }, site.blocks[1]] }
    const layout = calculateSite(cyclic, parameters)
    expect(layout.canExportMaterials).toBe(false)
    expect(layout.issues.map(issue => issue.code)).toContain('missing-surface')
    expect(layout.pipeSegments).toHaveLength(0)
  })

  it('只有四条闭合矩形边可转为体块', () => {
    const points = [{ x: 0, z: 0 }, { x: 6, z: 0 }, { x: 6, z: 4 }, { x: 0, z: 4 }]
    const guides = points.map((start, i) => ({ id: String(i), start, end: points[(i + 1) % 4], surfaceId: GROUND }))
    expect(rectangleFromGuides(guides)).toEqual({ x: 0, z: 0, width: 6, depth: 4 })
    expect(rectangleFromGuides(guides.slice(1))).toBeUndefined()
    expect(rectangleFromGuides([{ ...guides[0], end: points[2] }, ...guides.slice(1)])).toBeUndefined()
  })
})

describe('坐标变换和 1.3 存档兼容', () => {
  it('带高差的场景整体平移和转 90° 后，标高及材料完全一致', () => {
    const { site, parameters } = demo('aligned')
    const original = calculateSite(site, parameters)
    const move = ({ x, z }: SitePoint) => ({ x: 100 - z, z: 23 + x })
    const moved: Site = {
      ...site,
      blocks: site.blocks.map(b => ({ ...b, ...move({ x: b.x, z: b.z + b.depth }), width: b.depth, depth: b.width })),
      sections: site.sections.map(s => ({ ...s, start: move(s.start), end: move(s.end) })),
    }
    const result = calculateSite(moved, parameters)
    expect(result.issues).toEqual([])
    expect(result.sections).toEqual(original.sections)
    expect(result.materials).toEqual(original.materials)
  })

  it.each([1, 2, 4])('迁移原平地 %i 段：测量、构件和材料与旧入口一致', count => {
    const { site, parameters } = demo('legacy')
    const drawing = drawingFromSections(site.sections.slice(0, count))
    const old = calculateScaffoldPlan(drawing, parameters)
    const migrated = siteFromLegacy(readDrawing(drawing.points, drawing.segments), parameters.layerCount)
    expect(legacySiteDrawing(migrated)?.layers).toBe(5)
    const current = calculateSite(migrated, parameters)
    expect(current.canExportMaterials).toBe(true)
    expect(current.perimeter).toBe(old.perimeter)
    expect(current.materials).toMatchObject({ ...old.materials, assemblyPlans: current.materials.assemblyPlans })
    expect(current.members.map(m => [m.type, m.start, m.end])).toEqual(old.members.map(m => [m.type, m.start, m.end]))
  })

  it('0.7 存档和历史保留体块、架段以及修正量，参数变化不改已画段', () => {
    const { site, parameters } = demo('aligned')
    const snapshot = { ...legacySnapshot(site), scene: site, parameters, adjustments: { 'stock:2m': 3 } }
    const history = parseHistory(serialiseHistory(addHistoryRecord([], snapshot)))
    expect(history[0]).toMatchObject(snapshot)
    expect(siteFromSnapshot(history[0])).toEqual(site)
    expect(legacySiteDrawing(site)).toBeUndefined()
    expect(calculateSite(site, { ...DEFAULT_PARAMETERS, layerCount: 2 } as ScaffoldParameters).sections.map(s => s.top)).toEqual([9.4, 9.4])
  })
})
