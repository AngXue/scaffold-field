import { useMemo } from 'react'
import { Html, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { PathDimension } from '../domain/scaffold'

/**
 * 3D dimension annotation for a measured path.
 *
 * The old implementation painted the text into a fixed-size plane lying on the
 * ground. At any useful camera distance it was too small to read, it was clipped
 * by the building, and it could not stay legible while orbiting. This version
 * keeps the dimension line in the scene (so it belongs to the geometry) and puts
 * the number in a screen-space HTML chip (so it stays sharp and readable).
 */
function SceneDimension({ dimension, xray }: { dimension: PathDimension; xray: boolean }) {
  const geometry = useMemo(() => {
    const start = new THREE.Vector3(...dimension.start)
    const end = new THREE.Vector3(...dimension.end)
    const label = new THREE.Vector3(...dimension.labelPosition)
    const middle = start.clone().add(end).multiplyScalar(0.5)
    const offset = label.clone().sub(middle)
    offset.y = 0
    if (offset.lengthSq() < 1e-8) offset.set(0, 0, 1)
    const lift = 0.012
    const a = start.clone().add(offset).setY(start.y + lift)
    const b = end.clone().add(offset).setY(end.y + lift)
    const from = start.clone().setY(start.y + lift)
    const to = end.clone().setY(end.y + lift)
    // A witness tick lies across the dimension line, not along it.
    const tick = offset.clone().normalize().multiplyScalar(0.1)
    const midpoint = a.clone().add(b).multiplyScalar(0.5)
    const labelAt = new THREE.Vector3(midpoint.x, start.y + lift + 0.24, midpoint.z)
    return {
      main: [a, b] as [THREE.Vector3, THREE.Vector3],
      extensions: [
        [from, a] as [THREE.Vector3, THREE.Vector3],
        [to, b] as [THREE.Vector3, THREE.Vector3],
      ],
      ticks: [
        [a.clone().add(tick), a.clone().sub(tick)] as [THREE.Vector3, THREE.Vector3],
        [b.clone().add(tick), b.clone().sub(tick)] as [THREE.Vector3, THREE.Vector3],
      ],
      leader: [midpoint, labelAt.clone().setY(start.y + lift + 0.16)] as [THREE.Vector3, THREE.Vector3],
      label: labelAt,
    }
  }, [dimension])

  return (
    <group>
      {/* By default a dimension belongs to the model: depth testing hides the
          line behind a wall, and Html occlusion hides the number when its anchor
          is behind geometry. The optional x-ray mode opts into the old overlay
          behaviour for checking dimensions hidden inside the structure. */}
      <Line points={geometry.main} color="#596366" lineWidth={1} transparent opacity={0.65}
        depthTest={!xray} renderOrder={xray ? 20 : 0} />
      {geometry.extensions.map((points, index) => (
        <Line key={`ext-${index}`} points={points} color="#7b8487" lineWidth={0.8} transparent opacity={0.5}
          depthTest={!xray} renderOrder={xray ? 20 : 0} />
      ))}
      {geometry.ticks.map((points, index) => (
        <Line key={`tick-${index}`} points={points} color="#596366" lineWidth={1} transparent opacity={0.7}
          depthTest={!xray} renderOrder={xray ? 20 : 0} />
      ))}
      <Line points={geometry.leader} color="#7b8487" lineWidth={0.8} transparent opacity={0.5}
        depthTest={!xray} renderOrder={xray ? 20 : 0} />
      <Html position={geometry.label} center occlude={!xray} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <span className={xray ? 'scene-dimension__chip is-xray' : 'scene-dimension__chip'}>
          <span className="scene-dimension__index">#{dimension.labelIndex ?? dimension.index + 1}</span>
          {dimension.length.toFixed(2)} m
        </span>
      </Html>
    </group>
  )
}

export function SceneDimensions({ dimensions, xray = false }: { dimensions: PathDimension[]; xray?: boolean }) {
  return <>{dimensions.map(dimension => <SceneDimension key={dimension.index} dimension={dimension} xray={xray} />)}</>
}
