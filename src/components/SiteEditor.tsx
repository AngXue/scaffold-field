import { lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Box, Crosshair, Focus, Hand, Magnet, Maximize2, Minimize2, Pencil, Redo2, Square, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { blockHasDependents, defaultSectionLayers, getSectionLevels, GROUND, MIN_SECTION_LENGTH, rectangleFromGuides, reverseSectionGroup, roundSite, siteLength, surfaceElevation, type Footprint, type Site, type SiteBlock, type SiteLayout, type SitePoint, type SiteSection } from '../domain/site'
import type { ScaffoldParameters } from '../domain/scaffold'
import { SITE_DEMOS, type SiteDemo } from '../domain/siteDemos'
import { alignSiteBlock, type AlignmentGuide } from '../domain/siteAlignment'
import { routeSiteSections, siteWallEdges, snapScaffoldStroke, wallStandOff, type WallEdge } from '../domain/siteRouting'
import { useCssFullscreen } from '../platform/fullscreen'

const Viewer = lazy(() => import('./ScaffoldViewer').then(module => ({ default: module.ScaffoldViewer })))

type Tool = 'house' | 'scaffold' | 'browse'
type View = { x: number; z: number; scale: number }
type Draft = { start: SitePoint; end: SitePoint; kind: 'rectangle' | 'guide' | 'section' | 'end'; edge?: WallEdge }
  | { kind: 'move-block'; id: string; position: SitePoint; guides: AlignmentGuide[] }
type Gesture = { startScreen: SitePoint; start: SitePoint; view: View; target?: string; surface?: string; endpoint?: 'start' | 'end'; block?: SiteBlock; kind: 'pan' | 'draw' | 'pick' }
type Props = { site: Site; layout: SiteLayout; parameters: ScaffoldParameters; onChange: (site: Site) => void; onDemo: (demo: SiteDemo) => void; onReset: () => void }
const clampZoom = (scale: number) => Math.min(420, Math.max(2, scale))
const distance = (a: SitePoint, b: SitePoint) => Math.hypot(a.x - b.x, a.z - b.z)
const formatMetres = (value?: number) => value === undefined ? '—' : value.toFixed(3).replace(/0$/, '')
const midpoint = (a: SitePoint, b: SitePoint) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })
const rectOf = (a: SitePoint, b: SitePoint): Footprint => ({
  x: Math.min(a.x, b.x), z: Math.min(a.z, b.z), width: roundSite(Math.abs(b.x - a.x)), depth: roundSite(Math.abs(b.z - a.z)),
})
const straight = (a: SitePoint, b: SitePoint): SitePoint => Math.abs(b.x - a.x) >= Math.abs(b.z - a.z) ? { ...b, z: a.z } : { ...b, x: a.x }
const pointAlong = (a: SitePoint, b: SitePoint, length: number): SitePoint => {
  const old = distance(a, b)
  return old > 0 ? { x: roundSite(a.x + (b.x - a.x) / old * length), z: roundSite(a.z + (b.z - a.z) / old * length) } : a
}
const nextId = (site: Site, prefix: string) => {
  const taken = new Set([...site.blocks, ...site.guides, ...site.sections].map(item => item.id))
  let i = 1
  while (taken.has(prefix + i)) i++
  return prefix + i
}

function BlockDimensions({ block, scale }: { block: Footprint; scale: number }) {
  const { x, z, width, depth } = block
  return <g className="site-block-dimensions" pointerEvents="none">
    {(['top', 'bottom', 'left', 'right'] as const).map(side => {
      const horizontal = side === 'top' || side === 'bottom'
      const near = side === 'top' || side === 'left'
      const along = horizontal ? x : z
      const length = horizontal ? width : depth
      const edge = horizontal ? (near ? z : z + depth) : (near ? x : x + width)
      const offset = edge + (near ? -1 : 1) * 14 / scale
      const mid = along + length / 2
      return <g key={side}>
        <path vectorEffect="non-scaling-stroke" d={horizontal ? `M${along} ${edge}V${offset}H${along + length}V${edge}`
          : `M${edge} ${along}H${offset}V${along + length}H${edge}`} />
        <text className="site-svg-label" transform={horizontal ? undefined : `rotate(-90 ${offset} ${mid})`}
          x={horizontal ? mid : offset} y={horizontal ? offset : mid} textAnchor="middle" dominantBaseline="central" fontSize={11 / scale}>
          {formatMetres(length)} m
        </text>
      </g>
    })}
  </g>
}

