import type { PipeSegment, ScaffoldConnector, ScaffoldMember, Vector3Tuple } from '../../scaffold.ts'
import { memberUses } from '../facts/memberUses.ts'
import type { PlacementEnvironment, PlacementDecision, Walkway, Move, AxialRange } from '../facts/placement.ts'
import { transitionRange, wallRange, guardBounds, intersectIntervals, closestShift } from './placementConstraints.ts'

/** One owner of all pipe and sleeve coordinates. Policies supply intervals/objectives, never write entities. */
export function solvePositions(members: readonly ScaffoldMember[], inputPipes: readonly PipeSegment[], inputConnectors: readonly ScaffoldConnector[],
  environment: PlacementEnvironment, objectives: readonly Walkway[]) {
  const pipes = inputPipes.map(pipe => ({ ...pipe, start: [...pipe.start] as Vector3Tuple, end: [...pipe.end] as Vector3Tuple }))
  const connectors = inputConnectors.map(connector => ({ ...connector, position: [...connector.position] as Vector3Tuple }))
  const byMember = new Map<string, PipeSegment[]>(), sleeves = new Map<string, ScaffoldConnector[]>()
  for (const pipe of pipes) { const group = byMember.get(pipe.memberId) ?? []; group.push(pipe); byMember.set(pipe.memberId, group) }
  for (const connector of connectors) if (connector.type === 'butt') { const group = sleeves.get(connector.memberId) ?? []; group.push(connector); sleeves.set(connector.memberId, group) }
  const endsBySource = new Map(environment.transitions), objectiveByMember = new Map(objectives.map(objective => [objective.memberId, objective]))
  const decisions: PlacementDecision[] = []
  for (const member of members) {
    const stock = byMember.get(member.id)
    if (!stock?.length) continue
    const uses = memberUses(member), sources = uses.length ? uses.map(use => use.pathSegment) : [member.pathSegment ?? -1]
    const ends = [...new Set(sources)].flatMap(index => endsBySource.get(index) ?? [])
    const decision: PlacementDecision = { memberId: member.id, moves: [], feasible: true, constraints: [] }
    const apply = (move: Move) => {
      if (move.delta.every(value => Math.abs(value) < 1e-6)) return
      const moved = (point: Vector3Tuple): Vector3Tuple => point.map((value, axis) => move.delta[axis] === 0 ? value : value + move.delta[axis]) as Vector3Tuple
      for (const pipe of stock) { pipe.start = moved(pipe.start); pipe.end = moved(pipe.end) }
      for (const sleeve of sleeves.get(member.id) ?? []) sleeve.position = moved(sleeve.position)
      decision.moves.push(move)
    }
    const moveAxis = (constraint: AxialRange | undefined, reason: 'transition' | 'wall') => {
      if (!constraint) return
      decision.constraints.push(reason)
      const shift = closestShift(constraint.allowed)
      if (shift === undefined) { decision.feasible = false; return }
      const delta: Vector3Tuple = [0, 0, 0]; delta[constraint.axis] = shift
      apply({ rule: 'S04', reason, delta })
    }
    // The preferred candidate retains the established transition then wall tie-break.
    // Both providers are recomputed against the private pose, preserving old rounding.
    moveAxis(transitionRange(member, stock, ends, environment.radius), 'transition')
    if (environment.cells.length) moveAxis(wallRange(member, stock, environment.cells, environment.radius), 'wall')
    // If several hard intervals overlap, certify their common feasible set before
    // applying a soft objective. An infeasible set keeps the established best-effort
    // pose and is recorded for final validation; it never invents a cut tube.
    const constraintsAtPose = () => [transitionRange(member, stock, ends, environment.radius),
      environment.cells.length ? wallRange(member, stock, environment.cells, environment.radius) : undefined]
      .filter((range): range is AxialRange => range !== undefined)
    const hard = constraintsAtPose()
    if (hard.length && hard.every(range => range.axis === hard[0].axis)) {
      const allowed = hard.slice(1).reduce((ranges, constraint) => intersectIntervals(ranges, constraint.allowed), hard[0].allowed)
      if (!allowed.some(([low, high]) => low <= 1e-6 && high >= -1e-6)) {
        const shift = closestShift(allowed)
        if (shift !== undefined) {
          const delta: Vector3Tuple = [0, 0, 0]; delta[hard[0].axis] = shift
          apply({ rule: 'S04', reason: 'wall', delta })
        }
      }
    }
    const objective = objectiveByMember.get(member.id)
    if (objective) {
      const bounds = guardBounds(objective, stock, environment.obstacles, environment.radius)
      let allowed = bounds.allowed
      // Hard constraints are intersected in the guard's signed axial coordinate;
      // a later walkway optimisation cannot override a transition or wall restriction.
      for (const constraint of [transitionRange(member, stock, ends, environment.radius),
        environment.cells.length ? wallRange(member, stock, environment.cells, environment.radius) : undefined]) {
        if (!constraint) continue
        const direction = objective.direction[constraint.axis]
        if (Math.abs(direction) < 0.999999) continue
        const intervals = constraint.allowed.map(([low, high]) => direction > 0 ? [low / direction, high / direction] : [high / direction, low / direction]) as [number, number][]
        allowed = intersectIntervals(allowed, intervals)
      }
      const score = (shift: number) => objective.occupied.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(bounds.high + shift, b) - Math.max(bounds.low + shift, a)), 0)
      const breaks = [0, ...objective.occupied.flatMap(([a, b]) => [a - bounds.low, a - bounds.high, b - bounds.low, b - bounds.high])]
      const candidates = allowed.flatMap(([a, b]) => a > b + 1e-6 ? [] : [a, b, ...breaks.map(value => Math.max(a, Math.min(b, value)))])
      candidates.sort((a, b) => Math.abs(score(a) - score(b)) > 1e-7 ? score(a) - score(b) : Math.abs(a) - Math.abs(b))
      const shift = candidates[0]
      decision.searchConstraints = ['guard-endpoints', 'guard-search-clearance']
      decision.searchFeasible = allowed.length > 0
      if (shift === undefined) decision.feasible = false
      const improved = shift !== undefined && Math.abs(shift) >= 1e-6 && score(shift) < score(0) - 1e-7
      decision.intrusion = { before: score(0), after: score(improved ? shift! : 0) }
      if (improved) apply({ rule: 'P08', reason: 'walkway', delta: objective.direction.map(value => value * shift!) as Vector3Tuple })
    }
    decision.feasible = constraintsAtPose().every(range => range.allowed.some(([low, high]) => low <= 1e-6 && high >= -1e-6))

    decisions.push(decision)
  }
  return { pipes, connectors, decisions }
}
