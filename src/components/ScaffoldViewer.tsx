import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, Edges, Environment, Grid, Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Box, Eye, Focus, Maximize2, Minimize2, Rotate3D, ScanEye, X } from 'lucide-react'
import type { DeckPanel, MemberType, PipeSegment, ScaffoldLayout } from '../domain/scaffold'
import { BASE_CHANNEL_HEIGHT, BASE_CHANNEL_WIDTH, CONNECTOR_LABELS, SWEEP_BAR_LAYER } from '../domain/scaffold'
import type { ResolvedBlock } from '../domain/site'
import { useCssFullscreen } from '../platform/fullscreen'
import { SceneDimensions } from './SceneDimensions'
import { Couplers } from './Couplers'
import { Badge, Button, IconButton } from './ui'

type ViewerProps = {
  layout: ScaffoldLayout
  blocks?: ResolvedBlock[]
  onSelectSurface?: (id: string) => void
  pipeDiameter?: number
}

type RenderLayer = MemberType | 'deck' | 'connector' | 'channel' | 'house' | 'dimension'

/**
 * True tube radius. The domain models a 48 mm scaffold tube
 * (`pipeDiameter: 0.048` in src/domain/scaffold.ts); the viewer used to draw a
 * 76 mm one, which swallowed the joint clearances the domain already emits.
 */
const TUBE_SEGMENTS = 12
/**
 * Abutting segments are pulled back along their axis so a shared joint shows a
 * seam instead of merging into one continuous blob. ~4 mm total also clears the
 * depth-buffer quantum (≈2.4 mm at 20 m of scene depth) and sits at 8-12 % of
 * the local diameter — below ~4 % it reads as a shading artefact, above ~15 % as
 * a modelling error.
 */
const END_INSET_START = 0.002
const END_INSET_END = 0.0026
const SELECTED_COLOR = '#ffb02e'

/**
 * Selection priority for picking.
 *
 * The 钢笆 surface lies `DECK_SURFACE_OFFSET` above the tubes of its lift, so from
 * almost any angle it is the nearest thing under the pointer. r3f hands an event to
 * the nearest hit first and `stopPropagation()` cuts the rest off, which meant a
 * click aimed at a pipe, coupler or 槽钢 was answered by the deck lying over it.
 * Parts carry `PICK_PART` and always win; the deck only answers a click that hits no
 * part at all. A second cause was that a 48 mm tube is only a couple of pixels on
 * screen, so a visually aimed click often missed the tube itself; the invisible
 * `PipePickProxies` below give every tube a slightly wider, still part-only target.
 */
const PICK_PART = { pick: 'part' } as const

/**
 * These are deliberately brighter than the UI accents: under ACES tone mapping a
 * #2f3c40 post survives as ~20 % grey and reads as dead metal rather than a
 * coloured part.
 */
const MEMBER_COLORS: Record<MemberType, string> = {
  post: '#4e6268',
  longitudinal: '#1f8a95',
  transverse: '#f0862a',
  guardrail: '#c9b03a',
}

const MEMBER_LABELS: Record<MemberType, string> = {
  post: '立杆',
  longitudinal: '纵向水平杆',
  transverse: '横向杆',
  guardrail: '防护栏杆',
}

const LAYER_LABELS: Record<RenderLayer, string> = {
  ...MEMBER_LABELS,
  deck: '钢笆',
  connector: '扣件',
  channel: '槽钢',
  house: '房屋',
  dimension: '尺寸',
}

const LAYER_COLORS: Record<RenderLayer, string> = {
  ...MEMBER_COLORS,
  deck: '#87989a',
  connector: '#8a8f93',
  channel: '#6f7a7d',
  house: '#b5aa98',
  dimension: '#5b6265',
}

const RENDER_LAYERS = Object.keys(LAYER_LABELS) as RenderLayer[]
/** Warm neutrals only; every box gets a drawn edge so a stack never fuses. */
const BLOCK_TONES = ['#d9d2c5', '#d1cabd', '#e0dacd', '#cac3b5', '#ddd6c9']
const BLOCK_EDGE = '#6d6458'

