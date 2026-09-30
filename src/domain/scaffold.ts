export type Point2D = {
  id: string
  x: number
  y: number
}

export type ScaffoldParameters = {
  height: number
  width: number
  deckSupportRailCount: number
  postSpacing: number
  liftHeight: number
  /** Height of the 扫地杆 (sweep-bar) layer above the base. */
  sweepBarHeight: number
  tubeEndExtension: number
  postTopExtension: number
  spliceOverlap: number
  deckLiftInterval: number
  pipeDiameter: number
  stockLengths: number[]
}

export type MemberType = 'post' | 'longitudinal' | 'transverse'
export type Vector3Tuple = [number, number, number]

/**
 * Couplers, by the names used on site:
 * - `cross`  十字扣 / 直角扣件 — joins two tubes at a right angle. JGJ 130-2011
 *   条文说明 §4.2.1 counts two of these per 主节点, which is what this model emits.
 * - `butt`   对接扣 / 对接扣件 — one sleeve joining two tube ends, so exactly one
 *   per splice joint.
 * - `swivel` 转向扣 / 旋转扣件 — joins two tubes at any angle. Mandated for every
 *   搭接 lap, every 剪刀撑 node, 抛撑 and 横向斜撑; see `connectorSummary.swivel`.
 */
export type ConnectorType = 'cross' | 'butt' | 'swivel'

/** Site names for the three coupler types, shared by every material view. */
export const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  cross: '十字扣',
  butt: '对接扣',
  swivel: '转向扣',
}

/**
 * Sweep-bar members (扫地杆) sit below lift 1, so they are tagged with layer 0
 * rather than counting as a normal lift.
 */
export const SWEEP_BAR_LAYER = 0

export type ScaffoldMember = {
  id: string
  type: MemberType
  start: Vector3Tuple
  end: Vector3Tuple
  connectionPoints: Vector3Tuple[]
  length: number
  layer?: number
  pathSegment?: number
}

export type PipeSegment = {
  id: string
  memberId: string
  type: MemberType
  start: Vector3Tuple
  end: Vector3Tuple
  stockLength: number
  sequence: number
  overlapWithPrevious: number
}

export type DeckPanel = {
  id: string
  corners: [Vector3Tuple, Vector3Tuple, Vector3Tuple, Vector3Tuple]
  area: number
  layer: number
  pathSegment: number
}

export type ScaffoldConnector = {
  id: string
  type: ConnectorType
  position: Vector3Tuple
  memberId: string
}

/**
 * 槽钢 base beam. One piece is laid under each pair of posts, running in the same
 * direction as the transverse members, and the posts stand on it.
 */
export type BaseChannel = {
  id: string
  start: Vector3Tuple
  end: Vector3Tuple
  length: number
  pathSegment: number
}

/**
 * Materials that are consumed on site but deliberately outside the calculation
 * scope, so the bill of materials lists them with a `--` quantity instead of a
 * number that would be mistaken for a computed one.
 */
export type PendingMaterial = {
  id: 'brace' | 'bindingWire' | 'padPlate' | 'formwork'
  label: string
  unit: string
  note?: string
}

export type LayoutWarning = {
  id: string
  message: string
}

export type PipeAssemblyPlan = {
  memberId: string
  requiredLength: number
  effectiveLength: number
  excessLength: number
  stockLengths: number[]
  segmentIds: string[]
}

/**
 * GB/T 706-2016 热轧槽钢 10# (100 × 48 × 5.3 mm), the usual base beam for a
 * two-row 落地架. Nominal mass per metre from the section table.
 */
export const CHANNEL_STEEL = {
  size: '10#',
  massPerMeter: 10,
} as const

export type ChannelSteelSummary = {
  size: string
  count: number
  lengthPerPiece: number
  totalLength: number
  totalMass: number
}

