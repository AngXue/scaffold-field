import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Grid, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { Box, Focus, Maximize2, Minimize2, Rotate3D, ScanEye } from 'lucide-react'
import type { DeckPanel, MemberType, PipeSegment, ScaffoldLayout } from '../domain/scaffold'
import { CONNECTOR_LABELS, SWEEP_BAR_LAYER } from '../domain/scaffold'
import { useCssFullscreen } from '../platform/fullscreen'

type ViewerProps = {
  layout: ScaffoldLayout
}

type RenderLayer = MemberType | 'deck' | 'connector' | 'channel'

/** 10# 槽钢: 100 mm high, 48 mm flange. */
const CHANNEL_HEIGHT = 0.1
const CHANNEL_FLANGE = 0.048

/**
 * True tube radius. The domain models a 48 mm scaffold tube
 * (`pipeDiameter: 0.048` in src/domain/scaffold.ts); the viewer used to draw a
 * 76 mm one, which swallowed the joint clearances the domain already emits.
 */
const TUBE_RADIUS = 0.024
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
 * The 钢笆 surface lies `DECK_SURFACE_OFFSET` ABOVE the tubes of its lift, so from
 * almost any angle it is the nearest thing under the pointer. r3f hands an event to
 * the nearest hit first and `stopPropagation()` cuts the rest off, which meant a
 * click aimed at a pipe, coupler or 槽钢 was answered by the deck lying over it.
 * Parts carry `PICK_PART` and always win; the deck only answers a click that hits no
 * part at all.
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
}

const LAYER_COLORS: Record<RenderLayer, string> = {
  ...MEMBER_COLORS,
  deck: '#87989a',
  connector: '#8a8f93',
  channel: '#6f7a7d',
}

const RENDER_LAYERS = Object.keys(LAYER_LABELS) as RenderLayer[]

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
  const { camera } = useThree()
  const [initialView] = useState(() => ({ position, target }))

  useEffect(() => {
    camera.position.set(...initialView.position)
    camera.lookAt(...initialView.target)
    camera.updateProjectionMatrix()
  }, [camera, initialView])

  return <OrbitControls makeDefault target={initialView.target} minDistance={3} maxDistance={maximumDistance} />
}

