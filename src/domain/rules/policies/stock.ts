import { roundFixedMillimetre as round } from '../facts/precision.ts'
import { DEFAULT_PARAMETERS, SPLICE_STAGGER, type ScaffoldMember, type ScaffoldParameters, type Vector3Tuple, type LayoutWarning, type PipeSegment, type PipeAssemblyPlan } from '../../scaffold.ts'
import { Vector } from '../facts/vector.ts'

const vectorDistance = (a: Vector3Tuple, b: Vector3Tuple) => Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])

export function chooseStockLengths(requiredLength: number, stockLengths: number[], overlap: number) {
  const stocks = [...stockLengths].filter((length) => length > overlap).sort((a, b) => b - a)
  if (!stocks.length) return [requiredLength]

  const maximumSegments = Math.ceil(requiredLength / (stocks[0] - overlap)) + 2
  let states = new Map<number, number[]>([[0, []]])

  for (let count = 1; count <= maximumSegments; count += 1) {
    const nextStates = new Map<number, number[]>()
    for (const [sum, combination] of states) {
      for (const stock of stocks) {
        const nextSum = round(sum + stock)
        if (!nextStates.has(nextSum)) nextStates.set(nextSum, [...combination, stock])
      }
    }

    const candidates = [...nextStates.entries()]
      .map(([sum, combination]) => ({
        combination,
        effectiveLength: round(sum - overlap * (combination.length - 1)),
      }))
      .filter((candidate) => candidate.effectiveLength + 0.001 >= requiredLength)
      .sort((a, b) => a.effectiveLength - b.effectiveLength)

    if (candidates.length) return candidates[0].combination
    states = nextStates
  }

  return [stocks[0]]
}

/**
 * Butt-joint heights of an ordered stock sequence, laid from the member's base up.
 * The sequence IS the joint layout, which is why the order matters: [6, 4.5] joints
 * at 6 m, [4.5, 6] at 4.5 m.
 */
function jointHeights(sequence: number[], overlap = 0) {
  const joints: number[] = []
  let cursor = 0
  sequence.slice(0, -1).forEach((stock) => {
    cursor += stock - overlap
    joints.push(round(cursor))
  })
  return joints
}

/** True when no joint of `candidate` lands within SPLICE_STAGGER of one of `base`. */
function jointsAreStaggered(candidate: number[], base: number[]) {
  const baseJoints = jointHeights(base)
  if (!baseJoints.length) return false
  return jointHeights(candidate).every((joint) =>
    baseJoints.every((baseJoint) => Math.abs(joint - baseJoint) >= SPLICE_STAGGER - 0.001))
}

/**
 * Every ordered sequence of exactly `size` stock lengths that still covers
 * `requiredLength`, cheapest first. Ordered on purpose — see `jointHeights` — and
 * bounded, because it only ever serves the neighbouring post of an already-chosen
 * one.
 */
function stockSequences(requiredLength: number, stocks: number[], overlap: number, size: number) {
  let sequences: number[][] = [[]]
  for (let piece = 0; piece < size; piece += 1) {
    sequences = sequences.flatMap((sequence) => stocks.map((stock) => [...sequence, stock]))
  }
  return sequences
    .map((sequence) => ({
      sequence,
      effectiveLength: round(sequence.reduce((sum, stock) => sum + stock, 0) - overlap * (size - 1)),
    }))
    .filter((candidate) => candidate.effectiveLength + 0.001 >= requiredLength)
    .sort((a, b) => a.effectiveLength - b.effectiveLength || a.sequence.join().localeCompare(b.sequence.join()))
    .map((candidate) => candidate.sequence)
}

/**
 * The sequence the post NEXT TO `primary` is built with, so their butt joints do not
 * land at the same height (JGJ 130-2011 §6.3.6).
 *
 * The first choice is the primary sequence REVERSED: the same tubes, the same cost,
 * joints moved (6+4.5 beside 4.5+6). When that changes nothing — a palindromic
 * sequence such as 6+6 — the next cheapest sequence that is genuinely staggered is
 * used instead (4.5+6+2 = 12.5 m beside 6+6 = 12 m), which is one tube longer and
 * leaves that post a little taller. Both are physical: the tubes are bought whole and
 * the 水平杆 tie the posts together at every lift.
 */
