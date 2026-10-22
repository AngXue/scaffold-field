import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Focus, Hand, Magnet, Maximize2, Minimize2, MousePointer2, Pencil, Redo2, RotateCcw, Trash2, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { NumberField } from './NumberField'
import { placeDrawingLabels, PLAN_LABEL_HEIGHT, PLAN_LABEL_WIDTH } from './planLabels'
import { addPlanSegment, deletePlanSegment, EMPTY_DRAWING, GRID_SIZE, measureDrawing, movePlanNode, orthogonalEnd,
  PIXELS_PER_METER, resizeDrawingSegment, snapPlanPoint, type PlanDrawing } from '../domain/plan'
import { useCssFullscreen } from '../platform/fullscreen'

type Position = { x: number; y: number }
type View = Position & { k: number }
type Gesture = { kind: 'draw' | 'node' | 'pan'; screen: Position; start: Position; end: Position; view: View; node?: string; edge?: string }
type Props = { drawing: PlanDrawing; perimeter: number; onChange: (drawing: PlanDrawing) => void; onResetDemo: () => void }
const clampZoom = (k: number) => Math.max(0.15, Math.min(10, k))

export function PlanEditor({ drawing, perimeter, onChange, onResetDemo }: Props) {
  const editorRef = useRef<HTMLDivElement>(null), svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 2.4 })
  const [tool, setTool] = useState<'draw' | 'edit' | 'pan'>('draw')
  const [cardAnchor, setCardAnchor] = useState<Position>({ x: 12, y: 80 })
  const [snap, setSnap] = useState(true), [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ start: Position; end: Position } | null>(null)
  const [moving, setMoving] = useState<{ id: string; point: Position } | null>(null)
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 })
  const undo = useRef<PlanDrawing[]>([]), redo = useRef<PlanDrawing[]>([])
  const lastLocal = useRef(drawing), drawingRef = useRef(drawing), viewRef = useRef(view)
  const pointers = useRef(new Map<number, Position>()), gesture = useRef<Gesture | null>(null)
  const pending = useRef<Position | null>(null)
  const pinch = useRef<{ midpoint: Position; distance: number; view: View } | null>(null)
  const didFit = useRef(false)
  const { isFullscreen, toggleFullscreen } = useCssFullscreen()
  useEffect(() => { drawingRef.current = drawing }, [drawing])
  useEffect(() => { viewRef.current = view }, [view])
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const { width, height } = el.getBoundingClientRect()
      if (width && height) setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fit = useCallback(() => {
    const points = drawingRef.current.points
    if (!points.length) { setView({ x: size.width / 2, y: size.height / 2, k: 2.4 }); return }
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
    const k = clampZoom(Math.min((size.width - 160) / Math.max(150, maxX - minX), (size.height - 210) / Math.max(150, maxY - minY)))
    setView({ k, x: size.width / 2 - (minX + maxX) / 2 * k, y: size.height / 2 - (minY + maxY) / 2 * k + 12 })
  }, [size])
  useEffect(() => {
    if (didFit.current || size.width <= 0) return
    didFit.current = true
    fit()
  }, [fit, size.width])

  const zoom = useCallback((factor: number, anchor: Position) => {
    setView(current => {
      const k = clampZoom(current.k * factor), ratio = k / current.k
      return { k, x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio }
    })
  }, [])
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoom(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top })
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [zoom])

  const commit = (next: PlanDrawing) => {
    if (JSON.stringify(next) === JSON.stringify(drawingRef.current)) return
    if (lastLocal.current !== drawingRef.current) undo.current = []
    undo.current = [...undo.current, drawingRef.current].slice(-100)
    redo.current = []
    lastLocal.current = next
    drawingRef.current = next
    onChange(next)
    setHistorySize({ undo: undo.current.length, redo: 0 })
  }
  const travel = (direction: 'undo' | 'redo') => {
    const from = direction === 'undo' ? undo : redo, to = direction === 'undo' ? redo : undo
    if (lastLocal.current !== drawingRef.current) { undo.current = []; redo.current = []; setHistorySize({ undo: 0, redo: 0 }); return }
    const next = from.current.pop()
    if (!next) return
    to.current.push(drawingRef.current)
    lastLocal.current = next; drawingRef.current = next; onChange(next)
    setSelected(null); pending.current = null; setDraft(null)
    setHistorySize({ undo: undo.current.length, redo: redo.current.length })
  }
  const screenPoint = (e: ReactPointerEvent): Position => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const modelPoint = (p: Position): Position => ({ x: (p.x - viewRef.current.x) / viewRef.current.k, y: (p.y - viewRef.current.y) / viewRef.current.k })
  const snapped = (p: Position): Position => {
    if (!snap) return { x: Number(p.x.toFixed(2)), y: Number(p.y.toFixed(2)) }
    const nearby = drawingRef.current.points.filter(q => Math.hypot(q.x - p.x, q.y - p.y) * viewRef.current.k <= 12)
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]
    return nearby ?? snapPlanPoint(p)
  }
  const selectSegment = (id: string) => {
    const edge = drawingRef.current.segments.find(s => s.id === id)
    if (!edge) return
    const a = drawingRef.current.points.find(p => p.id === edge.start)!, b = drawingRef.current.points.find(p => p.id === edge.end)!
    const v = viewRef.current, x = (a.x + b.x) / 2 * v.k + v.x, y = (a.y + b.y) / 2 * v.k + v.y
    let anchor = Math.abs(a.y - b.y) < 0.01 ? { x: x - 144, y: y + 35 } : { x: x + 35, y: y - 42 }
    if (anchor.y + 108 > size.height - 48) anchor.y = y - 140
    if (anchor.x + 288 > size.width - 12) anchor = { ...anchor, x: x - 323 }
    setCardAnchor(anchor); setSelected(id)
  }
  const begin = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault()
    const screen = screenPoint(e)
    pointers.current.set(e.pointerId, screen)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(b.x - a.x, b.y - a.y), view: viewRef.current }
      gesture.current = null; pending.current = null; setDraft(null); setMoving(null)
      return
    }
    const element = e.target as Element
    const node = element.closest('[data-node]')?.getAttribute('data-node') ?? undefined
    const edge = element.closest('[data-segment]')?.getAttribute('data-segment') ?? undefined
    const start = pending.current ?? snapped(modelPoint(screen))
    const kind = tool === 'pan' || e.button === 1 ? 'pan' : tool === 'edit' ? node ? 'node' : 'pan' : 'draw'
    gesture.current = { kind, screen, start, end: pending.current ? orthogonalEnd(start, snapped(modelPoint(screen)), snap) : start, view: viewRef.current, node, edge }
    if (edge) selectSegment(edge)
    else if (kind === 'draw') setSelected(null)
  }
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const screen = screenPoint(e)
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, screen)
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()], initial = pinch.current
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const k = clampZoom(initial.view.k * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, initial.distance))
      const ratio = k / initial.view.k
      setView({ k, x: mid.x - (initial.midpoint.x - initial.view.x) * ratio, y: mid.y - (initial.midpoint.y - initial.view.y) * ratio })
      return
    }
    const g = gesture.current
    if (!g) {
      if (pending.current) setDraft({ start: pending.current, end: orthogonalEnd(pending.current, snapped(modelPoint(screen)), snap) })
      return
    }
    if (g.kind === 'pan') setView({ ...g.view, x: g.view.x + screen.x - g.screen.x, y: g.view.y + screen.y - g.screen.y })
    else if (g.kind === 'node') {
      g.end = snapped(modelPoint(screen)); setMoving({ id: g.node!, point: g.end })
    } else {
      g.end = orthogonalEnd(g.start, snapped(modelPoint(screen)), snap)
      setDraft({ start: g.start, end: g.end })
    }
  }
  const finish = (e: ReactPointerEvent<SVGSVGElement>, cancel = false) => {
    pointers.current.delete(e.pointerId)
    if (pinch.current) { if (!pointers.current.size) pinch.current = null; gesture.current = null; return }
    const g = gesture.current
    gesture.current = null
    if (cancel || !g) { setDraft(null); setMoving(null); pending.current = null; return }
    if (g.kind === 'draw') g.end = orthogonalEnd(g.start, snapped(modelPoint(screenPoint(e))), snap)
    if (g.kind === 'node') g.end = snapped(modelPoint(screenPoint(e)))
    const distance = Math.hypot(g.end.x - g.start.x, g.end.y - g.start.y) * viewRef.current.k
    if (g.kind === 'node') { commit(movePlanNode(drawingRef.current, g.node!, g.end)); setMoving(null) }
    if (g.kind !== 'draw') return
    // A tap selects an existing edge; a drag or a second blank tap draws a line.
    if (distance > 5) {
      commit(addPlanSegment(drawingRef.current, g.start, g.end))
      pending.current = null; setDraft(null)
    } else if (g.edge) { pending.current = null; setDraft(null); selectSegment(g.edge) }
    else { pending.current = g.start; setDraft({ start: g.start, end: g.start }) }
  }
  const shown = useMemo(() => moving ? movePlanNode(drawing, moving.id, moving.point) : drawing, [drawing, moving])
  const lengths = useMemo(() => measureDrawing(shown), [shown])
  const nodes = new Map(shown.points.map(p => [p.id, p]))
  const labels = useMemo(() => placeDrawingLabels(shown, view.k, {
    x: -view.x + 12, y: -view.y + 76, width: size.width - 24, height: size.height - 128,
  }), [shown, view, size])
  const selectedIndex = shown.segments.findIndex(s => s.id === selected)
  const selectedEdge = shown.segments[selectedIndex]
  // Keep controls under the finger while a length is edited; only re-anchor on selection.
  const card = { x: Math.max(12, Math.min(size.width - 300, cardAnchor.x)),
    y: Math.max(76, Math.min(size.height - 158, cardAnchor.y)) }
  const selectTool = (next: typeof tool) => { setTool(next); pending.current = null; setDraft(null) }
  const zoomCenter = (factor: number) => zoom(factor, { x: size.width / 2, y: size.height / 2 })
  return (
    <div className={`plan-editor${isFullscreen ? ' is-fullscreen' : ''}`} ref={editorRef}>
      <div className="plan-canvas-wrap">
        <svg ref={svgRef} className={`plan-canvas tool-${tool}`} aria-label="二维绘图画布" viewBox={`0 0 ${size.width || 800} ${size.height || 600}`}
          onPointerDown={begin} onPointerMove={move} onPointerUp={finish} onPointerCancel={e => finish(e, true)}>
          <defs>
            <pattern id="plan-grid-minor" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
              <path d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" className="plan-grid-minor" vectorEffect="non-scaling-stroke" />
            </pattern>
            <pattern id="plan-grid-major" width={PIXELS_PER_METER} height={PIXELS_PER_METER} patternUnits="userSpaceOnUse">
              <path d={`M ${PIXELS_PER_METER} 0 L 0 0 0 ${PIXELS_PER_METER}`} fill="none" className="plan-grid-major" vectorEffect="non-scaling-stroke" />
            </pattern>
          </defs>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <rect x={-view.x / view.k} y={-view.y / view.k} width={size.width / view.k} height={size.height / view.k} fill="var(--canvas)" />
            {GRID_SIZE * view.k >= 5 && <rect x={-view.x / view.k} y={-view.y / view.k} width={size.width / view.k} height={size.height / view.k} fill="url(#plan-grid-minor)" />}
            <rect x={-view.x / view.k} y={-view.y / view.k} width={size.width / view.k} height={size.height / view.k} fill="url(#plan-grid-major)" />
            {shown.segments.map((s, index) => {
              const a = nodes.get(s.start)!, b = nodes.get(s.end)!, label = labels[index]
              return <g key={s.id} data-segment={s.id}>
                {s.id === selected && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="segment-halo" vectorEffect="non-scaling-stroke" />}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="drawing-segment" vectorEffect="non-scaling-stroke" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="segment-hit" vectorEffect="non-scaling-stroke" />
                {label && <g transform={`translate(${label.x} ${label.y}) scale(${1 / view.k})`} className="drawing-label">
                  <rect x={-PLAN_LABEL_WIDTH / 2} y={-PLAN_LABEL_HEIGHT / 2} width={PLAN_LABEL_WIDTH} height={PLAN_LABEL_HEIGHT} rx={5} />
                  <text textAnchor="middle" dominantBaseline="central">#{index + 1} · {lengths[index].toFixed(2)} m</text>
                </g>}
              </g>
            })}
            {shown.points.map(p => <circle key={p.id} data-node={p.id} cx={p.x} cy={p.y} r={5 / view.k} className="drawing-node" strokeWidth={1.5 / view.k} />)}
            {draft && <g pointerEvents="none">
              <line x1={draft.start.x} y1={draft.start.y} x2={draft.end.x} y2={draft.end.y} className="drawing-preview" vectorEffect="non-scaling-stroke" />
              <circle cx={draft.start.x} cy={draft.start.y} r={6 / view.k} className="drawing-node" strokeWidth={1.5 / view.k} />
              <circle cx={draft.end.x} cy={draft.end.y} r={6 / view.k} className="drawing-node" strokeWidth={1.5 / view.k} />
              <text x={(draft.start.x + draft.end.x) / 2} y={(draft.start.y + draft.end.y) / 2 - 16 / view.k} textAnchor="middle" className="preview-length" fontSize={13 / view.k}>{(Math.hypot(draft.end.x - draft.start.x, draft.end.y - draft.start.y) / PIXELS_PER_METER).toFixed(2)} m</text>
            </g>}
          </g>
        </svg>
        <div className="drawing-toolbar" role="toolbar" aria-label="绘图工具">
          <div className="drawing-tool-group">
            <button className={`icon-button${tool === 'draw' ? ' active' : ''}`} title="画线" aria-pressed={tool === 'draw'} onClick={() => selectTool('draw')}><Pencil size={18} /></button>
            <button className={`icon-button${tool === 'edit' ? ' active' : ''}`} title="选择与移动端点" aria-pressed={tool === 'edit'} onClick={() => selectTool('edit')}><MousePointer2 size={18} /></button>
            <button className={`icon-button${tool === 'pan' ? ' active' : ''}`} title="平移画布" aria-pressed={tool === 'pan'} onClick={() => selectTool('pan')}><Hand size={18} /></button>
            <button className={`icon-button${snap ? ' active' : ''}`} title="网格吸附" aria-pressed={snap} onClick={() => setSnap(!snap)}><Magnet size={18} /></button>
          </div>
          <div className="drawing-tool-group">
            <button className="icon-button" title="撤销" disabled={!historySize.undo} onClick={() => travel('undo')}><Undo2 size={18} /></button>
            <button className="icon-button" title="重做" disabled={!historySize.redo} onClick={() => travel('redo')}><Redo2 size={18} /></button>
            <button className="icon-button" title="清空图纸" disabled={!drawing.segments.length} onClick={() => { commit(EMPTY_DRAWING); setSelected(null); pending.current = null; setDraft(null) }}><Trash2 size={18} /></button>
          </div>
          <button className="icon-button" title={isFullscreen ? '退出全屏' : '全屏绘图'} onClick={() => { void toggleFullscreen() }}>{isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
        </div>
        <div className="drawing-view-tools">
          <button className="icon-button" title="放大" onClick={() => zoomCenter(1.25)}><ZoomIn size={18} /></button>
          <button className="icon-button" title="缩小" onClick={() => zoomCenter(0.8)}><ZoomOut size={18} /></button>
          <button className="icon-button" title="适应图纸" onClick={fit}><Focus size={18} /></button>
          <button className="icon-button" title="恢复默认图纸" onClick={() => { onResetDemo(); setSelected(null); pending.current = null; setDraft(null) }}><RotateCcw size={18} /></button>
        </div>
        {!drawing.segments.length && !draft && <div className="drawing-empty">拖动画线<span>自动水平 / 垂直 · 双指缩放平移</span></div>}
        {selectedEdge && <div className="segment-popover" style={{ left: card.x, top: card.y }}>
          <header><strong>线段 #{selectedIndex + 1}</strong>
            <button className="icon-button" title="删除选中线段" onClick={() => { commit(deletePlanSegment(drawing, selectedEdge.id)); setSelected(null) }}><Trash2 size={16} /></button>
            <button className="icon-button" title="关闭线段编辑" onClick={() => setSelected(null)}><X size={16} /></button>
          </header>
          <NumberField key={selectedEdge.id} label="长度" className="inline-field" value={lengths[selectedIndex]} step={0.1} min={0.1}
            onChange={length => commit(resizeDrawingSegment(drawingRef.current, selectedEdge.id, length))} />
        </div>}
        <div className="drawing-status"><span>周长 <strong>{perimeter.toFixed(2)} m</strong></span><span>网格 0.1 m</span></div>
        <div className="drawing-scale"><i style={{ width: PIXELS_PER_METER * view.k }} /><span>1 m</span></div>
      </div>
    </div>
  )
}
