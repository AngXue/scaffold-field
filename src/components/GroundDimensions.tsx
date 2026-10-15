import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { PathDimension } from '../domain/scaffold'

function GroundDimension({ dimension }: { dimension: PathDimension }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 96
    const context = canvas.getContext('2d')!
    context.font = '500 58px monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#4c5356'
    context.fillText(`#${dimension.index + 1} · ${dimension.length.toFixed(2)} m`, 256, 48)
    const result = new THREE.CanvasTexture(canvas)
    result.colorSpace = THREE.SRGBColorSpace
    return result
  }, [dimension.index, dimension.length])
  useEffect(() => () => texture.dispose(), [texture])
  let angle = Math.atan2(dimension.end[2] - dimension.start[2], dimension.end[0] - dimension.start[0])
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle < -Math.PI / 2) angle += Math.PI
  return (
    <mesh name={`ground-dimension-${dimension.index}`} position={dimension.labelPosition}
      rotation={[-Math.PI / 2, 0, -angle]} raycast={() => undefined}>
      <planeGeometry args={[1.9, 0.36]} />
      <meshBasicMaterial map={texture} transparent opacity={0.7} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Fixed world-space text: no billboarding, HTML overlay or per-frame work. */
export function GroundDimensions({ dimensions }: { dimensions: PathDimension[] }) {
  return dimensions.map(dimension => <GroundDimension key={dimension.index} dimension={dimension} />)
}
