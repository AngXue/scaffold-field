import type { DeepReadonly } from '../contracts.ts'
import type { ScaffoldConnector, PipeSegment, Vector3Tuple } from '../../scaffold.ts'
/** Logical contact differs from the small display offset used to separate fittings. */
export const CONNECTOR_CONTACT = Symbol('scaffold.connectorContact')
export function contactOf(connector: ScaffoldConnector): Vector3Tuple {
  return connector[CONNECTOR_CONTACT] ?? connector.position
}

/** Same 5 mm geometric contact tolerance as C01, plus floating comparison allowance. */
export function stockContainsContact(pipe: DeepReadonly<Pick<PipeSegment, 'start' | 'end'>>, point: readonly number[]): boolean {
  const dx = pipe.end[0] - pipe.start[0], dy = pipe.end[1] - pipe.start[1], dz = pipe.end[2] - pipe.start[2]
  const length2 = dx * dx + dy * dy + dz * dz
  if (length2 <= 0) return false
  const px = point[0] - pipe.start[0], py = point[1] - pipe.start[1], pz = point[2] - pipe.start[2]
  const t = (px * dx + py * dy + pz * dz) / length2, allowance = 0.00501 / Math.sqrt(length2)
  if (t < -allowance || t > 1 + allowance) return false
  const x = px - t * dx, y = py - t * dy, z = pz - t * dz
  return x * x + y * y + z * z <= 0.00501 ** 2
}
