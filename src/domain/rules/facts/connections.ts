import type { ScaffoldConnector, Vector3Tuple } from '../../scaffold.ts'
/** Logical contact differs from the small display offset used to separate fittings. */
export const CONNECTOR_CONTACT = Symbol('scaffold.connectorContact')
export function contactOf(connector: ScaffoldConnector): Vector3Tuple {
  return connector[CONNECTOR_CONTACT] ?? connector.position
}