export type MaterialResult = {
  theoreticalLength: number
  purchasedLength: number
  usedLength: number
  wasteLength: number
  utilization: number
  stockSummary: Record<string, number>
  connectorSummary: {
    cross: number
    butt: number
    /**
     * 旋转扣件 is also required for every 搭接 lap — 3 per longitudinal lap and at
     * least 2 per post lap (JGJ 130-2011 §6.2.1-2-2 / §6.3.6-2) — plus 剪刀撑,
     * 抛撑 and 横向斜撑. This model butt-splices every member with 对接扣件, so no
     * lap exists and the count stays unknown until laps or braces are modelled.
     */
    swivel: number | null
  }
  channelSteel: ChannelSteelSummary
  pendingMaterials: PendingMaterial[]
  deckCount: number
  deckArea: number
  assemblyPlans: PipeAssemblyPlan[]
}

export type ScaffoldLayout = {
  members: ScaffoldMember[]
  pipeSegments: PipeSegment[]
  decks: DeckPanel[]
  connectors: ScaffoldConnector[]
  baseChannels: BaseChannel[]
  warnings: LayoutWarning[]
  materials: MaterialResult
}

export const DEFAULT_PARAMETERS: ScaffoldParameters = {
  height: 8.4,
  width: 1.2,
  deckSupportRailCount: 2,
  postSpacing: 1.8,
  liftHeight: 1.8,
  sweepBarHeight: 0.3,
  tubeEndExtension: 0.1,
  postTopExtension: 0.2,
  // 对接扣件 butts two tube ends inside a sleeve, so a joint consumes no length:
  // consecutive segments meet end to end rather than lapping. Raise this only if
  // the site actually laps, and note that a lap needs 旋转扣件 instead (see
  // connectorSummary.swivel).
  spliceOverlap: 0,
  deckLiftInterval: 1,
  pipeDiameter: 0.048,
  stockLengths: [6, 4.5, 4, 3, 2.4, 2, 1.2, 0.8],
}

/** Materials listed in the BOM with a `--` quantity, in display order. */
export const PENDING_MATERIALS: PendingMaterial[] = [
  { id: 'brace', label: '剪刀撑', unit: '根', note: '剪刀撑规则待定' },
  { id: 'bindingWire', label: '扎丝', unit: 'kg' },
  { id: 'padPlate', label: '小垫板', unit: '块' },
  { id: 'formwork', label: '支模板', unit: 'm²' },
]

const round = (value: number, precision = 3) => Number(value.toFixed(precision))
const vectorDistance = (a: Vector3Tuple, b: Vector3Tuple) =>
  Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
const pointKey = (point: Vector3Tuple) => point.map((value) => round(value)).join(':')

function extendLine(
  start: Vector3Tuple,
  end: Vector3Tuple,
  startExtension: number,
  endExtension: number,
): [Vector3Tuple, Vector3Tuple] {
  const length = vectorDistance(start, end)
  if (length <= 0.001) return [start, end]
  const direction = end.map((value, index) => (value - start[index]) / length) as Vector3Tuple
  return [
    start.map((value, index) => round(value - direction[index] * startExtension)) as Vector3Tuple,
    end.map((value, index) => round(value + direction[index] * endExtension)) as Vector3Tuple,
  ]
}

function getPhysicalPoints(points: Point2D[], lengths: number[]) {
  if (!points.length) return []

  const physical: Array<[number, number]> = [[0, 0]]
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index]
    const next = points[index + 1]
    const dx = next.x - current.x
    const dy = next.y - current.y
    const visualLength = Math.hypot(dx, dy) || 1
    const actualLength = Math.max(0.1, lengths[index] ?? visualLength / 50)
    const previous = physical[index]
    physical.push([
      round(previous[0] + (dx / visualLength) * actualLength),
      round(previous[1] + (dy / visualLength) * actualLength),
    ])
  }
  return physical
}

