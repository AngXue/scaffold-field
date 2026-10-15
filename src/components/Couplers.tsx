import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ConnectorType, ScaffoldConnector } from '../domain/scaffold'

const TYPES: ConnectorType[] = ['cross', 'butt', 'swivel']
const SELECTED = '#ffb02e'

/** Hollow low-poly clamp bands with a flat hinge/bolt ear; no textures or assets. */
function fittingGeometry(type: ConnectorType) {
  const pieces: THREE.BufferGeometry[] = []
  const add = (geometry: THREE.BufferGeometry, position: THREE.Vector3, rotation = new THREE.Euler()) => {
    geometry.applyMatrix4(new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1)))
    pieces.push(geometry)
  }
  const band = (height: number) => new THREE.LatheGeometry([
    new THREE.Vector2(0.0245, -height / 2),
    new THREE.Vector2(0.031, -height / 2),
    new THREE.Vector2(0.034, -height / 2 + 0.004),
    new THREE.Vector2(0.034, height / 2 - 0.004),
    new THREE.Vector2(0.031, height / 2),
    new THREE.Vector2(0.0245, height / 2),
    new THREE.Vector2(0.0245, -height / 2),
  ], 10)
  const bolt = (x: number, y: number, z: number) => {
    add(new THREE.BoxGeometry(0.025, 0.018, 0.013), new THREE.Vector3(x, y, z))
    add(new THREE.CylinderGeometry(0.009, 0.009, 0.023, 6), new THREE.Vector3(x, y, z + 0.007), new THREE.Euler(Math.PI / 2, 0, 0))
  }
  if (type === 'butt') {
    add(band(0.13), new THREE.Vector3())
    bolt(0.033, -0.042, 0)
    bolt(0.033, 0.042, 0)
  } else {
    add(band(0.04), new THREE.Vector3(0, 0, -0.028))
    bolt(0.035, 0, -0.028)
    const angle = type === 'cross' ? Math.PI / 2 : Math.PI / 3
    add(band(0.04), new THREE.Vector3(0, 0, 0.028), new THREE.Euler(0, 0, angle))
    bolt(0, 0.035, 0.028)
    // The swivel's central pin distinguishes it from the fixed right-angle body.
    if (type === 'swivel') {
      add(new THREE.CylinderGeometry(0.013, 0.013, 0.08, 8), new THREE.Vector3(), new THREE.Euler(Math.PI / 2, 0, 0))
    }
  }
  const merged = mergeGeometries(pieces, false)!
  pieces.forEach((piece) => piece.dispose())
  return merged
}

function fittingMatrix(connector: ScaffoldConnector) {
  const y = new THREE.Vector3(...connector.axis).normalize()
  let x = connector.secondaryAxis ? new THREE.Vector3(...connector.secondaryAxis) : new THREE.Vector3(1, 0, 0)
  if (Math.abs(x.dot(y)) > 0.99) x = new THREE.Vector3(0, 0, 1)
  x.addScaledVector(y, -x.dot(y)).normalize()
  const z = x.clone().cross(y).normalize()
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...connector.position)
}

function FittingBatch({ connectors, geometry, selectedId, onSelect }: {
  connectors: ScaffoldConnector[]
  geometry: THREE.BufferGeometry
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const selected = connectors.find((connector) => connector.id === selectedId)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    connectors.forEach((connector, index) => {
      const matrix = fittingMatrix(connector)
      // The selected fitting uses one emissive mesh, at exactly the same size.
      if (connector.id === selectedId) matrix.scale(new THREE.Vector3(0, 0, 0))
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [connectors, selectedId])
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (event.instanceId === undefined) return
    event.stopPropagation()
    onSelect(connectors[event.instanceId].id)
  }
  return <>
    <instancedMesh ref={ref} args={[geometry, undefined, connectors.length]} userData={{ pick: 'part' }} onClick={click}>
      <meshStandardMaterial color="#8a8f93" metalness={0.85} roughness={0.38} />
    </instancedMesh>
    {selected && <mesh geometry={geometry} matrix={fittingMatrix(selected)} matrixAutoUpdate={false} userData={{ pick: 'part' }} onClick={(event) => { event.stopPropagation(); onSelect(selected.id) }}>
      <meshStandardMaterial color="#8a8f93" metalness={0.85} roughness={0.38} emissive={SELECTED} emissiveIntensity={0.5} />
    </mesh>}
  </>
}

/** One draw call per populated type, rather than several meshes per fitting. */
export function Couplers({ connectors, selectedId, onSelect }: {
  connectors: ScaffoldConnector[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const geometries = useMemo(() => Object.fromEntries(TYPES.map((type) => [type, fittingGeometry(type)])) as Record<ConnectorType, THREE.BufferGeometry>, [])
  const groups = useMemo(() => TYPES.map((type) => ({ type, items: connectors.filter((connector) => connector.type === type) })), [connectors])
  useEffect(() => () => Object.values(geometries).forEach((geometry) => geometry.dispose()), [geometries])
  return <>{groups.filter(({ items }) => items.length > 0).map(({ type, items }) => <FittingBatch key={type} connectors={items} geometry={geometries[type]} selectedId={selectedId} onSelect={onSelect} />)}</>
}