export function neighbourStockSequence(
  primary: number[],
  requiredLength: number,
  stockLengths: number[],
  overlap: number,
) {
  const reversed = [...primary].reverse()
  if (jointsAreStaggered(reversed, primary)) return reversed

  const stocks = [...stockLengths].filter((length) => length > overlap).sort((a, b) => b - a)
  const total = (sequence: number[]) =>
    round(sequence.reduce((sum, stock) => sum + stock, 0) - overlap * (sequence.length - 1))
  const candidates = [primary.length, primary.length + 1]
    .flatMap((size) => stockSequences(requiredLength, stocks, overlap, size))
    .filter((sequence) => sequence.join() !== primary.join() && jointsAreStaggered(sequence, primary))

  // A combination that only reorders the same tubes into the same TOTAL length is
  // indistinguishable from its neighbour — on site and in the 3D view — so the
  // neighbour is given a different mix altogether (6+6 beside 2+6+4.5 = 12.5 m).
  // Same-length alternatives are only a last resort before giving up.
  return candidates.find((sequence) => Math.abs(total(sequence) - total(primary)) > 0.001)
    ?? candidates[0]
    ?? reversed
}

/** Physical length of the tube actually bought for a member: the chosen stock
 * combination, less the length each butt joint swallows. Used by both the pipe
 * assembly and the 槽钢 base beam, which is laid to the same length as the
 * transverse tube above it. */
export function assembledLength(requiredLength: number, stockLengths: number[], requestedOverlap: number) {
  const overlap = Math.max(0, Math.min(requestedOverlap, Math.min(...stockLengths) * 0.8))
  const selectedStocks = chooseStockLengths(requiredLength, stockLengths, overlap)
  return round(
    selectedStocks.reduce((sum, stock) => sum + stock, 0) - overlap * (selectedStocks.length - 1),
  )
}

function onPlanRun(point: Vector3Tuple, member: ScaffoldMember) {
  const dx = member.end[0] - member.start[0], dz = member.end[2] - member.start[2]
  const length = Math.hypot(dx, dz)
  if (length < 0.001) return false
  const along = ((point[0] - member.start[0]) * dx + (point[2] - member.start[2]) * dz) / length
  return along >= -0.005 && along <= length + 0.005
    && Math.abs((point[0] - member.start[0]) * dz - (point[2] - member.start[2]) * dx) / length < 0.005
}

/** Preserve the preferred alternating sequences, then repair the FINAL graph. */
/** 5 m stock is available for horizontal members, never for uprights. */
export function postStocks(parameters: ScaffoldParameters) {
  const allowed = parameters.stockLengths.filter(stock => Math.abs(stock - 5) > 0.001)
  return allowed.length ? allowed : DEFAULT_PARAMETERS.stockLengths.filter(stock => stock !== 5)
}

export function repairPostSplices(members: ScaffoldMember[], original: Record<string, number[]>, parameters: ScaffoldParameters) {
  const sequences = new Map(Object.entries(original)), warnings: LayoutWarning[] = []
  const posts = members.filter(m => m.type === 'post')
  const neighbours = new Map(posts.map(post => [post.id, new Set<string>()]))
  for (const run of members.filter(m => (m.type === 'longitudinal' || m.type === 'transverse') && m.layer === 1)) {
    const row = posts.filter(post => onPlanRun(post.start, run)).sort((a, b) =>
      vectorDistance(a.start, run.start) - vectorDistance(b.start, run.start))
    for (let i = 1; i < row.length; i++) {
      neighbours.get(row[i - 1].id)!.add(row[i].id)
      neighbours.get(row[i].id)!.add(row[i - 1].id)
    }
  }
  const overlap = Math.max(0, Math.min(parameters.spliceOverlap, Math.min(...postStocks(parameters)) * 0.8))
  const stocks = postStocks(parameters).filter(stock => stock > overlap).sort((a, b) => b - a)
  const assigned = new Set<string>()
  const cache = new Map<string, number[] | null>()
  for (const post of posts) {
    const forbidden = [...neighbours.get(post.id)!].filter(id => assigned.has(id)).flatMap(id => jointHeights(sequences.get(id)!, overlap))
    const fits = (sequence: number[]) => jointHeights(sequence, overlap).every(joint => forbidden.every(other => Math.abs(joint - other) >= SPLICE_STAGGER - 0.001))
    const preferred = sequences.get(post.id)!
    if (!fits(preferred)) {
      const cacheKey = `${post.length}:${[...new Set(forbidden)].sort((a, b) => a - b).join(',')}`
      let replacement = cache.get(cacheKey)
      if (replacement === undefined) {
        // DP keeps one legal prefix per (piece count, height). Future legality
        // only depends on that height, so no exponential stock permutations.
        let states = new Map<number, number[]>([[0, []]])
        replacement = null
        const limit = Math.ceil(post.length / Math.max(0.1, (stocks[0] ?? post.length) - overlap)) + 3
        for (let count = 1; count <= limit && !replacement; count++) {
          const next = new Map<number, number[]>()
          for (const [height, prefix] of states) {
            if (prefix.length && forbidden.some(joint => Math.abs(height - overlap - joint) < SPLICE_STAGGER - 0.001)) continue
            for (const stock of stocks) {
              const total = round(height + stock - (prefix.length ? overlap : 0))
              if (!next.has(total)) next.set(total, [...prefix, stock])
            }
          }
          const primaryTotal = preferred.reduce((a, b) => a + b, 0) - overlap * (preferred.length - 1)
          const candidates = [...next].filter(([height]) => height >= post.length - 0.001)
          candidates.sort(([a], [b]) => Number(Math.abs(a - primaryTotal) < 0.001) - Number(Math.abs(b - primaryTotal) < 0.001) || a - b)
          replacement = candidates[0]?.[1] ?? null
          states = next
        }
        cache.set(cacheKey, replacement)
      }
      if (replacement) sequences.set(post.id, replacement)
      else warnings.push({ id: `splice-stagger-${post.id}`, message: `立杆 (${post.start[0]}, ${post.start[2]}) 在当前库存管规格下无法与相邻接头错开 0.5 m，请调整规格或站位。` })
    }
    assigned.add(post.id)
  }
  return { sequences: Object.fromEntries(sequences), warnings }
}