function chooseStockLengths(requiredLength: number, stockLengths: number[], overlap: number) {
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

function createPipeAssembly(
  member: ScaffoldMember,
  stockLengths: number[],
  requestedOverlap: number,
): { segments: PipeSegment[]; connectors: ScaffoldConnector[]; plan: PipeAssemblyPlan } {
  const minimumStock = Math.min(...stockLengths)
  const overlap = Math.max(0, Math.min(requestedOverlap, minimumStock * 0.8))
  const selectedStocks = chooseStockLengths(member.length, stockLengths, overlap)
  const effectiveLength = round(selectedStocks.reduce((sum, stock) => sum + stock, 0) - overlap * (selectedStocks.length - 1))
  const excessLength = round(Math.max(0, effectiveLength - member.length))
  const start = new Vector(member.start)
  const end = new Vector(member.end)
  const direction = end.subtract(start).normalize()
  const assemblyStart = member.type === 'post'
    ? start
    : start.subtract(direction.scale(excessLength / 2))
  const segments: PipeSegment[] = []
  const spliceConnectors: ScaffoldConnector[] = []
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

    // A 对接扣件 is one sleeve that two tube ends butt into, so a butt joint
    // takes exactly ONE coupler. The previous model emitted two per joint
    // because it assumed a lap clamped at both ends.
    if (index > 0) {
      spliceConnectors.push({
        id: `C-${member.id}-splice-${index}`,
        type: 'butt',
        position: cursor.toTuple(),
        memberId: member.id,
      })
    }
    cursor = cursor.add(direction.scale(stockLength - overlap))
  })

  return {
    segments,
    connectors: spliceConnectors,
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

class Vector {
  static readonly ZERO = new Vector([0, 0, 0])
  private readonly value: Vector3Tuple

  constructor(value: Vector3Tuple) {
    this.value = value
  }

  add(other: Vector) {
    return new Vector(this.value.map((value, index) => value + other.value[index]) as Vector3Tuple)
  }

  subtract(other: Vector) {
    return new Vector(this.value.map((value, index) => value - other.value[index]) as Vector3Tuple)
  }

  scale(factor: number) {
    return new Vector(this.value.map((value) => value * factor) as Vector3Tuple)
  }

  normalize() {
    const length = Math.hypot(...this.value)
    return length > 0 ? this.scale(1 / length) : Vector.ZERO
  }

  perpendicular() {
    const [x, y, z] = this.value
    const candidate: Vector3Tuple = Math.abs(y) > 0.9 ? [1, 0, 0] : [-z, 0, x]
    return new Vector(candidate).normalize()
  }

  toTuple() {
    return this.value.map((value) => round(value)) as Vector3Tuple
  }
}

function calculateMaterials(
  members: ScaffoldMember[],
  pipeSegments: PipeSegment[],
  decks: DeckPanel[],
  connectors: ScaffoldConnector[],
  baseChannels: BaseChannel[],
  assemblyPlans: PipeAssemblyPlan[],
): MaterialResult {
  const theoreticalLength = round(members.reduce((sum, member) => sum + member.length, 0))
  const purchasedLength = round(pipeSegments.reduce((sum, segment) => sum + segment.stockLength, 0))
  const stockSummary = pipeSegments.reduce<Record<string, number>>((summary, segment) => {
    const key = `${segment.stockLength}m`
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})

  return {
    theoreticalLength,
    purchasedLength,
    usedLength: theoreticalLength,
    wasteLength: round(purchasedLength - theoreticalLength),
    utilization: purchasedLength ? round((theoreticalLength / purchasedLength) * 100, 1) : 0,
    stockSummary,
    connectorSummary: {
      cross: connectors.filter((connector) => connector.type === 'cross').length,
      butt: connectors.filter((connector) => connector.type === 'butt').length,
      swivel: null,
    },
    // 槽钢 is bought by the piece, so report both the piece count and the run
    // length rather than folding it into the tube figures.
    channelSteel: (() => {
      const totalLength = round(baseChannels.reduce((sum, channel) => sum + channel.length, 0))
      return {
        size: CHANNEL_STEEL.size,
        count: baseChannels.length,
        lengthPerPiece: baseChannels.length ? round(baseChannels[0].length) : 0,
        totalLength,
        totalMass: round(totalLength * CHANNEL_STEEL.massPerMeter, 1),
      }
    })(),
    pendingMaterials: PENDING_MATERIALS,
    deckCount: decks.length,
    deckArea: round(decks.reduce((sum, deck) => sum + deck.area, 0)),
    assemblyPlans,
  }
}

export function calculateScaffold(
  points: Point2D[],
  segmentLengths: number[],
  parameters: ScaffoldParameters,
): ScaffoldLayout {
  const legacyParameters = parameters as ScaffoldParameters & { rowCount?: number }
  parameters = {
    ...DEFAULT_PARAMETERS,
    ...parameters,
    deckSupportRailCount: parameters.deckSupportRailCount ?? legacyParameters.rowCount ?? DEFAULT_PARAMETERS.deckSupportRailCount,
  }
  const physical = getPhysicalPoints(points, segmentLengths)
  const members: ScaffoldMember[] = []
  const decks: DeckPanel[] = []
  const baseChannels: BaseChannel[] = []
  const warnings: LayoutWarning[] = []
  const postKeys = new Set<string>()
  const channelKeys = new Set<string>()
  let memberSequence = 1

  const addMember = (
    type: MemberType,
    start: Vector3Tuple,
    end: Vector3Tuple,
    layer?: number,
    pathSegment?: number,
    connectionPoints: Vector3Tuple[] = [start, end],
    startExtension = parameters.tubeEndExtension,
    endExtension = parameters.tubeEndExtension,
  ) => {
    const [physicalStart, physicalEnd] = extendLine(start, end, startExtension, endExtension)
    const length = round(vectorDistance(physicalStart, physicalEnd))
    if (length <= 0.001) return
    members.push({
      id: `M${memberSequence++}`,
      type,
      start: physicalStart,
      end: physicalEnd,
      connectionPoints,
      length,
      layer,
      pathSegment,
    })
  }

  const layerCount = Math.max(1, Math.ceil(parameters.height / parameters.liftHeight))
  const postRowCount = 2
  const supportRailCount = Math.max(2, Math.round(parameters.deckSupportRailCount))
  physical.slice(0, -1).forEach((start2d, segmentIndex) => {
    const end2d = physical[segmentIndex + 1]
    const segmentLength = Math.hypot(end2d[0] - start2d[0], end2d[1] - start2d[1])
    if (segmentLength <= 0.001) {
      warnings.push({
        id: `zero-length-${segmentIndex}`,
        message: `第 ${segmentIndex + 1} 段的两个节点重合，请移动节点或删除该路径段。`,
      })
      return
    }
    const bayCount = Math.max(1, Math.ceil(segmentLength / parameters.postSpacing))
    const bayLength = segmentLength / bayCount
    const direction: [number, number] = [
      (end2d[0] - start2d[0]) / segmentLength,
      (end2d[1] - start2d[1]) / segmentLength,
    ]
    const normal: [number, number] = [-direction[1], direction[0]]
    const postRows: Array<Array<Vector3Tuple>> = Array.from({ length: postRowCount }, () => [])

    for (let station = 0; station <= bayCount; station += 1) {
      for (let row = 0; row < postRowCount; row += 1) {
        const offset = row * parameters.width
        const point: Vector3Tuple = [
          round(start2d[0] + direction[0] * bayLength * station + normal[0] * offset),
          0,
          round(start2d[1] + direction[1] * bayLength * station + normal[1] * offset),
        ]
        postRows[row].push(point)
        const key = pointKey(point)
        if (!postKeys.has(key)) {
          postKeys.add(key)
          addMember(
            'post',
            point,
            [point[0], parameters.height, point[2]],
            undefined,
            segmentIndex,
            [point, [point[0], parameters.height, point[2]]],
            0,
            parameters.postTopExtension,
          )
        }
      }

      // 槽钢 base beam: one piece under each pair of posts, running in the same
      // direction as the transverse members, with a short bearing overhang past
      // each post. Deduplicated by post pair so a shared path corner does not
      // produce two identical beams.
      const outerBase = postRows[0][station]
      const innerBase = postRows[1][station]
      const channelKey = [pointKey(outerBase), pointKey(innerBase)].sort().join('|')
      if (!channelKeys.has(channelKey)) {
        channelKeys.add(channelKey)
        const [channelStart, channelEnd] = extendLine(
          outerBase,
          innerBase,
          parameters.tubeEndExtension,
          parameters.tubeEndExtension,
        )
        baseChannels.push({
          id: `B${baseChannels.length + 1}`,
          start: channelStart,
          end: channelEnd,
          length: round(vectorDistance(channelStart, channelEnd)),
          pathSegment: segmentIndex,
        })
      }
    }

    const supportRows = Array.from({ length: supportRailCount }, (_, supportIndex) => {
      const ratio = supportIndex / (supportRailCount - 1)
      return postRows[0].map((outerPoint, station) => {
        const innerPoint = postRows[1][station]
        return [
          round(outerPoint[0] + (innerPoint[0] - outerPoint[0]) * ratio),
          0,
          round(outerPoint[2] + (innerPoint[2] - outerPoint[2]) * ratio),
        ] as Vector3Tuple
      })
    })

    // The two post rows carry the ordinary 纵向水平杆. Any rows between them are
    // 钢笆纵向支承杆 (deck-support rails), which only exist where a deck does.
    const normalRows = [supportRows[0], supportRows[supportRows.length - 1]]

    const addHorizontalBand = (elevation: number, layer: number, rows: Vector3Tuple[][], withDeck: boolean) => {
      for (const row of rows) {
        const connectionPoints = row.map((point) => [point[0], elevation, point[2]] as Vector3Tuple)
        addMember(
          'longitudinal',
          connectionPoints[0],
          connectionPoints[connectionPoints.length - 1],
          layer,
          segmentIndex,
          connectionPoints,
        )
      }

      postRows[0].forEach((outerPoint, station) => {
        const isInternalPathNode = (station === 0 && segmentIndex > 0) ||
          (station === bayCount && segmentIndex < physical.length - 2)
        if (isInternalPathNode) return

        const innerPoint = postRows[1][station]
        const transverseConnections = rows.map((row) => [row[station][0], elevation, row[station][2]] as Vector3Tuple)
        addMember(
          'transverse',
          [outerPoint[0], elevation, outerPoint[2]],
          [innerPoint[0], elevation, innerPoint[2]],
          layer,
          segmentIndex,
          transverseConnections,
        )
      })

      if (!withDeck) return
      for (let bay = 0; bay < bayCount; bay += 1) {
        const outerStart = postRows[0][bay]
        const outerEnd = postRows[0][bay + 1]
        const innerEnd = postRows[1][bay + 1]
        const innerStart = postRows[1][bay]
        const deckElevation = elevation + 0.055
        decks.push({
          id: `D${decks.length + 1}`,
          corners: [
            [outerStart[0], deckElevation, outerStart[2]],
            [outerEnd[0], deckElevation, outerEnd[2]],
            [innerEnd[0], deckElevation, innerEnd[2]],
            [innerStart[0], deckElevation, innerStart[2]],
          ],
          area: round(bayLength * parameters.width),
          layer,
          pathSegment: segmentIndex,
        })
      }
    }

    // 扫地杆 layer. It gets ordinary transverse + longitudinal members only:
    // there is no deck here, so no deck-support rails either.
    if (parameters.sweepBarHeight > 0 && parameters.sweepBarHeight < parameters.height) {
      addHorizontalBand(round(parameters.sweepBarHeight), SWEEP_BAR_LAYER, normalRows, false)
    }

    for (let layer = 1; layer <= layerCount; layer += 1) {
      const elevation = Math.min(parameters.height, round(layer * parameters.liftHeight))
      const withDeck = layer % Math.max(1, Math.round(parameters.deckLiftInterval)) === 0
      // Rails exist to carry a deck, so a deckless lift gets only the two normal
      // longitudinal rows.
      addHorizontalBand(elevation, layer, withDeck ? supportRows : normalRows, withDeck)
    }

    if (bayLength < parameters.postSpacing * 0.55) {
      warnings.push({
        id: `short-bay-${segmentIndex}`,
        message: `第 ${segmentIndex + 1} 段末跨仅 ${bayLength.toFixed(2)}m，请复核立杆间距。`,
      })
    }
  })

  // JGJ 130-2011 §6.2.1-2-2 / §6.3.6-2 require 旋转扣件 for a 搭接: 3 per
  // longitudinal lap, at least 2 per post lap. This model only counts 对接扣件
  // butt joints, so say so instead of quietly under-counting the couplers.
  if (parameters.spliceOverlap >= 1) {
    warnings.push({
      id: 'lap-not-modelled',
      message: '搭接长度 ≥ 1 m 属于搭接接头，按 JGJ 130-2011 应使用旋转扣件（纵向水平杆 3 个、立杆不少于 2 个），当前仅按对接扣件统计，请复核。',
    })
  }

  // JGJ 130-2011 §6.3.2 caps the longitudinal sweep bar at 200 mm above the tube
  // bottom. The site-confirmed 300 mm default is kept, but it has to be flagged
  // rather than silently produced.
  if (parameters.sweepBarHeight > 0.2) {
    warnings.push({
      id: 'sweep-bar-height',
      message: `扫地杆高度 ${parameters.sweepBarHeight} m 超过 JGJ 130-2011 第 6.3.2 条“距钢管底端不大于 200 mm”的规定，请复核。`,
    })
  }

  const rawCrossConnectors: ScaffoldConnector[] = members.flatMap((member) => {
    if (member.type === 'post') return []
    const connectionPoints = member.type === 'transverse'
      ? [member.connectionPoints[0], member.connectionPoints[member.connectionPoints.length - 1]]
      : member.connectionPoints
    const verticalOffset = member.type === 'longitudinal'
      ? parameters.pipeDiameter * 0.65
      : -parameters.pipeDiameter * 0.65

    return connectionPoints.map((position, index) => ({
      id: `C-${member.id}-${index + 1}`,
      type: 'cross' as const,
      position: [position[0], round(position[1] + verticalOffset), position[2]] as Vector3Tuple,
      memberId: member.id,
    }))
  })
  const connectorsByPosition = rawCrossConnectors.reduce<Map<string, ScaffoldConnector[]>>((groups, connector) => {
    const key = pointKey(connector.position)
    groups.set(key, [...(groups.get(key) ?? []), connector])
    return groups
  }, new Map())
  const crossConnectors = [...connectorsByPosition.values()].flatMap((connectorsAtPoint) =>
    connectorsAtPoint.map((connector, index) => {
      if (connectorsAtPoint.length === 1) return connector
      const offset = (index - (connectorsAtPoint.length - 1) / 2) * parameters.pipeDiameter * 1.4
      return {
        ...connector,
        position: [round(connector.position[0] + offset), connector.position[1], connector.position[2]] as Vector3Tuple,
      }
    }))
  const assemblies = members.map((member) =>
    createPipeAssembly(member, parameters.stockLengths, parameters.spliceOverlap))
  const pipeSegments = assemblies.flatMap((assembly) => assembly.segments)
  const connectors = [
    ...crossConnectors,
    ...assemblies.flatMap((assembly) => assembly.connectors),
  ]
  const assemblyPlans = assemblies.map((assembly) => assembly.plan)

  return {
    members,
    pipeSegments,
    decks,
    connectors,
    baseChannels,
    warnings,
    materials: calculateMaterials(members, pipeSegments, decks, connectors, baseChannels, assemblyPlans),
  }
}

export function countMembers(layout: ScaffoldLayout) {
  return layout.members.reduce<Record<MemberType, number>>(
    (counts, member) => ({ ...counts, [member.type]: counts[member.type] + 1 }),
    { post: 0, longitudinal: 0, transverse: 0 },
  )
}