import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { PathDimension } from '../domain/scaffold'

function GroundDimension({ dimension }: { dimension: PathDimension }) {
  const gl = useThree(state => state.gl)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 192
    const context = canvas.getContext('2d')!
    context.font = '600 116px monospace'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#42484a'
    context.fillText(`#${dimension.index + 1} · ${dimension.length.toFixed(2)} m`, 512, 96)
    const result = new THREE.CanvasTexture(canvas)
    result.colorSpace = THREE.SRGBColorSpace
    result.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
    return result
  }, [dimension.index, dimension.length, gl])
  useEffect(() => () => texture.dispose(), [texture])
  let angle = Math.atan2(dimension.end[2] - dimension.start[2], dimension.end[0] - dimension.start[0])
  if (angle > Math.PI / 2) angle -= Math.PI
  if (angle < -Math.PI / 2) angle += Math.PI
  return (
    <mesh name={`ground-dimension-${dimension.index}`} position={dimension.labelPosition}
      rotation={[-Math.PI / 2, 0, -angle]} raycast={() => undefined}>
      <planeGeometry args={[2.8, 0.525]} />
      <meshBasicMaterial map={texture} transparent opacity={0.9} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

/** Fixed world-space text: no billboarding, HTML overlay or per-frame work. */
export function GroundDimensions({ dimensions }: { dimensions: PathDimension[] }) {
  return dimensions.map(dimension => <GroundDimension key={dimension.index} dimension={dimension} />)
}