export function createPipeAssembly(
  member: ScaffoldMember,
  stockLengths: number[],
  requestedOverlap: number,
  /** An already-chosen sequence, used to give a 立杆 its staggered assembly. */
  sequence?: number[],
): { segments: PipeSegment[]; plan: PipeAssemblyPlan } {
  const minimumStock = Math.min(...stockLengths)
  const overlap = Math.max(0, Math.min(requestedOverlap, minimumStock * 0.8))
  const selectedStocks = sequence ?? chooseStockLengths(member.length, stockLengths, overlap)
  const effectiveLength = round(
    selectedStocks.reduce((sum, stock) => sum + stock, 0) - overlap * (selectedStocks.length - 1),
  )
  const excessLength = round(Math.max(0, effectiveLength - member.length))
  const start = new Vector(member.start)
  const end = new Vector(member.end)
  const direction = end.subtract(start).normalize()
  const assemblyStart = member.type === 'post'
    ? start
    : start.subtract(direction.scale(excessLength / 2))
  const segments: PipeSegment[] = []
  let cursor = assemblyStart

  selectedStocks.forEach((stockLength, index) => {
    const segmentStart = cursor
    const segmentEnd = cursor.add(direction.scale(stockLength))
    const id = `S-${member.id}-${index + 1}`
    segments.push({
      id,
      memberId: member.id,
      type: member.type,
      start: segmentStart.toTuple(),
      end: segmentEnd.toTuple(),
      stockLength,
      sequence: index + 1,
      overlapWithPrevious: index === 0 ? 0 : overlap,
    })

    cursor = cursor.add(direction.scale(stockLength - overlap))
  })

  return {
    segments,
    plan: {
      memberId: member.id,
      requiredLength: member.length,
      effectiveLength,
      excessLength,
      stockLengths: selectedStocks,
      segmentIds: segments.map((segment) => segment.id),
    },
  }
}


export function postStockWarnings(parameters: ScaffoldParameters): LayoutWarning[] {
  return parameters.stockLengths.every(stock => Math.abs(stock - 5) < 0.001) ? [{
    id: 'post-stock-unavailable', message: '库存只有禁用于立柱的 5 m 规格：立柱暂按默认非 5 m 库存估算，请补充可用规格后复核。',
  }] : []
}

/** S01: request-local reuse only; stock order, overlap and selection objectives are unchanged. */
export function assembleHorizontalRuns(members: ScaffoldMember[], parameters: ScaffoldParameters,
  sequences: Record<string, number[]>, memoize = true) {
  const cache = new Map<number, number[]>()
  const overlap = Math.max(0, Math.min(parameters.spliceOverlap, Math.min(...parameters.stockLengths) * 0.8))
  return members.filter(member => member.type !== 'post').map(member => {
    let sequence = sequences[member.id] ?? (memoize ? cache.get(member.length) : undefined)
    if (!sequence) {
      sequence = chooseStockLengths(member.length, parameters.stockLengths, overlap)
      if (memoize) cache.set(member.length, sequence)
    }
    return createPipeAssembly(member, parameters.stockLengths, parameters.spliceOverlap, sequence)
  })
}