/**
 * FNV-1a. Gives every tube a stable, tiny variation so ~100 identical cylinders
 * stop looking like clones, while staying deterministic across renders (random
 * values would shimmer every frame while orbiting).
 */
function hashUnit(seed: string, salt: number): number {
  let hash = 0x811c9dc5 ^ salt
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return ((hash >>> 0) % 4096) / 4096
}

/**
 * Offline image-based lighting.
 *
 * drei's `<Environment preset="...">` downloads an HDR from a CDN
 * (`raw.githack.com/pmndrs/drei-assets`), which would break the offline APK and
 * hang the Suspense boundary inside the WebView. Building the room in-engine,
 * pre-filtering it with PMREM and handing the texture to `<Environment map>` gives
 * galvanised steel something to reflect without touching the network.
 */
function ScaffoldEnvironment() {
  const gl = useThree((state) => state.gl)

  const environment = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    // sigma 0.02 softens the room's box highlights and is the cheap cure for
    // specular aliasing, which MSAA does not fix.
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.02).texture
    pmrem.dispose()
    return texture
  }, [gl])

  const rotation = useMemo(() => new THREE.Euler(0, 0.6, 0), [])
  useEffect(() => () => environment.dispose(), [environment])

  return <Environment map={environment} environmentIntensity={0.9} environmentRotation={rotation} />
}

function CameraRig({ position, target, maximumDistance }: {
  position: [number, number, number]
  target: [number, number, number]
  maximumDistance: number
}) {
  const { camera, size } = useThree()
  // Perspective narrows the horizontal field on a phone. Pull the camera back
  // with the aspect once, at mount, so the side dimension labels are inside the
  // canvas; a later data edit or layer toggle never re-frames the user's view.
  const [initialView] = useState(() => {
    const aspect = size.width / Math.max(1, size.height)
    const fit = aspect < 1 ? Math.min(1.42, 1.1 / Math.max(0.42, aspect)) : 1
    const targetVector = new THREE.Vector3(...target)
    const fitted = new THREE.Vector3(...position).sub(targetVector).multiplyScalar(fit).add(targetVector)
    return { position: fitted.toArray() as [number, number, number], target }
  })

  useEffect(() => {
    camera.position.set(...initialView.position)
    camera.lookAt(...initialView.target)
    camera.updateProjectionMatrix()
  }, [camera, initialView])

  return <OrbitControls makeDefault target={initialView.target} minDistance={3} maxDistance={maximumDistance} />
}

function Pipe({ segment, selected, onSelect, radius }: {
  segment: PipeSegment
  radius: number
  selected: boolean
  onSelect: () => void
}) {
  const start = new THREE.Vector3(...segment.start)
  const end = new THREE.Vector3(...segment.end)
  const direction = end.clone().sub(start)
  const length = direction.length()
  const axis = direction.clone().normalize()
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)

  // Never inset more than 8 % of a very short segment, or it would vanish.
  const startInset = Math.min(END_INSET_START, length * 0.08)
  const endInset = Math.min(END_INSET_END, length * 0.08)
  const tubeLength = Math.max(0.01, length - startInset - endInset)
  const tubeCenter = start.clone().add(axis.clone().multiplyScalar(startInset + tubeLength / 2))

  // Galvanised posts read as bare steel; longitudinal/transverse members are
  // painted, so they get the physical clearcoat model instead.
  const painted = segment.type !== 'post'
  const albedo = useMemo(
    () => new THREE.Color(MEMBER_COLORS[segment.type]).multiplyScalar(1 + (hashUnit(segment.id, 1) - 0.5) * 0.07),
    [segment.id, segment.type],
  )
  const roughness = (painted ? 0.46 : 0.45) + (hashUnit(segment.id, 2) - 0.5) * 0.1
  const metalness = (painted ? 0.15 : 0.8) + (hashUnit(segment.id, 3) - 0.5) * 0.06

  return (
    <mesh
      position={tubeCenter}
      quaternion={quaternion}
      userData={PICK_PART}
      onClick={(event) => { event.stopPropagation(); onSelect() }}
    >
      {/* Constant geometry across selection states: resizing on select rebuilt
          and re-uploaded the geometry on every click and made the part visibly
          jump. Selection is emissive now, so nothing moves. */}
      <cylinderGeometry args={[radius, radius, tubeLength, TUBE_SEGMENTS]} />
      {painted ? (
        <meshPhysicalMaterial
          color={albedo}
          metalness={metalness}
          roughness={roughness}
          clearcoat={0.25}
          clearcoatRoughness={0.4}
          emissive={selected ? SELECTED_COLOR : '#000000'}
          emissiveIntensity={selected ? 0.5 : 0}
        />
      ) : (
        <meshStandardMaterial
          color={albedo}
          metalness={metalness}
          roughness={roughness}
          emissive={selected ? SELECTED_COLOR : '#000000'}
          emissiveIntensity={selected ? 0.5 : 0}
        />
      )}
    </mesh>
  )
}

