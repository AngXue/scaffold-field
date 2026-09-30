import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Focus, Magnet, Maximize2, Minimize2, MousePointer2, Plus, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import type { Point2D } from '../domain/scaffold'
import { GRID_SIZE, measurePath, PIXELS_PER_METER, resizePathSegment } from '../domain/plan'
import { useCssFullscreen } from '../platform/fullscreen'

type PlanEditorProps = {
  points: Point2D[]
  lengths: number[]
  onPointsChange: (points: Point2D[]) => void
  onLengthsChange: (lengths: number[]) => void
}

const ALIGN_THRESHOLD = 12
const MIN_ZOOM = 0.15
const MAX_ZOOM = 6
/** Padding (in model px) left around the content by "fit to content". */
const FIT_PADDING = PIXELS_PER_METER * 1.5

/**
 * View transform only. Model coordinates stay in plan pixels at
 * `PIXELS_PER_METER` (the domain invariant), so the measured lengths and the
 * resize helper are completely unaffected by panning or zooming.
 */
type ViewTransform = { x: number; y: number; k: number }

const clampZoom = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

export function PlanEditor({ points, lengths, onPointsChange, onLengthsChange }: PlanEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 900, height: 560 })
  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, k: 1 })
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [selectedSegment, setSelectedSegment] = useState(0)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapGuide, setSnapGuide] = useState<{ x?: number; y?: number }>({})

  // Gesture bookkeeping kept in refs so pointer moves never read stale state.
  const modeRef = useRef<'idle' | 'node' | 'pan' | 'pinch'>('idle')
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const panRef = useRef<{ pointer: { x: number; y: number }; view: ViewTransform } | null>(null)
  const pinchRef = useRef<{ distance: number; view: ViewTransform; midpoint: { x: number; y: number } } | null>(null)
  const didFitRef = useRef(false)

  const { isFullscreen, toggleFullscreen } = useCssFullscreen()

  // Track the real element size so the SVG viewBox can match CSS pixels 1:1.
  useEffect(() => {
    const element = svgRef.current
    if (!element) return undefined
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fitToContent = useCallback(() => {
    if (points.length === 0) return
    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const contentWidth = Math.max(1, maxX - minX + FIT_PADDING * 2)
    const contentHeight = Math.max(1, maxY - minY + FIT_PADDING * 2)
    const k = clampZoom(Math.min(size.width / contentWidth, size.height / contentHeight))
    setView({
      k,
      x: size.width / 2 - ((minX + maxX) / 2) * k,
      y: size.height / 2 - ((minY + maxY) / 2) * k,
    })
  }, [points, size])

  // Fit once, as soon as a real element size is known.
  useEffect(() => {
    if (didFitRef.current || size.width <= 1) return
    didFitRef.current = true
    fitToContent()
  }, [fitToContent, size.width])

  /** Screen (client) coordinates -> model coordinates. */
  const toModel = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: (clientX - rect.left - view.x) / view.k, y: (clientY - rect.top - view.y) / view.k }
  }

  const zoomAround = useCallback((factor: number, anchorX: number, anchorY: number) => {
    setView((current) => {
      const k = clampZoom(current.k * factor)
      const ratio = k / current.k
      return { k, x: anchorX - (anchorX - current.x) * ratio, y: anchorY - (anchorY - current.y) * ratio }
    })
  }, [])

  const zoomFromCentre = (factor: number) => zoomAround(factor, size.width / 2, size.height / 2)

  // React attaches wheel passively, so preventDefault needs a manual listener.
  useEffect(() => {
    const element = svgRef.current
    if (!element) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoomAround(Math.exp(-event.deltaY * 0.0015), event.clientX - rect.left, event.clientY - rect.top)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomAround])

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (modeRef.current === 'node') return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      pinchRef.current = {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        view,
        midpoint: { x: (a.x + b.x) / 2 - (svgRef.current?.getBoundingClientRect().left ?? 0), y: (a.y + b.y) / 2 - (svgRef.current?.getBoundingClientRect().top ?? 0) },
      }
      panRef.current = null
      modeRef.current = 'pinch'
      return
    }

    panRef.current = { pointer: { x: event.clientX, y: event.clientY }, view }
    modeRef.current = 'pan'
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    // Two fingers: pinch zoom around the finger midpoint.
    if (modeRef.current === 'pinch' && pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const start = pinchRef.current
      const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
      const k = clampZoom(start.view.k * (distance / start.distance))
      const ratio = k / start.view.k
      setView({
        k,
        x: start.midpoint.x - (start.midpoint.x - start.view.x) * ratio,
        y: start.midpoint.y - (start.midpoint.y - start.view.y) * ratio,
      })
      return
    }

    // One finger on empty canvas: pan.
    if (modeRef.current === 'pan' && panRef.current) {
      const start = panRef.current
      setView({
        k: start.view.k,
        x: start.view.x + (event.clientX - start.pointer.x),
        y: start.view.y + (event.clientY - start.pointer.y),
      })
      return
    }

    if (!draggingId) return

    const raw = toModel(event.clientX, event.clientY)
    let next = raw
    const guide: { x?: number; y?: number } = {}

    if (snapEnabled) {
      next = {
        x: Math.round(raw.x / GRID_SIZE) * GRID_SIZE,
        y: Math.round(raw.y / GRID_SIZE) * GRID_SIZE,
      }
      for (const point of points) {
        if (point.id === draggingId) continue
        if (Math.abs(raw.x - point.x) <= ALIGN_THRESHOLD) {
          next.x = point.x
          guide.x = point.x
        }
        if (Math.abs(raw.y - point.y) <= ALIGN_THRESHOLD) {
          next.y = point.y
          guide.y = point.y
        }
      }
    }

    setSnapGuide(guide)
    // No clamping: the canvas is unbounded, so nodes can be placed anywhere.
    const nextPoints = points.map((point) => point.id === draggingId ? { ...point, x: next.x, y: next.y } : point)
    onPointsChange(nextPoints)
    onLengthsChange(measurePath(nextPoints))
  }

  const stopInteraction = (event?: ReactPointerEvent<SVGSVGElement>) => {
    if (event) pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    if (pointersRef.current.size === 0) {
      panRef.current = null
      modeRef.current = 'idle'
    }
    setDraggingId(null)
    setSnapGuide({})
  }

  const addSegment = () => {
    const last = points.at(-1) ?? { x: 120, y: 160 }
    const length = 4.2
    const direction = points.length % 2 === 0
      ? { x: 0, y: length * PIXELS_PER_METER }
      : { x: length * PIXELS_PER_METER, y: 0 }
    onPointsChange([...points, {
      id: `P${points.length + 1}`,
      x: last.x + direction.x,
      y: last.y + direction.y,
    }])
    onLengthsChange([...lengths, length])
    setSelectedSegment(lengths.length)
  }

  const reset = () => {
    onPointsChange([
      { id: 'P1', x: 110, y: 125 },
      { id: 'P2', x: 110 + 7.2 * PIXELS_PER_METER, y: 125 },
      { id: 'P3', x: 110 + 7.2 * PIXELS_PER_METER, y: 125 + 4.8 * PIXELS_PER_METER },
    ])
    onLengthsChange([7.2, 4.8])
    setSelectedSegment(0)
  }

  // Model-space rectangle currently on screen: drives the infinite grid and the
  // full-bleed snap guides, and keeps their coordinates small at any zoom.
  const visible = {
    x: -view.x / view.k,
    y: -view.y / view.k,
    width: size.width / view.k,
    height: size.height / view.k,
  }

  return (
    <div className={isFullscreen ? 'plan-editor is-fullscreen' : 'plan-editor'} ref={editorRef}>
      <div className="canvas-toolbar">
        <div className="tool-status"><MousePointer2 size={16} /> 拖动节点 · {snapEnabled ? '吸附已开启' : '自由移动'}</div>
        <div className="toolbar-actions">
          <span className="zoom-readout">{Math.round(view.k * 100)}%</span>
          <button className="icon-button" type="button" onClick={() => zoomFromCentre(1 / 1.25)} title="缩小"><ZoomOut size={18} /></button>
          <button className="icon-button" type="button" onClick={() => zoomFromCentre(1.25)} title="放大"><ZoomIn size={18} /></button>
          <button className="icon-button" type="button" onClick={fitToContent} title="适应内容"><Focus size={18} /></button>
          <button className="icon-button" type="button" onClick={reset} title="重置示例路径"><RotateCcw size={18} /></button>
          <button className={snapEnabled ? 'icon-button active' : 'icon-button'} type="button" onClick={() => setSnapEnabled(!snapEnabled)} title="网格与同轴吸附"><Magnet size={18} /></button>
          <button className="icon-button" type="button" onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏画布'}>
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="compact-button" type="button" onClick={addSegment}><Plus size={17} /> 添加路径段</button>
        </div>
      </div>

      <div className="plan-canvas-wrap">
        <svg
          ref={svgRef}
          className="plan-canvas"
          viewBox={`0 0 ${size.width} ${size.height}`}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopInteraction}
          onPointerCancel={stopInteraction}
          onPointerLeave={stopInteraction}
        >
          <defs>
            {/* Pattern tiles live in model space so the 0.5 m grid keeps its real
                spacing at any zoom; the strokes themselves are non-scaling so the
                grid stays legible when zoomed far in or out. */}
            <pattern id="minor-grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
              <path className="grid-minor" d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`} fill="none" />
            </pattern>
            <pattern id="major-grid" width={GRID_SIZE * 4} height={GRID_SIZE * 4} patternUnits="userSpaceOnUse">
              <rect width={GRID_SIZE * 4} height={GRID_SIZE * 4} fill="url(#minor-grid)" />
              <path className="grid-major" d={`M ${GRID_SIZE * 4} 0 L 0 0 0 ${GRID_SIZE * 4}`} fill="none" />
            </pattern>
          </defs>

          {/* Everything below shares the pan/zoom transform. */}
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            <rect x={visible.x} y={visible.y} width={visible.width} height={visible.height} fill="url(#major-grid)" />
            {snapGuide.x !== undefined && (
              <line x1={snapGuide.x} y1={visible.y} x2={snapGuide.x} y2={visible.y + visible.height} className="snap-guide" />
            )}
            {snapGuide.y !== undefined && (
              <line x1={visible.x} y1={snapGuide.y} x2={visible.x + visible.width} y2={snapGuide.y} className="snap-guide" />
            )}
            {points.slice(0, -1).map((point, index) => {
              const next = points[index + 1]
              const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }
              const selected = selectedSegment === index
              return (
                <g key={`${point.id}-${next.id}`} onClick={() => setSelectedSegment(index)} className="plan-segment">
                  <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} className="segment-hit" />
                  {/* Selection is a halo behind the line, not extra weight: a
                      thicker selected segment reads as a different element. */}
                  {selected ? (
                    <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} className="segment-halo" />
                  ) : null}
                  <line x1={point.x} y1={point.y} x2={next.x} y2={next.y} className="segment-line" />
                  <g transform={`translate(${midpoint.x}, ${midpoint.y}) scale(${1 / view.k})`}>
                    <rect x="-38" y="-17" width="76" height="34" rx="4" className="length-label-bg" />
                    <text textAnchor="middle" dominantBaseline="middle" className="length-label">{(lengths[index] ?? 0).toFixed(2)} m</text>
                  </g>
                </g>
              )
            })}
            {points.map((point) => (
              <g
                key={point.id}
                transform={`translate(${point.x}, ${point.y}) scale(${1 / view.k})`}
                className="plan-node"
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.currentTarget.setPointerCapture(event.pointerId)
                  modeRef.current = 'node'
                  setDraggingId(point.id)
                }}
              >
                <circle r="14" className="node-hit" />
                <circle r="6" className="node-dot" />
                <rect x="-17" y="-38" width="34" height="20" rx="3" className="node-label-bg" />
                <text y="-24" textAnchor="middle" className="node-label">{point.id}</text>
              </g>
            ))}
          </g>

          {/* Scale bar lives in screen space so it always reports the true 1 m
              on-screen length at the current zoom. */}
          <g transform={`translate(${size.width - 34 - PIXELS_PER_METER * view.k}, ${size.height - 26})`} className="scale-indicator-svg">
            <path d={`M 0 -8 V 0 H ${PIXELS_PER_METER * view.k} V -8`} />
            <text x={(PIXELS_PER_METER * view.k) / 2} y="15" textAnchor="middle">1 m</text>
          </g>
        </svg>
      </div>

      <div className="segment-strip">
        <div>
          <span className="field-caption">当前路径段</span>
          <strong>{points[selectedSegment]?.id} → {points[selectedSegment + 1]?.id}</strong>
        </div>
        <label className="inline-field">
          <span>实际测量长度</span>
          <span className="number-input">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={lengths[selectedSegment] ?? 0}
              onChange={(event) => {
                const value = Math.max(0.1, Number(event.target.value))
                const nextPoints = resizePathSegment(points, selectedSegment, value)
                onPointsChange(nextPoints)
                onLengthsChange(measurePath(nextPoints))
              }}
            />
            <b>m</b>
          </span>
        </label>
        <span className="authority-note">画布与测量值同步 · 滚轮/双指缩放，拖拽空白平移</span>
      </div>
    </div>
  )
}
