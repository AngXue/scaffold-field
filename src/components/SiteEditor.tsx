import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { Box, Crosshair, Focus, Hand, Magnet, Maximize2, Minimize2, Pencil, Redo2, Square, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { blockHasDependents, defaultSectionLayers, GROUND, MIN_SECTION_LENGTH, reverseSectionGroup, roundSite, sectionTargetLayer, siteLength, surfaceElevation, type Footprint, type Site, type SiteBlock, type SiteLayout, type SitePoint, type SiteSection } from '../domain/site'
import type { ScaffoldParameters } from '../domain/scaffold'
import { SITE_DEMOS, type SiteDemo } from '../domain/siteDemos'
import { alignSiteBlock, type AlignmentGuide } from '../domain/siteAlignment'
import { footprintFromOutline, footprintOutline, reshapeFootprint } from '../domain/siteFootprints'
import { routeSiteSections, siteWallEdges, snapScaffoldStroke, wallStandOff, type WallEdge } from '../domain/siteRouting'
import { useCssFullscreen } from '../platform/fullscreen'
import { Badge, Button, EmptyState, Field, IconButton, Input, SegmentedControl, Select } from './ui'
import { layoutPlanAnnotations, type PlanDimension, type PlanSectionLabel } from './planAnnotations'

const Viewer = lazy(() => import('./ScaffoldViewer').then(module => ({ default: module.ScaffoldViewer })))

type Tool = 'house' | 'scaffold' | 'browse'
type View = { x: number; z: number; scale: number }
type Draft = { start: SitePoint; end: SitePoint; kind: 'rectangle' | 'outline' | 'section' | 'end'; edge?: WallEdge }
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
/** Neutral warm greys, one per elevation step: the only way plan blocks differ. */
const BLOCK_TONES = ['#ded9cf', '#d6d2c8', '#e3ded5', '#cfcbc2', '#d9d5cc', '#d4cfc5']

function PlanDimensionLine({ dimension, scale }: { dimension: PlanDimension; scale: number }) {
  const { from, to, normal, offset } = dimension
  const a = { x: from.x + normal.x * offset, z: from.z + normal.z * offset }
  const b = { x: to.x + normal.x * offset, z: to.z + normal.z * offset }
  const tick = 4.5 / scale
  const labelGap = 10 / scale
  const horizontal = Math.abs(normal.x) < 0.5
  const textAt = { x: (a.x + b.x) / 2 + normal.x * labelGap, z: (a.z + b.z) / 2 + normal.z * labelGap }
  return <g className={dimension.selected ? 'site-dimension is-selected' : 'site-dimension'} data-dimension-for={dimension.blockId} pointerEvents="none">
    <path className="site-dimension-line" vectorEffect="non-scaling-stroke"
      d={`M${from.x} ${from.z}L${a.x} ${a.z}M${to.x} ${to.z}L${b.x} ${b.z}M${a.x} ${a.z}L${b.x} ${b.z}`} />
    <path className="site-dimension-tick" vectorEffect="non-scaling-stroke"
      d={`M${a.x - (horizontal ? 0 : tick)} ${a.z - (horizontal ? tick : 0)}L${a.x + (horizontal ? 0 : tick)} ${a.z + (horizontal ? tick : 0)}`
        + `M${b.x - (horizontal ? 0 : tick)} ${b.z - (horizontal ? tick : 0)}L${b.x + (horizontal ? 0 : tick)} ${b.z + (horizontal ? tick : 0)}`} />
    <text className="site-svg-label site-dimension-label"
      x={horizontal ? textAt.x : textAt.x} y={horizontal ? textAt.z : textAt.z}
      transform={horizontal ? undefined : `rotate(-90 ${textAt.x} ${textAt.z})`}
      fontSize={11 / scale} textAnchor="middle" dominantBaseline="central">{dimension.text}</text>
  </g>
}

/** The drawing preview uses the same snapped endpoints as the committed edge. */
function OutlineDimension({ start, end, active, scale }: { start: SitePoint; end: SitePoint; active: boolean; scale: number }) {
  const horizontal = start.z === end.z
  const length = roundSite(distance(start, end))
  return <g data-outline-dimension={active ? 'active' : 'fixed'} pointerEvents="none">
    <PlanDimensionLine scale={scale} dimension={{
      key: 'outline', blockId: 'outline', side: horizontal ? 'top' : 'right', length,
      from: start, to: end, normal: horizontal ? { x: 0, z: -1 } : { x: 1, z: 0 },
      offset: 12 / scale, selected: active, text: `${formatMetres(length)} m`,
    }} />
  </g>
}

function PlanSectionAnnotation({ label, selected, scale }: { label: PlanSectionLabel; selected: boolean; scale: number }) {
  const width = (label.text.length * 6.4 + 12) / scale
  const height = 16 / scale
  const x = label.position.x, z = label.position.z
  return <g className={selected ? 'site-annotation is-selected' : 'site-annotation'} data-label-for={label.id}
    transform={label.vertical ? `rotate(-90 ${x} ${z})` : undefined}>
    <rect className="site-annotation-chip" x={x - width / 2} y={z - height / 2} width={width} height={height}
      rx={4 / scale} vectorEffect="non-scaling-stroke" />
    <text className="site-annotation-label" data-label-for={label.id} x={x} y={z} fontSize={10 / scale}
      textAnchor="middle" dominantBaseline="central">{label.text}</text>
  </g>
}

function EditorNumber({ label, value, onCommit, min = 0.01, max = 1000, integer = false }: {
  label: string; value: number; onCommit: (value: number) => void; min?: number; max?: number; integer?: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const id = useId()
  return <Field label={label} htmlFor={id}>
    <Input id={id} inputMode={integer ? 'numeric' : 'decimal'} value={draft ?? String(value)}
      onChange={e => setDraft(e.currentTarget.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
      onBlur={() => {
        const n = Number(draft)
        if (draft?.trim() && Number.isFinite(n)) onCommit(Math.max(min, Math.min(max, integer ? Math.round(n) : roundSite(n))))
        setDraft(null)
      }} />
  </Field>
}

export function SiteEditor({ site, layout, parameters, onChange, onDemo, onReset }: Props) {
  const [tool, setTool] = useState<Tool>('scaffold')
  const [houseBrush, setHouseBrush] = useState<'rectangle' | 'outline'>('rectangle')
  const [surfaceId, setSurfaceId] = useState(GROUND)
  const [selected, setSelected] = useState<string>()
  const [houseOutline, setHouseOutline] = useState<SitePoint[]>([])
  const [draft, setDraft] = useState<Draft>()
  const [snap, setSnap] = useState(true)
  const [pan, setPan] = useState(false)
  const [pick, setPick] = useState(false)
  const [notice, setNotice] = useState('')
  const [demoId, setDemoId] = useState('')
  // On a phone the drawing needs the height more than an empty details card.
  const [panelOpen, setPanelOpen] = useState(() => typeof window === 'undefined' || window.matchMedia('(min-width: 801px)').matches)
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
  const selectedFollowsGlobal = selectedSection?.automatic ? selectedSection.followGlobal !== false : selectedSection?.followGlobal === true
  const selectedLayerCount = selectedSection?.automatic
    ? sectionTargetLayer(selectedSection, parameters, layout.blocks)
    : selectedSummary?.levels.length ?? selectedSection?.layers ?? 1
  const selectedJoins = layout.joinedLifts?.filter(join => selectedSpans.some(span => span.line.id === join.before)) ?? []
  const selectedGuide = site.guides.find(guide => guide.id === selected)
  const moving = draft?.kind === 'move-block' ? draft : undefined
  const outlineMode = tool === 'house' && houseBrush === 'outline'
  const activeOutline = outlineMode && draft?.kind === 'outline' ? draft : undefined
  const drawnOutlineLength = houseOutline.slice(1).reduce((sum, end, index) => sum + distance(houseOutline[index], end), 0)
  const moveTool = tool === 'house' && houseBrush === 'rectangle' && !pan && !pick
  const selectedDimensions = layout.pathDimensions.filter(d => (layout.spans?.[d.index]?.sourceId ?? site.sections[d.index]?.id) === selected)
  const wallEdges = siteWallEdges(layout.blocks)
  const blockLabel = (id: string) => id === GROUND ? '最低地面' : id + ' 顶面'
  const setViewport = useCallback((next: View) => { viewRef.current = next; setView(next) }, [])
  const badIds = new Set(layout.issues.filter(issue => issue.blocking).flatMap(issue => issue.sectionIds))
  const badBlocks = new Set(layout.issues.filter(issue => issue.blocking).map(issue => issue.blockId))
  const surfaces = [{ id: GROUND, top: 0 }, ...layout.blocks]
  const sortedBlocks = useMemo(() => [...site.blocks].sort((a, b) =>
    (surfaceElevation(layout.blocks, a.id) ?? 0) - (surfaceElevation(layout.blocks, b.id) ?? 0)), [site.blocks, layout.blocks])
  const annotations = useMemo(() => layoutPlanAnnotations(
    sortedBlocks.map(item => ({
      ...item,
      ...(moving?.id === item.id ? moving.position : {}),
      name: `${item.id} · ${formatMetres(surfaceElevation(layout.blocks, item.id))} m`,
      base: layout.blocks.find(block => block.id === item.id)?.base ?? 0,
      top: surfaceElevation(layout.blocks, item.id) ?? 0,
      selected: selected === item.id,
    })),
    site.sections.map((line, index) => ({ id: line.id, start: line.start, end: line.end,
      // Unselected segments show only their number: the length is already on the
      // block edge they usually follow, and a second copy reads as an overlap.
      text: selected === line.id ? `第 ${index + 1} 段 · ${formatMetres(siteLength(line))} m` : `第 ${index + 1} 段` })),
    view.scale,
  ), [sortedBlocks, site.sections, layout.blocks, selected, view.scale, moving])
  const dimensionByBlock = useMemo(() => {
    const map = new Map<string, PlanDimension[]>()
    for (const dimension of annotations.dimensions) {
      map.set(dimension.blockId, [...(map.get(dimension.blockId) ?? []), dimension])
    }
    return map
  }, [annotations.dimensions])
  // A covered block's label would be painted over by the block above it. Keep the
  // label only where it belongs to a visible surface; a selected block always wins.
  const blockLabels = sortedBlocks.flatMap(block => {
    const item = moving?.id === block.id ? { ...block, ...reshapeFootprint(block, moving.position) } : block
    const isSelected = selected === item.id
    if (selectedBlock && !isSelected) return []
    const elevation = surfaceElevation(layout.blocks, item.id) ?? 0
    if (!isSelected && layout.blocks.some(other => other.id !== item.id && other.top > elevation + 1e-6
      && other.x < item.x + item.width - 1e-6 && other.x + other.width > item.x + 1e-6
      && other.z < item.z + item.depth - 1e-6 && other.z + other.depth > item.z + 1e-6)) return []
    if (item.width * view.scale < 78 || item.depth * view.scale < 24) return []
    return [{ id: item.id, x: item.x, z: item.z, text: `${item.id} · ${formatMetres(elevation)} m`, isSelected }]
  })

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
    if (back && houseOutline.length) { setHouseOutline(points => points.slice(0, -1)); setDraft(undefined); return }
    const from = back ? undo.current : redo.current, to = back ? redo.current : undo.current
    const next = from.pop()
    if (!next) return
    to.push(site); onChange(next)
    setHistorySize({ undo: undo.current.length, redo: redo.current.length })
    if (surfaceId !== GROUND && !next.blocks.some(block => block.id === surfaceId)) setSurfaceId(GROUND)
    setSelected(undefined); setNotice('')
  }
  const changeTool = (value: Tool) => {
    if (value !== 'browse') lastPen.current = value
    setTool(value); setDraft(undefined); setHouseOutline([]); setPan(false); setPick(false)
  }
  const chooseSurface = (id: string) => {
    setSurfaceId(id); setPick(false); setDraft(undefined); setHouseOutline([])
    if (tool === 'browse') changeTool(lastPen.current)
    setNotice('')
  }
  const select = (id: string | undefined) => {
    setSelected(id); setNotice('')
    const section = site.sections.find(line => line.id === id)
    if (section) chooseSurface(section.surfaceId)

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
    gesture.current = { startScreen: p, start: outlineMode && houseOutline.length ? houseOutline.at(-1)! : sitePoint(p, tool === 'scaffold'), view: viewRef.current,
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
    const end = sitePoint(p, tool === 'scaffold')
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
    if (tool === 'scaffold') return { ...wallDraft(g.start, end), kind: 'section' }
    if (houseBrush === 'outline') {
      let target = straight(g.start, end)
      const first = houseOutline[0]
      if (first && distance(first, target) * g.view.scale <= 10 && (first.x === g.start.x || first.z === g.start.z)) target = first
      return { start: g.start, end: target, kind: 'outline' }
    }
    return { start: g.start, end, kind: 'rectangle' }
  }
  function move(e: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.has(e.pointerId)) {
      if (outlineMode && houseOutline.length) setDraft(makeDraft({ start: houseOutline.at(-1)!, startScreen: screen(e), view: viewRef.current, kind: 'draw' }, screen(e)))
      return
    }
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
    const draw = makeDraft(g, p)
    if (outlineMode && draw.kind === 'outline') {
      if (surface === undefined) { setNotice('请先选择有效的落脚面。'); return }
      const points = houseOutline.length ? houseOutline : [draw.start]
      if (distance(points.at(-1)!, draw.end) < 0.001) { setHouseOutline(points); return }
      if (points.length >= 4 && distance(points[0], draw.end) < 0.001) {
        const shape = footprintFromOutline([...points, draw.end])
        if (!shape) { setNotice('轮廓存在交叉或折返，请撤销最后一点后调整。'); return }
        addBlock(shape); setHouseOutline([])
      } else { setHouseOutline([...points, draw.end]); setNotice('') }
      return
    }
    if (distance(p, g.startScreen) <= 4) { select(g.target); return }
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
    } else if (draw.kind === 'section' && distance(draw.start, draw.end) >= 0.01) {
      const id = nextId(site, 'S')
      const line = { id, surfaceId, start: draw.start, end: draw.end }
      if (draw.kind === 'section') {
        if (siteLength(line) < MIN_SECTION_LENGTH) { setNotice('架段至少需要 0.10 m。'); return }
        const initial = defaultSectionLayers(surface, parameters.liftHeight, parameters.layerCount)
        const samePoint = (a: SitePoint, b: SitePoint) => distance(a, b) < 0.001
        if (site.sections.some(s => s.surfaceId === surfaceId &&
          ((samePoint(s.start, line.start) && samePoint(s.end, line.end)) || (samePoint(s.start, line.end) && samePoint(s.end, line.start))))) {
          setNotice('这个落脚面上已有相同的架段，请选择该段编辑。'); return
        }
        commit({ ...site, sections: [...site.sections, { ...line, layers: initial.layers,
          ...(surfaceId === GROUND ? { automatic: true } : { followGlobal: true }) }] })
        setNotice(initial.aboveTarget ? '落脚面已到达或高过项目默认目标，先填 1 层。' : '')
      }
      setSelected(id)
    }
  }
  function addBlock(footprint: Footprint, parent = surfaceId) {
    const id = nextId(site, 'B')
    commit({ ...site, blocks: [...site.blocks, { ...footprint, id, parentId: parent, height: 3 }] })
    setSelected(id); setNotice('')
  }
  function updateSection(id: string, update: Partial<SiteSection>) {
    commit({ ...site, sections: site.sections.map(section => section.id === id ? { ...section, ...update } : section) })
  }
  const updateBlock = (id: string, update: Partial<SiteBlock>) =>
    commit({ ...site, blocks: site.blocks.map(block => block.id === id ? { ...reshapeFootprint(block, update), id: block.id, parentId: block.parentId, height: update.height ?? block.height } : block) })

  const deleteSelected = () => {
    if (!selected) return
    if (selectedBlock && blockHasDependents(site, selectedBlock.id)) {
      setNotice('此体块仍有架段、辅助线或叠放体块，请先换面或移除依赖。'); return
    }
    commit({ blocks: site.blocks.filter(b => b.id !== selected), guides: site.guides.filter(g => g.id !== selected),
      sections: site.sections.filter(s => s.id !== selected) })
    if (surfaceId === selected) chooseSurface(GROUND)
    setSelected(undefined); setNotice('')
  }
  const selectedLabel = selectedBlock ? `体块 ${selectedBlock.id}`
    : selectedSection ? `第 ${site.sections.indexOf(selectedSection) + 1} 段`
      : selectedGuide ? `辅助线 ${selectedGuide.id}` : ''
  const locate = (id: string) => {
    const line = site.sections.find(s => s.id === id)
    const block = site.blocks.find(b => b.id === id)
    if (line) { changeTool('scaffold'); chooseSurface(line.surfaceId); if (size.width) frame([line.start, line.end]) }
    else if (block) { changeTool('house'); chooseSurface(block.parentId); if (size.width) frame([block, { x: block.x + block.width, z: block.z + block.depth }]) }
    setSelected(id); setPanelOpen(true)
  }
  const surfaceOptions = [
    ...(surface === undefined ? [{ value: surfaceId, label: `不可用：${surfaceId}` }] : []),
    ...surfaces.map(item => ({ value: item.id, label: `${blockLabel(item.id)} · ${formatMetres(item.top)} m` })),
  ]
  const surfaceSelectOptions = tool === 'scaffold'
    ? [{ value: GROUND, label: '自动 · 从最低地面起算' }, ...surfaceOptions.filter(option => option.value !== GROUND)]
    : surfaceOptions
  const objectOptions = [
    { value: '', label: '请选择体块或架段' },
    ...site.blocks.map(block => ({ value: block.id, label: `体块 ${block.id}` })),
    ...site.sections.map((line, index) => ({ value: line.id, label: `第 ${index + 1} 段 · ${formatMetres(siteLength(line))} m` })),
    ...site.guides.map(guide => ({ value: guide.id, label: `辅助线 ${guide.id}` })),
  ]
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
  const selectedLinks = selectedJoins.flatMap(join => {
    const before = selectedSpans.find(span => span.line.id === join.before)?.line
    const after = selectedSpans.find(span => span.line.id === join.after)?.line
    return before && after ? [{ before, after }] : []
  })
  const frameAll = () => frame(bounds(site))
  const showDemo = () => {
    const demo = SITE_DEMOS.find(item => item.id === demoId)
    if (!demo || !window.confirm('载入验收 Demo 会替换当前画布，请先保存需要保留的项目。继续载入？')) return
    onDemo(demo)
  }
  const sectionSelectionOptions = selectedSection ? [
    { value: 'automatic', label: '自动识别落脚面' },
    ...(surfaceElevation(layout.blocks, selectedSection.surfaceId) === undefined
      ? [{ value: selectedSection.surfaceId, label: `不可用：${selectedSection.surfaceId}` }] : []),
    ...surfaces.map(item => ({ value: item.id, label: `${blockLabel(item.id)} · ${formatMetres(item.top)} m` })),
  ] : []

  return <div className={`site-editor${isFullscreen ? ' is-fullscreen' : ''}`}>
    <header className="site-toolbar">
      <SegmentedControl<Tool> ariaLabel="绘图模式" value={tool} onChange={changeTool} options={[
        { value: 'house', label: '房屋笔', icon: <Square size={16} /> },
        { value: 'scaffold', label: '脚手架笔', icon: <Pencil size={16} /> },
        { value: 'browse', label: '浏览', icon: <Box size={16} /> },
      ]} />
      <label className="site-surface"><span>落脚面</span>
        <Select aria-label="落脚面" value={surfaceId} onChange={e => chooseSurface(e.currentTarget.value)} options={surfaceSelectOptions} />
      </label>
      <IconButton label="在画布选面" icon={<Crosshair size={18} />} toggle active={pick} disabled={tool === 'browse'}
        onClick={() => { setPick(!pick); setPan(false) }} />
      <IconButton label={isFullscreen ? '退出全屏绘图' : '全屏绘图'} icon={isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        onClick={toggleFullscreen} />
    </header>
    <div className="site-editor-body">
      <div className="site-stage">
        {tool === 'browse' ? <Suspense fallback={<div className="viewer-loading">正在加载三维引擎…</div>}>
          <Viewer layout={layout} blocks={layout.blocks} onSelectSurface={chooseSurface} pipeDiameter={parameters.pipeDiameter} />
        </Suspense> : <>
          <div className="site-canvas-tools" role="group" aria-label="画布工具">
            {tool === 'house' && <>
              <SegmentedControl<'rectangle' | 'outline'> ariaLabel="房屋笔类型" value={houseBrush}
                onChange={value => { setHouseBrush(value); setHouseOutline([]); setDraft(undefined) }} options={[{ value: 'rectangle', label: '矩形' }, { value: 'outline', label: '轮廓' }]} />
              <span className="site-tool-divider" aria-hidden />
            </>}
            <IconButton size="sm" label="撤销" icon={<Undo2 size={17} />} disabled={historySize.undo === 0 && houseOutline.length === 0} onClick={() => travel(true)} />
            <IconButton size="sm" label="重做" icon={<Redo2 size={17} />} disabled={historySize.redo === 0} onClick={() => travel(false)} />
            <span className="site-tool-divider" aria-hidden />
            <IconButton size="sm" label="网格吸附" icon={<Magnet size={17} />} toggle active={snap} onClick={() => setSnap(!snap)} />
            <IconButton size="sm" label="平移画布" icon={<Hand size={17} />} toggle active={pan} onClick={() => { setPan(!pan); setPick(false) }} />
            <span className="site-tool-divider" aria-hidden />
            <IconButton size="sm" label="适应图纸" icon={<Focus size={17} />} onClick={frameAll} />
            <IconButton size="sm" label="缩小" icon={<ZoomOut size={17} />} onClick={() => zoom(0.8, { x: size.width / 2, z: size.height / 2 })} />
            <IconButton size="sm" label="放大" icon={<ZoomIn size={17} />} onClick={() => zoom(1.25, { x: size.width / 2, z: size.height / 2 })} />
          </div>
          {houseOutline.length > 0 && <Button className="site-outline-cancel" size="sm" variant="ghost" onClick={() => { setHouseOutline([]); setDraft(undefined) }}>取消轮廓</Button>}
          <svg ref={svg} className={`site-plan${pan ? ' is-panning' : ''}`} aria-label="选面俯视绘图画布" viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
            onPointerDown={start} onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)}
            onContextMenu={e => e.preventDefault()}>
            <defs><pattern id="site-grid" x={view.x} y={view.z} width={view.scale} height={view.scale} patternUnits="userSpaceOnUse">
              <path d={`M${view.scale} 0H0V${view.scale}`} fill="none" stroke="#d3d8d9" strokeWidth="1" />
              {view.scale >= 65 && Array.from({ length: 9 }, (_, i) => (i + 1) * view.scale / 10).map(at =>
                <path key={at} d={`M${at} 0V${view.scale} M0 ${at}H${view.scale}`} fill="none" stroke="#e5e8e9" strokeWidth="0.6" />)}
            </pattern></defs>
            <rect width="100%" height="100%" fill="url(#site-grid)" />
            <g transform={`translate(${view.x} ${view.z}) scale(${view.scale})`}>
              {sortedBlocks.map((item, index) => {
                const isMoving = moving?.id === item.id
                const block = isMoving ? { ...item, ...reshapeFootprint(item, moving.position) } : item
                return <g key={block.id} data-site-object={block.id} data-site-face={block.id}>
                  {block.outline ? <polygon points={footprintOutline(block).map(p => `${p.x},${p.z}`).join(' ')}
                    className={`site-block${surfaceId === block.id ? ' active' : ''}${selected === block.id || isMoving ? ' selected' : ''}${badBlocks.has(block.id) ? ' invalid' : ''}${moveTool ? ' movable' : ''}`}
                    vectorEffect="non-scaling-stroke" /> : <rect className={`site-block${surfaceId === block.id ? ' active' : ''}${selected === block.id || isMoving ? ' selected' : ''}${badBlocks.has(block.id) ? ' invalid' : ''}${moveTool && surfaceId !== block.id ? ' movable' : ''}`}
                    style={{ '--block-tone': BLOCK_TONES[index % BLOCK_TONES.length] } as CSSProperties}
                    x={block.x} y={block.z} width={Math.max(0, block.width)} height={Math.max(0, block.depth)} vectorEffect="non-scaling-stroke" />}
                  {moveTool && block.outline && <polygon data-site-move="" className="site-block-move-edge" vectorEffect="non-scaling-stroke"
                    points={footprintOutline(block).map(p => `${p.x},${p.z}`).join(' ')} />}
                  {moveTool && !block.outline && <rect data-site-move="" className="site-block-move-edge" vectorEffect="non-scaling-stroke"
                    x={block.x} y={block.z} width={Math.max(0, block.width)} height={Math.max(0, block.depth)} />}
                </g>
              })}
              {site.guides.map(guide => <g key={guide.id} data-site-object={guide.id} className={guide.surfaceId === surfaceId ? '' : 'site-off-plane'}>
                <line x1={guide.start.x} y1={guide.start.z} x2={guide.end.x} y2={guide.end.z} vectorEffect="non-scaling-stroke" className="site-hit" />
                <line x1={guide.start.x} y1={guide.start.z} x2={guide.end.x} y2={guide.end.z} vectorEffect="non-scaling-stroke"
                  className={selected === guide.id ? 'site-guide selected' : 'site-guide'} />
              </g>)}
              {!draft && selectedDimensions.map(dimension => <polygon key={dimension.index} className={`site-strip${dimension.start[1] > 0 ? ' raised' : ''}`}
                pointerEvents="none" vectorEffect="non-scaling-stroke"
                points={strip({ x: dimension.start[0], z: dimension.start[2] }, { x: dimension.end[0], z: dimension.end[2] })} />)}
              {!draft && selectedLinks.map(({ before, after }) => <polygon key={before.id} className="site-strip bridge"
                pointerEvents="none" vectorEffect="non-scaling-stroke" points={strip(before.end, after.start)} />)}
              {site.sections.map((line) => {
                return <g key={line.id} data-site-object={line.id} className={line.surfaceId === surfaceId ? '' : 'site-off-plane'}>
                  {selected === line.id && <line className="site-section-halo" x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} vectorEffect="non-scaling-stroke" />}
                  <line x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} vectorEffect="non-scaling-stroke" className="site-hit" />
                  <line x1={line.start.x} y1={line.start.z} x2={line.end.x} y2={line.end.z} vectorEffect="non-scaling-stroke"
                    className={`site-section${selected === line.id ? ' selected' : ''}${badIds.has(line.id) ? ' invalid' : ''}`} />
                  {selected === line.id && tool === 'scaffold' && !pick && (['start', 'end'] as const).map(endpoint =>
                    <circle key={endpoint} data-endpoint={endpoint} cx={line[endpoint].x} cy={line[endpoint].z} r={7 / view.scale}
                      vectorEffect="non-scaling-stroke" className="site-endpoint" />)}
                </g>
              })}
              {houseOutline.length > 0 && <g pointerEvents="none">
                <polyline points={houseOutline.map(p => `${p.x},${p.z}`).join(' ')} fill="none" className="site-section-draft" vectorEffect="non-scaling-stroke" />
                {houseOutline.map((p, i) => <circle key={i} cx={p.x} cy={p.z} r={(i === 0 ? 7 : 4) / view.scale}
                  className="site-endpoint" vectorEffect="non-scaling-stroke" />)}
              </g>}
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
                    {preview?.transitions.map(({ before, after }) => <polygon key={before.id} points={strip(before.end, after.start)}
                      className="site-strip bridge" vectorEffect="non-scaling-stroke" />)}
                    <line x1={draft.start.x} y1={draft.start.z} x2={draft.end.x} y2={draft.end.z}
                      className={draft.kind === 'outline' ? 'site-guide selected' : 'site-section-draft'} vectorEffect="non-scaling-stroke" />
                  </>}
              </g>}
              {/* All annotations are rendered last: labels never disappear under a
                  later, larger rectangle. The tier is pointer-transparent. */}
              <g className="site-annotations" pointerEvents="none">
                {sortedBlocks.flatMap(block => (dimensionByBlock.get(block.id) ?? []).map(dimension =>
                  <PlanDimensionLine key={dimension.key} dimension={dimension} scale={view.scale} />))}
                {annotations.sectionLabels.map(label =>
                  <PlanSectionAnnotation key={label.id} label={label} selected={selected === label.id} scale={view.scale} />)}
                {blockLabels.map(label => <text key={label.id} className={label.isSelected ? 'site-block-label is-selected' : 'site-block-label'}
                  data-block-label={label.id} x={label.x + 9 / view.scale} y={label.z + 16 / view.scale}
                  fontSize={12 / view.scale} pointerEvents="none">{label.text}</text>)}
                {houseOutline.slice(1).map((end, index) => <OutlineDimension key={index}
                  start={houseOutline[index]} end={end} active={false} scale={view.scale} />)}
                {activeOutline && distance(activeOutline.start, activeOutline.end) >= 0.001 && <OutlineDimension
                  start={activeOutline.start} end={activeOutline.end} active scale={view.scale} />}
              </g>
            </g>
          </svg>
          <div className="site-canvas-status"><strong>{blockLabel(surfaceId)} · {formatMetres(surface)} m</strong>
            {outlineMode && (houseOutline.length > 0 || activeOutline) ? <span data-outline-readout="">
              {activeOutline ? `当前边 ${formatMetres(roundSite(distance(activeOutline.start, activeOutline.end)))} m`
                : `已画 ${formatMetres(roundSite(drawnOutlineLength))} m`}
            </span> : <span>周长 {formatMetres(layout.perimeter)} m</span>}
            <span className="status-hint">{outlineMode && houseOutline.length ? `轮廓 ${houseOutline.length} 点 · 点起点闭合` : pick ? '点选一个顶面；点空白选择地面' : pan ? '拖动画布' : moveTool ? '空白处画矩形 · 拖体块或边框移动'
              : tool === 'scaffold' && surfaceId === GROUND ? preview?.errors[0]?.message
                ?? (preview && preview.spans.length > 1 ? `沿途识别 ${preview.spans.length} 段 · 松手后测算`
                  : draft && 'edge' in draft && draft.edge ? '已贴墙 · 外排在离墙一侧' : '沿墙拖一笔 · 自动识别沿途落脚面')
                : '拖动画线 · 双指平移缩放'}</span></div>
        </>}
      </div>
      <aside className={`site-details${panelOpen ? ' open' : ''}`} aria-label="对象与测算">
        <button className="site-panel-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>对象与测算 <span>{panelOpen ? '收起' : selectedLabel || '展开'}</span></button>
        {panelOpen && <div className="site-details-content">
          <Field label="选择对象">
            <Select aria-label="选择对象" value={selected ?? ''} onChange={e => select(e.currentTarget.value || undefined)} options={objectOptions} />
          </Field>
          {!selected && <EmptyState title="未选择对象" description="点选一个体块或架段，也可以直接从上方列表选择。选中体块后可在其顶面继续绘制。" />}
          {selectedBlock && <section key={selectedBlock.id} className="site-object">
            <div className="ui-row"><strong>体块 {selectedBlock.id}</strong><Badge>{formatMetres(layout.blocks.find(b => b.id === selected)?.top)} m</Badge></div>
            <EditorNumber label="长度 (m)" value={selectedBlock.width} onCommit={width => updateBlock(selectedBlock.id, { width })} />
            <EditorNumber label="宽度 (m)" value={selectedBlock.depth} onCommit={depth => updateBlock(selectedBlock.id, { depth })} />
            <EditorNumber label="高度 (m)" value={selectedBlock.height} onCommit={height => updateBlock(selectedBlock.id, { height })} />
            <details><summary>移动体块</summary>
              <EditorNumber label="平面 X (m)" value={selectedBlock.x} min={-1000} onCommit={x => updateBlock(selectedBlock.id, { x })} />
              <EditorNumber label="平面 Z (m)" value={selectedBlock.z} min={-1000} onCommit={z => updateBlock(selectedBlock.id, { z })} />
            </details>
            <p>底面 {formatMetres(layout.blocks.find(b => b.id === selected)?.base)} m · 顶面 {formatMetres(surfaceElevation(layout.blocks, selectedBlock.id))} m</p>
            <Button size="sm" variant="ghost" onClick={() => chooseSurface(selectedBlock.id)}>在此顶面绘制</Button>
          </section>}
          {selectedSection && <section key={selectedSection.id} className="site-object">
            <div className="ui-row"><strong>第 {site.sections.indexOf(selectedSection) + 1} 段</strong><Badge>{formatMetres(siteLength(selectedSection))} m</Badge></div>
            <Field label="架段落脚面">
              <Select aria-label="架段落脚面" value={selectedSection.automatic ? 'automatic' : selectedSection.surfaceId} onChange={e => {
                const automatic = e.currentTarget.value === 'automatic'
                const next = automatic ? GROUND : e.currentTarget.value
                const base = surfaceElevation(layout.blocks, next) ?? 0
                const target = sectionTargetLayer(selectedSection, parameters, layout.blocks)
                let layers = selectedSection.layers
                if (automatic) layers = selectedFollowsGlobal ? parameters.layerCount : target
                else if (selectedSection.automatic || selectedFollowsGlobal) layers = defaultSectionLayers(base, parameters.liftHeight, target).layers
                updateSection(selectedSection.id, { surfaceId: next, automatic: automatic ? true : undefined,
                  followGlobal: automatic ? selectedFollowsGlobal : selectedFollowsGlobal ? true : undefined, layers }); chooseSurface(next)
              }} options={sectionSelectionOptions} />
            </Field>
            <EditorNumber label="段长 (m)" min={MIN_SECTION_LENGTH} value={siteLength(selectedSection)} onCommit={n => updateSection(selectedSection.id, { end: pointAlong(selectedSection.start, selectedSection.end, n) })} />
            <label><input type="checkbox" checked={selectedFollowsGlobal} onChange={event => updateSection(selectedSection.id, {
              followGlobal: selectedSection.automatic ? event.currentTarget.checked : event.currentTarget.checked ? true : undefined,
              layers: selectedLayerCount,
            })} /> 跟随全局目标层数</label>
            <EditorNumber label={selectedSection.automatic ? '本面目标层数' : '作业层数'} value={selectedLayerCount}
              min={1} max={20} integer onCommit={layers => updateSection(selectedSection.id, {
                layers, followGlobal: selectedSection.automatic ? false : undefined,
              })} />
            {selectedSection.automatic && <p>{selectedFollowsGlobal ? '跟随全局目标' : '本面独立目标'} · 第 {selectedLayerCount} 层</p>}
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
            {selectedSpans.some(span => span.wall) ? <p>内排中心距墙 {formatMetres(wallStandOff(parameters))} m，外排位于离墙一侧。</p>
              : <Button size="sm" variant="ghost" onClick={() => commit(reverseSectionGroup(site, selectedSection.id))}>连通架段反向布置</Button>}
          </section>}
          {selectedGuide && <p>旧图辅助线，可删除选中对象移除。</p>}
          {selected && <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} onClick={deleteSelected}>删除选中对象</Button>}
          {notice && <p className="site-notice" role="status">{notice}</p>}
          {layout.issues.length > 0 && <div className="site-issues">
            <strong>需要检查的位置</strong>
            {layout.issues.map((issue, i) => <button key={issue.code + i} className={issue.blocking ? 'blocking' : ''}
              onClick={() => locate(issue.sectionIds[0] ?? issue.blockId ?? '')}>{issue.message} <span>定位</span></button>)}
          </div>}
          <details className="site-demos"><summary>验收 Demo</summary>
            <Select aria-label="验收 Demo" value={demoId} onChange={e => setDemoId(e.currentTarget.value)}
              options={[{ value: '', label: '选择固定测试图纸' }, ...SITE_DEMOS.map(demo => ({ value: demo.id, label: demo.title }))]} />
            <p>{SITE_DEMOS.find(demo => demo.id === demoId)?.check}</p>
            <Button size="sm" variant="ghost" disabled={!demoId} onClick={showDemo}>载入 Demo</Button>
          </details>
          <Button size="sm" variant="ghost" onClick={() => { if (window.confirm('恢复默认示例将替换当前画布，继续？')) onReset() }}>恢复默认示例</Button>
        </div>}
      </aside>
    </div>
  </div>
}