/**
 * Invisible, only-slightly-fatter hit targets for the tubes.
 *
 * The visible tube is drawn at its true 24 mm radius, which is 1-2 px at normal
 * viewing distance. A click that lands on the perceived tube edge therefore misses
 * the mesh and travels on to the deck below. One instanced mesh of imperceptible
 * cylinders makes the whole tube easy to hit without changing what is rendered;
 * because the proxy is a `PICK_PART`, the deck still steps aside.
 */
function PipePickProxies({ segments, radius, onSelect }: {
  segments: PipeSegment[]
  radius: number
  onSelect: (id: string) => void
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const geometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 8), [])
  // ~5 cm radius: comfortable on a tablet, still focused enough not to swallow a
  // coupler click a few centimetres away.
  const pickRadius = Math.max(radius * 2.2, 0.05)

  useEffect(() => () => geometry.dispose(), [geometry])
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const up = new THREE.Vector3(0, 1, 0)
    segments.forEach((segment, index) => {
      const start = new THREE.Vector3(...segment.start)
      const end = new THREE.Vector3(...segment.end)
      const direction = end.clone().sub(start)
      const length = Math.max(0.01, direction.length())
      direction.normalize()
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction)
      const middle = start.clone().add(end).multiplyScalar(0.5)
      mesh.setMatrixAt(index, new THREE.Matrix4().compose(middle, quaternion,
        new THREE.Vector3(pickRadius, length, pickRadius)))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [segments, pickRadius])

  if (segments.length === 0) return null
  return <instancedMesh key={segments.length} ref={ref} args={[geometry, undefined, segments.length]}
    userData={PICK_PART} onClick={(event: ThreeEvent<MouseEvent>) => {
      if (event.instanceId === undefined) return
      event.stopPropagation()
      onSelect(segments[event.instanceId].id)
    }}>
    {/* colourWrite false: it is a target, not a rendered part. */}
    <meshBasicMaterial transparent opacity={0} colorWrite={false} depthWrite={false} />
  </instancedMesh>
}