function Pipe({ segment, selected, onSelect }: {
  segment: PipeSegment
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
      <cylinderGeometry args={[TUBE_RADIUS, TUBE_RADIUS, tubeLength, TUBE_SEGMENTS]} />
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

function SteelDeck({ deck, selected, onSelect }: {
  deck: DeckPanel
  selected: boolean
  onSelect: () => void
}) {
  const [a, b, c, d] = deck.corners.map((corner) => new THREE.Vector3(...corner))
  const surfaceVertices = new Float32Array([
    ...a.toArray(), ...b.toArray(), ...c.toArray(),
    ...a.toArray(), ...c.toArray(), ...d.toArray(),
  ])
  const linePoints: number[] = []
  const lift = (point: THREE.Vector3) => point.clone().add(new THREE.Vector3(0, 0.004, 0))

  for (let index = 0; index <= 8; index += 1) {
    const ratio = index / 8
    linePoints.push(...lift(a.clone().lerp(d, ratio)).toArray(), ...lift(b.clone().lerp(c, ratio)).toArray())
  }
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4
    linePoints.push(...lift(a.clone().lerp(b, ratio)).toArray(), ...lift(d.clone().lerp(c, ratio)).toArray())
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

export function ScaffoldViewer({ layout }: ViewerProps) {
  const viewerRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [cameraPreset, setCameraPreset] = useState(0)
  const [cameraRevision, setCameraRevision] = useState(0)
  const { isFullscreen, toggleFullscreen } = useCssFullscreen()
  const [visibility, setVisibility] = useState<Record<RenderLayer, boolean>>(() =>
    Object.fromEntries(RENDER_LAYERS.map((layer) => [layer, true])) as Record<RenderLayer, boolean>)
  const selectedSegment = layout.pipeSegments.find((segment) => segment.id === selectedId)
  const selectedMember = layout.members.find((member) => member.id === selectedSegment?.memberId)
  const selectedAssembly = layout.materials.assemblyPlans.find((plan) => plan.memberId === selectedMember?.id)
  const selectedDeck = layout.decks.find((deck) => deck.id === selectedId)
  const selectedChannel = layout.baseChannels.find((channel) => channel.id === selectedId)
  const selectedConnector = layout.connectors.find((connector) => connector.id === selectedId)
  const memberPoints = layout.pipeSegments.flatMap((segment) => [segment.start, segment.end])
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
    [center[0] + span * 1.35, center[1] + span * 0.8, center[2] + span * 1.35],
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

  const toggleLayer = (layer: RenderLayer) => {
    setVisibility((current) => ({ ...current, [layer]: !current[layer] }))
  }

  const showOnly = (layer: RenderLayer) => {
    setVisibility(Object.fromEntries(RENDER_LAYERS.map((candidate) => [candidate, candidate === layer])) as Record<RenderLayer, boolean>)
  }

  const showAll = () => {
    setVisibility(Object.fromEntries(RENDER_LAYERS.map((layer) => [layer, true])) as Record<RenderLayer, boolean>)
  }

  return (
    <div className={isFullscreen ? 'viewer-shell is-fullscreen' : 'viewer-shell'} ref={viewerRef}>
      <div className="canvas-toolbar viewer-toolbar">
        <div className="tool-status"><Rotate3D size={17} /> 拖动旋转 · 双指缩放</div>
        <div className="toolbar-actions">
          <button className="icon-button" type="button" title="复位等轴视图" onClick={resetCamera}><Focus size={18} /></button>
          <button className="icon-button" type="button" title="切换观察方向" onClick={() => setCameraPreset((cameraPreset + 1) % cameraPositions.length)}><Box size={18} /></button>
          <button className="icon-button" type="button" title={isFullscreen ? '退出全屏' : '全屏三维'} onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
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
            {layout.pipeSegments.filter((segment) => visibility[segment.type]).map((segment) => (
              <Pipe
                key={segment.id}
                segment={segment}
                selected={segment.id === selectedId}
                onSelect={() => setSelectedId(segment.id)}
              />
            ))}
            {visibility.deck && layout.decks.map((deck) => (
              <SteelDeck key={deck.id} deck={deck} selected={deck.id === selectedId} onSelect={() => setSelectedId(deck.id)} />
            ))}
            {visibility.connector && layout.connectors.map((connector) => (
              <mesh key={connector.id} position={connector.position} userData={PICK_PART} onClick={(event) => { event.stopPropagation(); setSelectedId(connector.id) }}>
                {/* A clamp is a bright, tight-highlight fitting rather than a
                    tangent blob: high metalness and low roughness against the
                    tube's broad soft highlight is what says "two parts". */}
                <sphereGeometry args={[TUBE_RADIUS * 1.65, 16, 12]} />
                <meshStandardMaterial
                  color={connector.id === selectedId ? SELECTED_COLOR : LAYER_COLORS.connector}
                  metalness={0.95}
                  roughness={0.3}
                  emissive={connector.id === selectedId ? SELECTED_COLOR : '#000000'}
                  emissiveIntensity={connector.id === selectedId ? 0.5 : 0}
                />
              </mesh>
            ))}
            {visibility.channel && layout.baseChannels.map((channel) => {
              const start = new THREE.Vector3(...channel.start)
              const end = new THREE.Vector3(...channel.end)
              const midpoint = start.clone().add(end).multiplyScalar(0.5)
              // Channels are always horizontal, so a single Y rotation is exact.
              const angle = Math.atan2(end.x - start.x, end.z - start.z)
              return (
                <mesh
                  key={channel.id}
                  position={[midpoint.x, CHANNEL_HEIGHT / 2, midpoint.z]}
                  rotation={[0, angle, 0]}
                  userData={PICK_PART}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(channel.id) }}
                >
                  <boxGeometry args={[CHANNEL_FLANGE, CHANNEL_HEIGHT, channel.length]} />
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
        <button type="button" className={RENDER_LAYERS.every((layer) => visibility[layer]) ? 'active' : ''} onClick={showAll}>全部</button>
        {RENDER_LAYERS.map((layer) => (
          <div className={visibility[layer] ? 'layer-option active' : 'layer-option'} key={layer}>
            <label>
              <input type="checkbox" checked={visibility[layer]} onChange={() => toggleLayer(layer)} />
              <i style={{ background: LAYER_COLORS[layer] }} />
              <span>{LAYER_LABELS[layer]}</span>
            </label>
            <button type="button" title={`仅显示${LAYER_LABELS[layer]}`} onClick={() => showOnly(layer)}><ScanEye size={13} /></button>
          </div>
        ))}
      </div>

      <aside className={selectedSegment || selectedDeck || selectedChannel || selectedConnector ? 'member-popover visible' : 'member-popover'}>
        {selectedSegment && selectedMember && selectedAssembly && (
          <>
            <span className="field-caption">已选择 · {selectedSegment.id}</span>
            <strong>{MEMBER_LABELS[selectedSegment.type]} · 第 {selectedSegment.sequence} 段</strong>
            <dl>
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
          </>
        )}
        {selectedDeck && (
          <>
            <span className="field-caption">已选择 · {selectedDeck.id}</span>
            <strong>钢笆片</strong>
            <dl>
              <div><dt>覆盖面积</dt><dd>{selectedDeck.area.toFixed(2)} m²</dd></div>
              <div><dt>所在层</dt><dd>第 {selectedDeck.layer} 层</dd></div>
              <div><dt>路径段</dt><dd>#{selectedDeck.pathSegment + 1}</dd></div>
            </dl>
          </>
        )}
        {selectedChannel && (
          <>
            <span className="field-caption">已选择 · {selectedChannel.id}</span>
            <strong>槽钢底座</strong>
            <dl>
              <div><dt>单根长度</dt><dd>{selectedChannel.length.toFixed(2)} m</dd></div>
              <div><dt>方向</dt><dd>与横向杆一致</dd></div>
              <div><dt>路径段</dt><dd>#{selectedChannel.pathSegment + 1}</dd></div>
            </dl>
          </>
        )}
        {selectedConnector && (
          <>
            <span className="field-caption">已选择 · {selectedConnector.id}</span>
            <strong>{CONNECTOR_LABELS[selectedConnector.type]}</strong>
            <dl><div><dt>关联构件</dt><dd>{selectedConnector.memberId}</dd></div></dl>
          </>
        )}
      </aside>
    </div>
  )
}