function EditorNumber({ label, value, onCommit, min = 0.01, max = 1000, integer = false }: {
  label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number; integer?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return <label className="site-field"><span>{label}</span>
    <input inputMode={integer ? 'numeric' : 'decimal'} value={draft ?? String(value)}
      onChange={e => setDraft(e.currentTarget.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      onBlur={() => {
        const n = Number(draft)
        if (draft?.trim() && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, integer ? Math.round(n) : roundSite(n))))
        setDraft(null)
      }} />
  </label>
}

export function SiteEditor({ site, layout, parameters, onChange, onDemo, onReset }: Props) {
  const [tool, setTool] = useState<Tool>('scaffold')
  const [houseBrush, setHouseBrush] = useState<'rectangle' | 'guide'>('rectangle')
  const [surfaceId, setSurfaceId] = useState(GROUND)
  const [selected, setSelected] = useState<string>()
  const [guideIds, setGuideIds] = useState<string[]>([])
  const [draft, setDraft] = useState<Draft>()
  const [snap, setSnap] = useState(true)
  const [pan, setPan] = useState(false)
  const [pick, setPick] = useState(false)
  const [notice, setNotice] = useState('')
  const [demoId, setDemoId] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 0, z: 0, scale: 45 })
  const svg = useRef<SVGSVGElement>(null)
  const viewRef = useRef(view)
  const lastPen = useRef<'house' | 'scaffold'>('scaffold')
  const pointers = useRef(new Map<number, SitePoint>())
  const gesture = useRef<Gesture>(null)
  const pinch = useRef<{ center: SitePoint; distance: number; view: View }>(null)
  const undo = useRef<Site[]>([]), redo = useRef<Site[]>([])
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 })
  const fitted = useRef(false)
  const { isFullscreen, toggleFullscreen } = useCssFullscreen()
  const surface = surfaceElevation(layout.blocks, surfaceId)
  const selectedBlock = site.blocks.find(block => block.id === selected)
  const selectedSection = site.sections.find(section => section.id === selected)
  const selectedSpans = layout.spans?.filter(span => span.sourceId === selected) ?? []
  const selectedSummaries = layout.sections.filter(summary => summary.id === selected || selectedSpans.some(span => span.line.id === summary.id))
  const selectedSummary = selectedSummaries[0]
  const selectedJoins = layout.joinedLifts?.filter(join => selectedSpans.some(span => span.line.id === join.before)) ?? []
  const selectedGuide = site.guides.find(guide => guide.id === selected)
  const moving = draft?.kind === 'move-block' ? draft : undefined
  const moveTool = tool === 'house' && houseBrush === 'rectangle' && !pan && !pick
  const selectedDimensions = layout.pathDimensions.filter(d => (layout.spans?.[d.index]?.sourceId ?? site.sections[d.index]?.id) === selected)
  const wallEdges = siteWallEdges(layout.blocks)
  const blockLabel = (id: string) => id === GROUND ? '最低地面' : id + ' 顶面'
  const setViewport = useCallback((next: View) => { viewRef.current = next; setView(next) }, [])
  const bounds = (value: Site) => {
    const points = [...value.blocks.flatMap(b => [{ x: b.x, z: b.z }, { x: b.x + b.width, z: b.z + b.depth }]),
      ...[...value.guides, ...value.sections].flatMap(line => [line.start, line.end])]
    return points.length ? points : [{ x: -5, z: -4 }, { x: 5, z: 4 }]
  }
  function frame(points: SitePoint[], width = size.width, height = size.height) {
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z))
    const scale = clampZoom(Math.min((width - 72) / Math.max(3, maxX - minX + 1.5), (height - 62) / Math.max(3, maxZ - minZ + 1.5)))
    setViewport({ x: width / 2 - (minX + maxX) / 2 * scale, z: height / 2 - (minZ + maxZ) / 2 * scale, scale })
  }
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
      if (width > 0 && height > 0 && !fitted.current) {
        fitted.current = true
        frame(bounds(site), width, height)
      }
    })
    resize.observe(el)
    return () => resize.disconnect()
    // On edits keep the same view; only first open and canvas remount need observation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool === 'browse'])

  const zoom = useCallback((factor: number, at: SitePoint) => {
    const v = viewRef.current, scale = clampZoom(v.scale * factor), ratio = scale / v.scale
    setViewport({ scale, x: at.x - (at.x - v.x) * ratio, z: at.z - (at.z - v.z) * ratio })
  }, [setViewport])
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoom(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, z: e.clientY - r.top })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [tool, zoom])

  const commit = (next: Site) => {
    if (JSON.stringify(next) === JSON.stringify(site)) return
    undo.current = [...undo.current, site].slice(-100); redo.current = []
    setHistorySize({ undo: undo.current.length, redo: 0 })
    onChange(next)
  }
  const travel = (back: boolean) => {
    const from = back ? undo.current : redo.current, to = back ? redo.current : undo.current
    const next = from.pop()
    if (!next) return
    to.push(site); onChange(next)
    setHistorySize({ undo: undo.current.length, redo: redo.current.length })
    if (surfaceId !== GROUND && !next.blocks.some(block => block.id === surfaceId)) setSurfaceId(GROUND)
    setSelected(undefined); setGuideIds([]); setNotice('')
  }
  const changeTool = (value: Tool) => {
    if (value !== 'browse') lastPen.current = value
    setTool(value); setDraft(undefined); setPan(false); setPick(false)
  }
  const chooseSurface = (id: string) => {
    setSurfaceId(id); setPick(false); setDraft(undefined)
    if (tool === 'browse') changeTool(lastPen.current)
    setNotice('')
  }
  const select = (id: string | undefined) => {
    setSelected(id); setNotice('')
    const section = site.sections.find(line => line.id === id)
    if (section) chooseSurface(section.surfaceId)
    if (id && site.guides.some(guide => guide.id === id)) setGuideIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])
    else setGuideIds([])
  }
  const screen = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, z: e.clientY - r.top }
  }
  const sitePoint = (p: SitePoint, endpoints: boolean) => {
    const v = viewRef.current
    const raw = { x: (p.x - v.x) / v.scale, z: (p.z - v.z) / v.scale }
    if (!snap) return { x: roundSite(raw.x), z: roundSite(raw.z) }
    const points = endpoints ? (tool === 'scaffold' ? site.sections : site.guides)
      .filter(line => line.surfaceId === surfaceId && (!gesture.current?.endpoint || line.id !== selected))
      .flatMap(line => [line.start, line.end]) : []
    const near = points.reduce<SitePoint | undefined>((best, q) => distance(q, raw) * v.scale <= 10
      && (!best || distance(q, raw) < distance(best, raw)) ? q : best, undefined)
    return near ?? { x: Math.round(raw.x * 10) / 10, z: Math.round(raw.z * 10) / 10 }
  }

  function start(e: PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    const p = screen(e)
    pointers.current.set(e.pointerId, p)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { center: midpoint(a, b), distance: distance(a, b), view: viewRef.current }
      gesture.current = null; setDraft(undefined)
      return
    }
    const hit = e.target as Element
    const target = hit.closest('[data-site-object]')
    const face = target?.getAttribute('data-site-face')
    const block = moveTool && (face !== surfaceId || hit.closest('[data-site-move]'))
      ? site.blocks.find(item => item.id === face) : undefined
    gesture.current = { startScreen: p, start: sitePoint(p, houseBrush !== 'rectangle' || tool === 'scaffold'), view: viewRef.current,
      target: target?.getAttribute('data-site-object') ?? undefined, surface: face ?? undefined, block,
      endpoint: hit.closest('[data-endpoint]')?.getAttribute('data-endpoint') as Gesture['endpoint'] || undefined,
      kind: pan || e.button === 1 || e.shiftKey ? 'pan' : pick ? 'pick' : 'draw' }
  }
  const makeDraft = (g: Gesture, p: SitePoint): Draft => {
    if (g.block) {
      const block = g.block
      const position = { x: block.x + (p.x - g.startScreen.x) / g.view.scale, z: block.z + (p.z - g.startScreen.z) / g.view.scale }
      const aligned = snap ? alignSiteBlock(block, position, site.blocks.filter(other => other.id !== block.id),
        [...site.guides, ...site.sections], Math.min(0.35, 8 / g.view.scale))
        : { position: { x: roundSite(position.x), z: roundSite(position.z) }, guides: [] }
      return { ...aligned, kind: 'move-block', id: block.id }
    }
    const end = sitePoint(p, tool === 'scaffold' || houseBrush === 'guide')
    const wallDraft = (start: SitePoint, target: SitePoint) => {
      if (surfaceId === GROUND && snap) {
        const aligned = snapScaffoldStroke(start, target, wallEdges, Math.min(0.45, Math.max(0.07, 12 / g.view.scale)))
        if (aligned.edge) return aligned
      }
      return { start, end: straight(start, target) }
    }
    if (g.endpoint && selectedSection) {
      const other = selectedSection[g.endpoint === 'start' ? 'end' : 'start']
      const resized = selectedSection.automatic ? wallDraft(other, end) : { start: other, end: straight(other, end) }
      return { ...resized, kind: 'end' }
    }
    return tool === 'scaffold' ? { ...wallDraft(g.start, end), kind: 'section' } : { start: g.start, end, kind: houseBrush }
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) return
    const p = screen(e)
    pointers.current.set(e.pointerId, p)
    const multi = pinch.current
    if (multi && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()], center = midpoint(a, b)
      const scale = clampZoom(multi.view.scale * distance(a, b) / Math.max(1, multi.distance))
      const ratio = scale / multi.view.scale
      setViewport({ scale, x: center.x - (multi.center.x - multi.view.x) * ratio, z: center.z - (multi.center.z - multi.view.z) * ratio })
      return
    }
    const g = gesture.current
    if (!g) return
    if (g.kind === 'pan') setViewport({ ...g.view, x: g.view.x + p.x - g.startScreen.x, z: g.view.z + p.z - g.startScreen.z })
    if (g.kind === 'draw') setDraft(distance(p, g.startScreen) > 4 ? makeDraft(g, p) : undefined)
  }
  function finish(e: PointerEvent<SVGSVGElement>, cancel = false) {
    pointers.current.delete(e.pointerId)
    if (pinch.current) { if (!pointers.current.size) pinch.current = null; return }
    const g = gesture.current; gesture.current = null; setDraft(undefined)
    if (!g || cancel) return
    if (g.kind === 'pick') { chooseSurface(g.surface ?? GROUND); return }
    if (g.kind === 'pan') return
    const p = screen(e)
    if (distance(p, g.startScreen) <= 4) { select(g.target); return }
    const draw = makeDraft(g, p)
    if (draw.kind === 'move-block') {
      updateBlock(draw.id, draw.position)
      select(draw.id)
      return
    }
    if (draw.kind === 'end' && selectedSection && g.endpoint) {
      if (distance(draw.start, draw.end) >= MIN_SECTION_LENGTH) updateSection(selectedSection.id, {
        [g.endpoint]: draw.end, [g.endpoint === 'start' ? 'end' : 'start']: draw.start,
      })
      else setNotice('架段至少需要 0.10 m。')
      return
    }
    if (surface === undefined) { setNotice('请先选择有效的落脚面。'); return }
    if (draw.kind === 'rectangle') {
      const footprint = rectOf(draw.start, draw.end)
      if (footprint.width >= 0.01 && footprint.depth >= 0.01) addBlock(footprint)
    } else if (distance(draw.start, draw.end) >= 0.01) {
      const id = nextId(site, draw.kind === 'section' ? 'S' : 'G')
      const line = { id, surfaceId, start: draw.start, end: draw.end }
      if (draw.kind === 'section') {
        if (siteLength(line) < MIN_SECTION_LENGTH) { setNotice('架段至少需要 0.10 m。'); return }
        const initial = defaultSectionLayers(surface, parameters.liftHeight, parameters.layerCount)
        const samePoint = (a: SitePoint, b: SitePoint) => distance(a, b) < 0.001
        if (site.sections.some(s => s.surfaceId === surfaceId &&
          ((samePoint(s.start, line.start) && samePoint(s.end, line.end)) || (samePoint(s.start, line.end) && samePoint(s.end, line.start))))) {
          setNotice('这个落脚面上已有相同的架段，请选择该段编辑。'); return
        }
        commit({ ...site, sections: [...site.sections, { ...line, layers: initial.layers, ...(surfaceId === GROUND && { automatic: true }) }] })
        setNotice(initial.aboveTarget ? '落脚面已到达或高过项目默认目标，先填 1 层。' : '')
      } else commit({ ...site, guides: [...site.guides, line] })
      setGuideIds([]); setSelected(id)
    }
  }
  function addBlock(footprint: Footprint, parent = surfaceId, consumed: string[] = []) {
    const id = nextId(site, 'B')
    commit({ ...site, blocks: [...site.blocks, { ...footprint, id, parentId: parent, height: 3 }],
      guides: site.guides.filter(guide => !consumed.includes(guide.id)) })
    setSelected(id); setGuideIds([]); setNotice('')
  }
  function updateSection(id: string, update: Partial<SiteSection>) {
    commit({ ...site, sections: site.sections.map(section => section.id === id ? { ...section, ...update } : section) })
  }
  const updateBlock = (id: string, update: Partial<SiteBlock>) =>
    commit({ ...site, blocks: site.blocks.map(block => block.id === id ? { ...block, ...update } : block) })

  const deleteSelected = () => {
    if (!selected) return
    if (selectedBlock && blockHasDependents(site, selectedBlock.id)) {
      setNotice('此体块仍有架段、辅助线或叠放体块，请先换面或移除依赖。'); return
    }
    commit({ blocks: site.blocks.filter(b => b.id !== selected), guides: site.guides.filter(g => g.id !== selected),
      sections: site.sections.filter(s => s.id !== selected) })
    if (surfaceId === selected) chooseSurface(GROUND)
    setSelected(undefined); setGuideIds([]); setNotice('')
  }
  const selectedGuides = site.guides.filter(g => guideIds.includes(g.id))
  const outline = rectangleFromGuides(selectedGuides)
  const locate = (id: string) => {
    const line = site.sections.find(s => s.id === id)
    const block = site.blocks.find(b => b.id === id)
    if (line) { changeTool('scaffold'); chooseSurface(line.surfaceId); if (size.width) frame([line.start, line.end]) }
    else if (block) { changeTool('house'); chooseSurface(block.parentId); if (size.width) frame([block, { x: block.x + block.width, z: block.z + block.depth }]) }
    setSelected(id); setPanelOpen(true)
  }
  const badIds = new Set(layout.issues.filter(issue => issue.blocking).flatMap(issue => issue.sectionIds))
  const badBlocks = new Set(layout.issues.filter(issue => issue.blocking).map(issue => issue.blockId))
  const surfaces = [{ id: GROUND, top: 0 }, ...layout.blocks]
  const options = surfaces.map(item => <option key={item.id} value={item.id}>{blockLabel(item.id)} · {formatMetres(item.top)} m</option>)
  const strip = (a: SitePoint, b: SitePoint) => {
    const dx = b.x - a.x, dz = b.z - a.z, len = distance(a, b) || 1
    const x = -dz / len * parameters.width, z = dx / len * parameters.width
    return `${a.x},${a.z} ${b.x},${b.z} ${b.x + x},${b.z + z} ${a.x + x},${a.z + z}`
  }
  const draftStrip = (a: SitePoint, b: SitePoint, edge?: WallEdge) => {
    if (!edge) return strip(a, b)
    const offset = edge.outward * wallStandOff(parameters)
    const start = { ...a, [edge.axis]: edge.at + offset }, end = { ...b, [edge.axis]: edge.at + offset }
    const sign = edge.axis === 'x' ? -Math.sign(end.z - start.z) : Math.sign(end.x - start.x)
    return sign === edge.outward ? strip(start, end) : strip(end, start)
  }
  const preview = draft?.kind === 'section' && surfaceId === GROUND && layout.blocks.length
    ? routeSiteSections([{ id: 'preview', surfaceId, automatic: true, layers: parameters.layerCount,
      start: draft.start, end: draft.end }], layout.blocks, parameters) : undefined
  const frameAll = () => frame(bounds(site))
  const showDemo = () => {
    const demo = SITE_DEMOS.find(item => item.id === demoId)
    if (!demo || !window.confirm('载入验收 Demo 会替换当前画布，请先保存需要保留的项目。继续载入？')) return
    onDemo(demo)
  }
  return <div className={`site-editor${isFullscreen ? ' is-fullscreen' : ''}`}>
    <header className="site-toolbar">
      <div className="site-tools" role="group" aria-label="绘图模式">
        <button aria-pressed={tool === 'house'} onClick={() => changeTool('house')}><Square size={16} /> 房屋笔</button>
        <button aria-pressed={tool === 'scaffold'} onClick={() => changeTool('scaffold')}><Pencil size={16} /> 脚手架笔</button>
        <button aria-pressed={tool === 'browse'} onClick={() => changeTool('browse')}><Box size={16} /> 浏览</button>
      </div>
      <label className="site-surface">落脚面 <select aria-label="落脚面" value={surfaceId} onChange={e => chooseSurface(e.currentTarget.value)}>
        {surface === undefined && <option value={surfaceId}>不可用：{surfaceId}</option>}
        {tool === 'scaffold' ? <><option value={GROUND}>自动 · 从最低地面起算</option>{options.slice(1)}</> : options}
      </select></label>
      <button className="site-icon" aria-label="在画布选面" aria-pressed={pick} disabled={tool === 'browse'} title="在画布选面" onClick={() => { setPick(!pick); setPan(false) }}><Crosshair size={18} /></button>
      <button className="site-icon" aria-label={isFullscreen ? '退出全屏绘图' : '全屏绘图'} title="全屏" onClick={toggleFullscreen}>{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
    </header>
    <div className="site-editor-body">
      <div className="site-stage">
        {tool === 'browse' ? <Suspense fallback={<div className="viewer-loading">正在加载三维引擎…</div>}>
          <Viewer layout={layout} blocks={layout.blocks} onSelectSurface={chooseSurface} pipeDiameter={parameters.pipeDiameter} />
        </Suspense> : <>
          <div className="site-canvas-tools" role="group" aria-label="画布工具">
            {tool === 'house' && <div className="site-tools">
              <button aria-pressed={houseBrush === 'rectangle'} onClick={() => setHouseBrush('rectangle')}>矩形</button>
              <button aria-pressed={houseBrush === 'guide'} onClick={() => setHouseBrush('guide')}>辅助线</button>
            </div>}
            <button title="撤销" aria-label="撤销" disabled={historySize.undo === 0} onClick={() => travel(true)}><Undo2 size={17} /></button>
            <button title="重做" aria-label="重做" disabled={historySize.redo === 0} onClick={() => travel(false)}><Redo2 size={17} /></button>
            <button title="网格吸附" aria-label="网格吸附" aria-pressed={snap} onClick={() => setSnap(!snap)}><Magnet size={17} /></button>
            <button title="平移画布" aria-label="平移画布" aria-pressed={pan} onClick={() => { setPan(!pan); setPick(false) }}><Hand size={17} /></button>
            <button title="适应图纸" aria-label="适应图纸" onClick={frameAll}><Focus size={17} /></button>
            <button title="缩小" aria-label="缩小" onClick={() => zoom(0.8, { x: size.width / 2, z: size.height / 2 })}><ZoomOut size={17} /></button>
            <button title="放大" aria-label="放大" onClick={() => zoom(1.25, { x: size.width / 2, z: size.height / 2 })}><ZoomIn size={17} /></button>
          </div>
          <svg ref={svg} className={`site-plan${pan ? ' is-panning' : ''}`} aria-label="选面俯视绘图画布" viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
            onPointerDown={start} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)}
            onContextMenu={e => e.preventDefault()}>
            <defs><pattern id="site-grid" x={view.x} y={view.z} width={view.scale} height={view.scale} patternUnits="userSpaceOnUse">
              <path d={`M${view.scale} 0H0V${view.scale}`} fill="none" stroke="#d1d9da" strokeWidth="1" />
              {view.scale >= 65 && Array.from({ length: 9 }, (_, i) => (i + 1) * view.scale / 10).map(at =>
                <path key={at} d={`M${at} 0V${view.scale} M0 ${at}H${view.scale}`} fill="none" stroke="#e7eded" strokeWidth="0.6" />)}
            </pattern></defs>
            <rect width="100%" height="100%" fill="url(#site-grid)" />
            <g transform={`translate(${view.x} ${view.z}) scale(${view.scale})`}>
              {[...site.blocks].sort((a, b) => (surfaceElevation(layout.blocks, a.id) ?? 0) - (surfaceElevation(layout.blocks, b.id) ?? 0)).map(item => {
                const isMoving = moving?.id === item.id
                const block = isMoving ? { ...item, ...moving.position } : item
                return <g key={block.id} data-site-object={block.id} data-site-face={block.id}>
                  <rect className={`site-block${surfaceId === block.id ? ' active' : ''}${selected === block.id || isMoving ? ' selected' : ''}${badBlocks.has(block.id) ? ' invalid' : ''}${moveTool && surfaceId !== block.id ? ' movable' : ''}`}
                    x={block.x} y={block.z} width={Math.max(0, block.width)} height={Math.max(0, block.depth)} vectorEffect="non-scaling-stroke" />
                  {block.width * view.scale >= 85 && block.depth * view.scale >= 25 &&
                    <text className="site-svg-label" x={block.x + 9 / view.scale} y={block.z + 16 / view.scale}
                      fontSize={12 / view.scale} pointerEvents="none">
                      {block.id} · {formatMetres(surfaceElevation(layout.blocks, block.id))} m
                    </text>}
                  <BlockDimensions block={block} scale={view.scale} />
                  {moveTool && <rect data-site-move="" className="site-block-move-edge" vectorEffect="non-scaling-stroke"
                    x={block.x} y={block.z} width={Math.max(0, block.width)} height={Math.max(0, block.depth)} />}
                </g>
              })}
              {site.guides.map(guide => <g key={guide.id} data-site-object={guide.id} className={guide.surfaceId === surfaceId ? '' : 'site-off-plane'}>
                <line x1={guide.start.x} y1={guide.start.z} x2={guide.end.x} y2={guide.end.z} vectorEffect="non-scaling-stroke" className="site-hit" />
                <line x1={guide.start.x} y1={guide.start.z} x2={guide.end.x} y2={guide.end.z} vectorEffect="non-scaling-stroke"
                  className={guideIds.includes(guide.id) ? 'site-guide selected' : 'site-guide'} />
              </g>)}
              {!draft && selectedDimensions.map(dimension => <polygon key={dimension.index} className={`site-strip${dimension.start[1] > 0 ? ' raised' : ''}`}
                pointerEvents="none" vectorEffect="non-scaling-stroke"
                points={strip({ x: dimension.start[0], z: dimension.start[2] }, { x: dimension.end[0], z: dimension.end[2] })} />)}
              {site.sections.map((line, index) => {
                const mid = midpoint(line.start, line.end)
                const vertical = Math.abs(line.end.z - line.start.z) > Math.abs(line.end.x - line.start.x)
                const edge = layout.spans?.some(span => span.sourceId === line.id && span.wall)
                  ? snapScaffoldStroke(line.start, line.end, wallEdges, 0.001).edge : undefined
                const x = mid.x + (vertical ? (edge ? -edge.outward * 20 : 9) / view.scale : 0)
                const y = mid.z + (vertical ? 4 : edge ? -edge.outward * 22 : -9) / view.scale
                return <g key={line.id} data-site-object={line.id} className={line.surfaceId === surfaceId ? '' : 'site-off-plane'}>
                  <line x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} vectorEffect="non-scaling-stroke" className="site-hit" />
                  <line x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} vectorEffect="non-scaling-stroke"
                    className={`site-section${selected === line.id ? ' selected' : ''}${badIds.has(line.id) ? ' invalid' : ''}`} />
                  <text className="site-svg-label" x={x} y={y} fontSize={12 / view.scale}
                    textAnchor={vertical ? edge?.outward === 1 ? 'end' : 'start' : 'middle'} pointerEvents="none">第 {index + 1} 段 · {formatMetres(siteLength(line))} m</text>
                  {selected === line.id && tool === 'scaffold' && !pick && (['start', 'end'] as const).map(endpoint =>
                    <circle key={endpoint} data-endpoint={endpoint} cx={line[endpoint].x} cy={line[endpoint].z} r={7 / view.scale}
                      vectorEffect="non-scaling-stroke" className="site-endpoint" />)}
                </g>
              })}
              {moving?.guides.map(({ axis, at, from, to }) => {
                const padding = 7 / view.scale
                return <path key={axis} className="site-alignment-guide" vectorEffect="non-scaling-stroke" pointerEvents="none"
                  d={axis === 'x' ? `M${at} ${from - padding}V${to + padding}` : `M${from - padding} ${at}H${to + padding}`} />
              })}
              {draft && draft.kind !== 'move-block' && <g pointerEvents="none">
                {draft.kind === 'rectangle' ? <rect x={rectOf(draft.start, draft.end).x} y={rectOf(draft.start, draft.end).z}
                  width={rectOf(draft.start, draft.end).width} height={rectOf(draft.start, draft.end).depth} className="site-block active" vectorEffect="non-scaling-stroke" />
                  : <>
                    {preview?.spans.length ? preview.spans.map(({ line }) => <polygon key={line.id} points={strip(line.start, line.end)}
                      className={`site-strip${line.surfaceId === GROUND ? '' : ' raised'}`} vectorEffect="non-scaling-stroke" />)
                      : (draft.kind === 'section' || draft.kind === 'end') && <polygon points={draftStrip(draft.start, draft.end, draft.edge)} className="site-strip" vectorEffect="non-scaling-stroke" />}
                    <line x1={draft.start.x} y1={draft.start.z} x2={draft.end.x} y2={draft.end.z} className="site-guide selected" vectorEffect="non-scaling-stroke" />
                  </>}
              </g>}
            </g>
          </svg>
          <div className="site-canvas-status"><strong>{blockLabel(surfaceId)} · {formatMetres(surface)} m</strong>
            <span>周长 {formatMetres(layout.perimeter)} m</span>
            <span>{pick ? '点选一个顶面；点空白选择地面' : pan ? '拖动画布' : moveTool ? '空白处画矩形 · 拖体块或边框移动'
              : tool === 'scaffold' && surfaceId === GROUND ? preview?.errors[0]?.message
                ?? (preview && preview.spans.length > 1 ? `沿途识别 ${preview.spans.length} 段 · 松手后测算`
                  : draft && 'edge' in draft && draft.edge ? '已贴墙 · 外排在离墙一侧' : '沿墙拖一笔 · 自动识别沿途落脚面')
                : '拖动画线 · 双指平移缩放'}</span></div>
        </>}
      </div>
      <aside className={`site-details${panelOpen ? ' open' : ''}`} aria-label="对象与测算">
        <button className="site-panel-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>对象与测算 <span>{panelOpen ? '收起' : '展开'}</span></button>
        {panelOpen && <div className="site-details-content">
          <label className="site-field">选择对象<select aria-label="选择对象" value={selected ?? ''} onChange={e => select(e.currentTarget.value || undefined)}>
            <option value="">请选择体块或架段</option>
            {site.blocks.map(block => <option key={block.id} value={block.id}>体块 {block.id}</option>)}
            {site.sections.map((line, index) => <option key={line.id} value={line.id}>第 {index + 1} 段 · {formatMetres(siteLength(line))} m</option>)}
            {site.guides.map(guide => <option key={guide.id} value={guide.id}>辅助线 {guide.id}</option>)}
          </select></label>
          {selectedBlock && <section key={selectedBlock.id} className="site-object">
            <strong>体块 {selectedBlock.id}</strong>
            <EditorNumber label="长度 (m)" value={selectedBlock.width} onCommit={width => updateBlock(selectedBlock.id, { width })} />
            <EditorNumber label="宽度 (m)" value={selectedBlock.depth} onCommit={depth => updateBlock(selectedBlock.id, { depth })} />
            <EditorNumber label="高度 (m)" value={selectedBlock.height} onCommit={height => updateBlock(selectedBlock.id, { height })} />
            <details><summary>移动体块</summary>
              <EditorNumber label="平面 X (m)" value={selectedBlock.x} min={-1000} onCommit={x => updateBlock(selectedBlock.id, { x })} />
              <EditorNumber label="平面 Z (m)" value={selectedBlock.z} min={-1000} onCommit={z => updateBlock(selectedBlock.id, { z })} />
            </details>
            <p>底面 {formatMetres(layout.blocks.find(b => b.id === selected)?.base)} m · 顶面 {formatMetres(surfaceElevation(layout.blocks, selectedBlock.id))} m</p>
            <button className="site-action" onClick={() => chooseSurface(selectedBlock.id)}>在此顶面绘制</button>
          </section>}
          {selectedSection && <section key={selectedSection.id} className="site-object">
            <strong>第 {site.sections.indexOf(selectedSection) + 1} 段</strong>
            <label className="site-field">架段落脚面<select aria-label="架段落脚面" value={selectedSection.automatic ? 'automatic' : selectedSection.surfaceId} onChange={e => {
              const automatic = e.currentTarget.value === 'automatic'
              const next = automatic ? GROUND : e.currentTarget.value
              const base = surfaceElevation(layout.blocks, next) ?? 0
              const previousBase = surfaceElevation(layout.blocks, selectedSection.surfaceId) ?? 0
              const first = getSectionLevels(base, parameters.liftHeight, 1).firstLayer
              const previousFirst = getSectionLevels(previousBase, parameters.liftHeight, 1).firstLayer
              const layers = automatic ? Math.min(20, selectedSection.layers + previousFirst - 1)
                : selectedSection.automatic ? Math.max(1, selectedSection.layers - first + 1) : selectedSection.layers
              updateSection(selectedSection.id, { surfaceId: next, automatic: automatic ? true : undefined, layers }); chooseSurface(next)
            }}>
              <option value="automatic">自动识别落脚面</option>
              {surfaceElevation(layout.blocks, selectedSection.surfaceId) === undefined && <option value={selectedSection.surfaceId}>不可用：{selectedSection.surfaceId}</option>}
              {options}</select></label>
            <EditorNumber label="段长 (m)" min={MIN_SECTION_LENGTH} value={siteLength(selectedSection)} onCommit={n => updateSection(selectedSection.id, { end: pointAlong(selectedSection.start, selectedSection.end, n) })} />
            <EditorNumber label={selectedSection.automatic ? '目标全局层' : '作业层数'} value={selectedSection.layers} min={1} max={20} integer onCommit={layers => updateSection(selectedSection.id, { layers })} />
            {selectedSummaries.length > 1 && <div className="site-routed-spans">
              <strong>自动分为 {selectedSummaries.length} 段</strong>
              {selectedSpans.map(span => {
                const summary = selectedSummaries.find(item => item.id === span.line.id)
                return summary && <div key={span.line.id}>{blockLabel(span.line.surfaceId)} · {formatMetres(summary.base)} m<br />
                  {summary.levels.length} 层 · 全局第 {summary.firstLayer} 层起 · 顶层 {formatMetres(summary.top)} m</div>
              })}
              {selectedJoins[0] && <p>同层接通：{selectedJoins[0].levels.map(level => formatMetres(level)).join(' / ')} m</p>}
            </div>}
            {selectedSummary && selectedSummaries.length === 1 && <dl className="site-levels">
              <dt>落脚标高</dt><dd>{formatMetres(selectedSummary.base)} m</dd>
              <dt>首层标高</dt><dd>{formatMetres(selectedSummary.levels[0])} m · 全局第 {selectedSummary.firstLayer} 层</dd>
              <dt>首层距地</dt><dd>{formatMetres(selectedSummary.firstClearance)} m</dd>
              <dt>顶层标高</dt><dd>{formatMetres(selectedSummary.top)} m</dd>
            </dl>}
            {selectedSpans.some(span => span.wall) ? <p>贴墙布置，外排自动放在离墙一侧。</p>
              : <button className="site-action" onClick={() => commit(reverseSectionGroup(site, selectedSection.id))}>连通架段反向布置</button>}
          </section>}
          {selectedGuide && <p>已选辅助线 {guideIds.length} 条。逐条点选四条矩形边。</p>}
          {outline && <button className="site-action" onClick={() => addBlock(outline, selectedGuides[0].surfaceId, guideIds)}>把四条边转为体块</button>}
          {selected && <button className="site-action" onClick={deleteSelected}><Trash2 size={15} /> 删除选中对象</button>}
          {notice && <p className="site-notice" role="status">{notice}</p>}
          {layout.issues.length > 0 && <div className="site-issues">
            <strong>需要检查的位置</strong>
            {layout.issues.map((issue, i) => <button key={issue.code + i} className={issue.blocking ? 'blocking' : ''}
              onClick={() => locate(issue.sectionIds[0] ?? issue.blockId ?? '')}>{issue.message} <span>定位</span></button>)}
          </div>}
          <details className="site-demos"><summary>验收 Demo</summary>
            <select aria-label="验收 Demo" value={demoId} onChange={e => setDemoId(e.currentTarget.value)}>
              <option value="">选择固定测试图纸</option>
              {SITE_DEMOS.map(demo => <option key={demo.id} value={demo.id}>{demo.title}</option>)}
            </select>
            <p>{SITE_DEMOS.find(demo => demo.id === demoId)?.check}</p>
            <button className="site-action" disabled={!demoId} onClick={showDemo}>载入 Demo</button>
          </details>
          <button className="site-action" onClick={() => { if (window.confirm('恢复默认示例将替换当前画布，继续？')) onReset() }}>恢复默认示例</button>
        </div>}
      </aside>
    </div>
  </div>
}