function SteelDeck({ deck, selected, onSelect }: {
  deck: DeckPanel
  selected: boolean
  onSelect: () => void
}) {
  const corners = deck.corners.map(corner => new THREE.Vector3(...corner))
  const faces = (deck.coverage ?? [deck.corners]).map(face => face.map(p => new THREE.Vector3(...p)))
  const surfaceVertices = new Float32Array(faces.flatMap(face =>
    face.slice(1, -1).flatMap((point, index) => [...face[0].toArray(), ...point.toArray(), ...face[index + 2].toArray()])))
  const linePoints: number[] = []
  const line = (a: THREE.Vector3, b: THREE.Vector3) => {
    linePoints.push(a.x, a.y + 0.004, a.z, b.x, b.y + 0.004, b.z)
  }
  for (const face of faces) {
    face.forEach((point, index) => line(point, face[(index + 1) % face.length]))
    // Clip the visual wire pattern to each cut face, using the original panel's
    // axes. It cannot run across a removed corner or cover a neighbouring panel.
    for (const [end, count] of [[corners[1], 4], [corners[3], 8]] as const) {
      const axis = end.clone().sub(corners[0])
      const length = axis.length()
      axis.normalize()
      const project = (p: THREE.Vector3) => p.clone().sub(corners[0]).dot(axis)
      for (let step = 1; step < count; step++) {
        const at = length * step / count
        const hits: THREE.Vector3[] = []
        face.forEach((a, index) => {
          const b = face[(index + 1) % face.length], u = project(a), v = project(b)
          if (Math.abs(u - v) < 1e-8 || at < Math.min(u, v) || at > Math.max(u, v)) return
          hits.push(a.clone().lerp(b, (at - u) / (v - u)))
        })
        if (hits.length >= 2) {
          hits.sort((a, b) => a.x - b.x || a.z - b.z)
          line(hits[0], hits.at(-1)!)
        }
      }
    }
  }

  return (
    <group
      userData={PICK_PART}
      onClick={(event) => {
        // The deck is usually the nearest hit (it lies above its lift's tubes), so it
        // must step aside whenever a part is also under the pointer.
        if (event.intersections.some((hit) => hit.object.userData.pick === 'part')) return
        event.stopPropagation()
        onSelect()
      }}
    >
      <mesh renderOrder={1}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[surfaceVertices, 3]} />
        </bufferGeometry>
        <meshStandardMaterial color={selected ? SELECTED_COLOR : '#788a8c'} transparent opacity={0.3} depthWrite={false} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      <lineSegments renderOrder={2}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[new Float32Array(linePoints), 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={selected ? SELECTED_COLOR : '#40575a'} transparent opacity={0.8} depthWrite={false} />
      </lineSegments>
    </group>
  )
}

/**
 * One house block. The separate `<Edges>` outline and the tone variation per
 * elevation are what make a stack read as several blocks rather than one mass:
 * without them two boxes sharing a face shade continuously into each other.
 */
function BlockBox({ block, tone, selected, labelY, onSelect, onSelectSurface }: {
  block: ResolvedBlock
  tone: string
  selected: boolean
  /** Above any block stacked on this one, so the label is never buried inside it. */
  labelY: number
  onSelect: () => void
  onSelectSurface?: (id: string) => void
}) {
  const height = Math.max(0.01, block.height)
  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    onSelect()
    // In browse mode a top-face click still chooses the surface to draw on; the
    // side faces only inspect the block.
    if (onSelectSurface && (event.face?.normal.y ?? 0) > 0.99) onSelectSurface(block.id)
  }
  return (
    <group>
      <mesh
        name={block.id}
        position={[block.x + block.width / 2, block.base + height / 2, block.z + block.depth / 2]}
        onClick={handleClick}
      >
        <boxGeometry args={[block.width, height, block.depth]} />
        <meshStandardMaterial
          color={tone}
          roughness={0.92}
          metalness={0.02}
          emissive={selected ? SELECTED_COLOR : '#000000'}
          emissiveIntensity={selected ? 0.16 : 0}
        />
        {/* A drawn edge is the data-like counterpart of the block: it survives
            any lighting change and never melts into the box below. */}
        <Edges threshold={18} scale={1.001} color={selected ? SELECTED_COLOR : BLOCK_EDGE} />
      </mesh>
      {selected && <Html position={[block.x + block.width / 2, labelY, block.z + block.depth / 2]}
        center zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
        <span className="block-3d-label">
          <b>{block.id}</b>
          {block.width.toFixed(2)} × {block.depth.toFixed(2)} × {height.toFixed(2)} m
        </span>
      </Html>}
    </group>
  )
}

export function ScaffoldViewer({ layout, blocks = [], onSelectSurface, pipeDiameter = 0.048 }: ViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cameraPreset, setCameraPreset] = useState(0)
  const [cameraRevision, setCameraRevision] = useState(0)
  const [xrayDimensions, setXrayDimensions] = useState(false)
  const { isFullscreen, toggleFullscreen } = useCssFullscreen()
  const [visibility, setVisibility] = useState<Record<RenderLayer, boolean>>(() =>
    Object.fromEntries(RENDER_LAYERS.map((layer) => [layer, true])) as Record<RenderLayer, boolean>)
  const selectedSegment = layout.pipeSegments.find((segment) => segment.id === selectedId)
  const selectedMember = layout.members.find((member) => member.id === selectedSegment?.memberId)
  const selectedAssembly = layout.materials.assemblyPlans.find((plan) => plan.memberId === selectedMember?.id)
  const selectedDeck = layout.decks.find((deck) => deck.id === selectedId)
  const selectedChannel = layout.baseChannels.find((channel) => channel.id === selectedId)
  const selectedConnector = layout.connectors.find((connector) => connector.id === selectedId)
  const selectedBlock = blocks.find((block) => block.id === selectedId)
  const hasSelection = Boolean(selectedSegment || selectedDeck || selectedChannel || selectedConnector || selectedBlock)
  const pathLabel = (index: number) => layout.pathDimensions.find(dimension => dimension.index === index)?.labelIndex ?? index + 1
  const memberPoints = [...layout.pipeSegments.flatMap((segment) => [segment.start, segment.end]),
    // Include the dimension labels: they sit outside the structure, and fitting
    // only the geometry used to push a label off the edge of a phone canvas.
    ...layout.pathDimensions.map((dimension) => dimension.labelPosition),
    ...blocks.flatMap(block => [
      [block.x, block.base, block.z] as [number, number, number],
      [block.x + block.width, block.top, block.z + block.depth] as [number, number, number],
    ])]
  const scenePoints = memberPoints.length > 0
    ? memberPoints
    : [[0, 0, 0], [6, 6, 6]] as [number, number, number][]
  const minimum = scenePoints.reduce(
    (result, point) => result.map((value, index) => Math.min(value, point[index])) as [number, number, number],
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as [number, number, number],
  )
  const maximum = scenePoints.reduce(
    (result, point) => result.map((value, index) => Math.max(value, point[index])) as [number, number, number],
    [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as [number, number, number],
  )
  const center = minimum.map((value, index) => (value + maximum[index]) / 2) as [number, number, number]
  const span = Math.max(6, ...maximum.map((value, index) => value - minimum[index]))
  const cameraPositions: Array<[number, number, number]> = [
    [center[0] + span * 1.75, center[1] + span * 1.0, center[2] + span * 1.75],
    [center[0], center[1] + span * 0.15, center[2] + span * 2],
    [center[0] + span * 2, center[1] + span * 0.15, center[2]],
  ]
  const resetCamera = () => {
    setCameraPreset(0)
    setCameraRevision((revision) => revision + 1)
  }

  // ContactShadows renders once (frames={1}); remount it when the structure
  // actually changes, or the baked shadow goes stale.
  const shadowKey = `${layout.pipeSegments.length}-${layout.decks.length}-${layout.connectors.length}-${span.toFixed(2)}`

  // Clicking empty space clears the selection, but a camera drag that happens to
  // release off-model must not. OrbitControls is makeDefault, so without this
  // every orbit wiped the selected member's detail panel.
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)
  const handlePointerMissed = (event: MouseEvent) => {
    const origin = pointerDownAt.current
    const travelled = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) : 0
    if (travelled < 6) setSelectedId(null)
  }

  /**
   * Hiding the layer a selected object belongs to must also drop its popover:
   * otherwise the panel keeps describing something that is no longer on screen.
   * Done in the layer handlers rather than an effect so the two states change in
   * one user action, with no extra render pass.
   */
  const applyVisibility = (next: Record<RenderLayer, boolean>) => {
    setVisibility(next)
    if (!selectedId) return
    const hidden = (selectedSegment && !next[selectedSegment.type])
      || (selectedDeck && !next.deck)
      || (selectedChannel && !next.channel)
      || (selectedConnector && !next.connector)
      || (selectedBlock && !next.house)
    if (hidden) setSelectedId(null)
  }

  const toggleLayer = (layer: RenderLayer) => {
    applyVisibility({ ...visibility, [layer]: !visibility[layer] })
  }

  const showOnly = (layer: RenderLayer) => {
    applyVisibility(Object.fromEntries(RENDER_LAYERS.map((candidate) => [candidate, candidate === layer])) as Record<RenderLayer, boolean>)
  }

  const showAll = () => {
    applyVisibility(Object.fromEntries(RENDER_LAYERS.map((layer) => [layer, true])) as Record<RenderLayer, boolean>)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const visibleSegments = layout.pipeSegments.filter((segment) => visibility[segment.type])

  return (
    <div className={isFullscreen ? 'viewer-shell is-fullscreen' : 'viewer-shell'} ref={viewerRef}>
      <div className="canvas-toolbar viewer-toolbar">
        <div className="canvas-status">
          <strong className="perimeter-readout">周长 {layout.perimeter.toFixed(2)} m</strong>
          <div className="tool-status"><Rotate3D size={17} /> {visibility.dimension && xrayDimensions ? '尺寸透视：开 · 拖动旋转' : '点选构件查看规格 · 拖动旋转 · 双指缩放'}</div>
        </div>
        <div className="toolbar-actions">
          <IconButton label="复位等轴视图" icon={<Focus size={18} />} onClick={resetCamera} />
          <IconButton label="切换观察方向" icon={<Box size={18} />} onClick={() => setCameraPreset((cameraPreset + 1) % cameraPositions.length)} />
          <IconButton label="透视显示尺寸标注" className="xray-toggle" toggle active={xrayDimensions} disabled={!visibility.dimension}
            title={!visibility.dimension ? '请先打开尺寸图层' : xrayDimensions ? '透视显示尺寸标注：开' : '透视显示尺寸标注：关'}
            icon={<Eye size={18} />} onClick={() => setXrayDimensions(value => !value)} />
          <IconButton label={isFullscreen ? '退出全屏' : '全屏三维'} icon={isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />} onClick={toggleFullscreen} />
        </div>
      </div>
      <div className="viewer-canvas" data-testid="scaffold-canvas">
        <Canvas
          dpr={[1, 1.5]}
          /* three defaults antialias to false, so the scene had no MSAA at all.
             NeutralToneMapping (Khronos PBR Neutral) keeps flat member colours
             saturated where ACES crushed them toward grey. */
          gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping }}
          camera={{ fov: 42 }}
          onPointerDown={(event) => { pointerDownAt.current = { x: event.clientX, y: event.clientY } }}
          onPointerMissed={handlePointerMissed}
        >
          {/* The clear colour bypasses tone mapping, so it is set a little darker
              than the CSS mat to stop the geometry looking washed out beside it. */}
          <color attach="background" args={['#e6e8e9']} />
          <ScaffoldEnvironment />
          <CameraRig
            key={`${cameraPreset}-${cameraRevision}`}
            position={cameraPositions[cameraPreset]}
            target={center}
            maximumDistance={span * 5}
          />
          {/* Ambient carries almost nothing now: the environment map does the
              fill. Direct light was cut ~3x in the same change so the pipes do
              not blow out. The rim light is what separates adjacent parts. */}
          <hemisphereLight args={['#e8f0f2', '#6d7472', 0.45]} />
          <directionalLight position={[7, 9, 6]} intensity={1.25} />
          <directionalLight position={[-6, 3, -5]} intensity={0.5} />
          <directionalLight position={[-3, 5, -9]} intensity={0.85} />
          <ambientLight intensity={0.15} />
          <group>
            {visibleSegments.map((segment) => (
              <Pipe
                key={segment.id}
                segment={segment}
                radius={pipeDiameter / 2}
                selected={segment.id === selectedId}
                onSelect={() => setSelectedId(segment.id)}
              />
            ))}
            {/* Picking proxy after the visible meshes; it renders nothing. */}
            <PipePickProxies segments={visibleSegments} radius={pipeDiameter / 2} onSelect={setSelectedId} />
            {visibility.deck && layout.decks.map((deck) => (
              <SteelDeck key={deck.id} deck={deck} selected={deck.id === selectedId} onSelect={() => setSelectedId(deck.id)} />
            ))}
            {visibility.connector && <Couplers connectors={layout.connectors} selectedId={selectedId} onSelect={setSelectedId} />}
            {visibility.channel && layout.baseChannels.map((channel) => {
              const start = new THREE.Vector3(...channel.start)
              const end = new THREE.Vector3(...channel.end)
              const midpoint = start.clone().add(end).multiplyScalar(0.5)
              // Channels are always horizontal, so a single Y rotation is exact.
              const angle = Math.atan2(end.x - start.x, end.z - start.z)
              return (
                <mesh
                  key={channel.id}
                  position={[midpoint.x, midpoint.y + BASE_CHANNEL_HEIGHT / 2, midpoint.z]}
                  rotation={[0, angle, 0]}
                  userData={PICK_PART}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(channel.id) }}
                >
                  <boxGeometry args={[BASE_CHANNEL_WIDTH, BASE_CHANNEL_HEIGHT, channel.length]} />
                  <meshStandardMaterial
                    color={channel.id === selectedId ? SELECTED_COLOR : LAYER_COLORS.channel}
                    metalness={0.85}
                    roughness={0.42}
                    emissive={channel.id === selectedId ? SELECTED_COLOR : '#000000'}
                    emissiveIntensity={channel.id === selectedId ? 0.5 : 0}
                  />
                </mesh>
              )
            })}
          </group>
          {visibility.house && blocks.map((block, index) => {
            // Float the label above the whole stack: B1's own top is buried when
            // B2 sits on it, and a label drawn inside B2 would lie about which
            // block is selected.
            const labelY = blocks.filter(other => other.id !== block.id
              && other.base >= block.base - 1e-6
              && other.x < block.x + block.width - 1e-6 && other.x + other.width > block.x + 1e-6
              && other.z < block.z + block.depth - 1e-6 && other.z + other.depth > block.z + 1e-6)
              .reduce((top, other) => Math.max(top, other.top), block.top) + 0.28
            return <BlockBox key={block.id} block={block} tone={BLOCK_TONES[index % BLOCK_TONES.length]} labelY={labelY}
              selected={block.id === selectedId} onSelect={() => setSelectedId(block.id)}
              onSelectSurface={onSelectSurface} />
          })}
          {visibility.dimension && <SceneDimensions dimensions={layout.pathDimensions} xray={xrayDimensions} />}
          <ContactShadows
            key={shadowKey}
            position={[center[0], minimum[1] + 0.002, center[2]]}
            scale={span * 1.5}
            resolution={256}
            blur={2.4}
            far={span}
            opacity={0.4}
            color="#31403f"
            frames={1}
          />
          <Grid
            args={[40, 40]}
            cellSize={0.5}
            cellThickness={0.5}
            cellColor="#aebbbd"
            sectionSize={2}
            sectionThickness={1}
            sectionColor="#829294"
            fadeDistance={28}
            infiniteGrid
          />
        </Canvas>
      </div>

      <div className="layer-filter" role="group" aria-label="构件图层">
        <Button size="sm" variant={RENDER_LAYERS.every((layer) => visibility[layer]) ? 'primary' : 'secondary'} onClick={showAll}>全部</Button>
        {RENDER_LAYERS.map((layer) => (
          <div className={visibility[layer] ? 'layer-option active' : 'layer-option'} key={layer}>
            <label>
              <input type="checkbox" checked={visibility[layer]} onChange={() => toggleLayer(layer)} />
              <i style={{ background: LAYER_COLORS[layer] }} />
              <span>{LAYER_LABELS[layer]}</span>
            </label>
            <button type="button" title={`仅显示${LAYER_LABELS[layer]}`} aria-label={`仅显示${LAYER_LABELS[layer]}`} onClick={() => showOnly(layer)}><ScanEye size={13} /></button>
          </div>
        ))}
      </div>

      <aside className={hasSelection ? 'member-popover visible' : 'member-popover'} role="region" aria-label="选中构件规格" aria-live="polite">
        {hasSelection && <>
          <div className="member-popover__head">
            <div className="member-popover__title">
              <span className="field-caption">已选择 · {selectedId}</span>
              <strong>{selectedBlock ? `体块 ${selectedBlock.id}` : selectedSegment ? `${MEMBER_LABELS[selectedSegment.type]} · 第 ${selectedSegment.sequence} 段`
                : selectedDeck ? '钢笆片' : selectedChannel ? '槽钢底座' : selectedConnector ? CONNECTOR_LABELS[selectedConnector.type] : ''}</strong>
              <span className="member-popover__type">
                <Badge>{selectedBlock ? '房屋体块' : selectedDeck ? '铺设材料' : selectedConnector ? '连接构件' : selectedChannel ? '型钢' : '钢管构件'}</Badge>
                {selectedSegment && selectedMember?.pathSegment !== undefined && <span>路径段 #{pathLabel(selectedMember.pathSegment)}</span>}
                {selectedBlock && <span>{selectedBlock.parentId === 'ground' ? '直接落地' : `叠放于 ${selectedBlock.parentId}`}</span>}
              </span>
            </div>
            <IconButton size="xs" label="清除选择" icon={<X size={15} />} onClick={() => setSelectedId(null)} />
          </div>
          <div className="member-popover__body">
            {selectedBlock && (
              <dl>
                <div><dt>平面尺寸</dt><dd>{selectedBlock.width.toFixed(2)} × {selectedBlock.depth.toFixed(2)} m</dd></div>
                <div><dt>体块高度</dt><dd>{selectedBlock.height.toFixed(2)} m</dd></div>
                <div><dt>底面标高</dt><dd>{selectedBlock.base.toFixed(2)} m</dd></div>
                <div><dt>顶面标高</dt><dd>{selectedBlock.top.toFixed(2)} m</dd></div>
                <div><dt>依赖</dt><dd>{selectedBlock.parentId === 'ground' ? '最低地面' : selectedBlock.parentId}</dd></div>
              </dl>
            )}
            {selectedSegment && selectedMember && selectedAssembly && (
              <dl>
                <div><dt>构件类型</dt><dd>{MEMBER_LABELS[selectedSegment.type]}</dd></div>
                <div><dt>库存规格</dt><dd>{selectedSegment.stockLength.toFixed(2)} m</dd></div>
                <div><dt>组合</dt><dd>{selectedAssembly.stockLengths.map((length) => `${length}m`).join(' + ')}</dd></div>
                <div><dt>搭接长度</dt><dd>{selectedSegment.overlapWithPrevious.toFixed(2)} m</dd></div>
                <div><dt>目标净长</dt><dd>{selectedAssembly.requiredLength.toFixed(2)} m</dd></div>
                {/* The length actually built: the combination's own total, which is
                    what the tube renders at and what the neighbouring post has to
                    differ from. */}
                <div><dt>组合总长</dt><dd>{selectedAssembly.effectiveLength.toFixed(2)} m</dd></div>
                <div><dt>组合外伸</dt><dd>{selectedAssembly.excessLength.toFixed(2)} m</dd></div>
                <div><dt>所在层</dt><dd>{selectedMember.layer === undefined ? '立杆全高' : selectedMember.layer === SWEEP_BAR_LAYER ? '扫地杆' : `第 ${selectedMember.layer} 层`}</dd></div>
              </dl>
            )}
            {selectedDeck && (
              <dl>
                <div><dt>覆盖面积</dt><dd>{selectedDeck.area.toFixed(2)} m²</dd></div>
                <div><dt>所在层</dt><dd>第 {selectedDeck.layer} 层</dd></div>
                <div><dt>路径段</dt><dd>#{pathLabel(selectedDeck.pathSegment)}</dd></div>
              </dl>
            )}
            {selectedChannel && (
              <dl>
                <div><dt>单根长度</dt><dd>{selectedChannel.length.toFixed(2)} m</dd></div>
                <div><dt>方向</dt><dd>与横向杆一致</dd></div>
                <div><dt>路径段</dt><dd>#{pathLabel(selectedChannel.pathSegment)}</dd></div>
              </dl>
            )}
            {selectedConnector && (
              <dl>
                <div><dt>连接类型</dt><dd>{CONNECTOR_LABELS[selectedConnector.type]}</dd></div>
                <div><dt>关联构件</dt><dd>{[selectedConnector.memberId, selectedConnector.connectedMemberId].filter(Boolean).join(' / ')}</dd></div>
              </dl>
            )}
            {selectedBlock && onSelectSurface && <div className="member-popover__actions">
              <Button size="sm" onClick={() => onSelectSurface(selectedBlock.id)}>在此顶面继续绘制</Button>
            </div>}
          </div>
        </>}
      </aside>
    </div>
  )
}
