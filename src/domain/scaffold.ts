export type Point2D = {
  id: string
  x: number
  y: number
}

export type ScaffoldParameters = {
  /**
   * 作业层排数 — the ONE thing the user sets about height. Every elevation follows
   * from it: 作业层 k at `k × liftHeight`, and
   * `理论搭设高度 = TOP_POST_EXTENSION + liftHeight × layerCount`.
   */
  layerCount: number
  width: number
  deckSupportRailCount: number
  postSpacing: number
  liftHeight: number
  /** Height of the 扫地杆 (sweep-bar) layer above the base. */
  sweepBarHeight: number
  /**
   * Guarded sides per 作业层. §7.3.12(1) mandates the OUTER row only (栏杆和挡脚板
   * 均应搭设在外立杆的内侧), so 1 is the code minimum and the default; the inner
   * row is regulated as a gap to the building. 2 is the common site rule, and
   * becomes mandatory when the inner face is genuinely open and therefore a 临边
   * (JGJ 80-2016 §4.1.1, 强制性条文).
   */
  guardrailSides: number
  /**
   * Rails per guarded side. §7.3.12(2)(4) requires 上栏杆 + 中栏杆, but a site that
   * only builds the 上栏杆 must be able to say so rather than have the 中栏杆
   * counted for it, so this is a real parameter: 2 = 上 + 中 (the code set),
   * 1 = 上栏杆 only.
   */
  guardrailRailCount: number
  tubeEndExtension: number
  spliceOverlap: number
  deckLiftInterval: number
  pipeDiameter: number
  stockLengths: number[]
}

export type MemberType = 'post' | 'longitudinal' | 'transverse' | 'guardrail'
export type Vector3Tuple = [number, number, number]

/**
 * Height of the 上栏杆 上皮 above the 作业层 (JGJ 130-2011 §7.3.12(2)). It is the
 * height a 2-rail guarded side tops out at, and it is why a row that carries rails
 * needs one more 步距 of 立杆 than the row against the building.
 */
export const GUARDRAIL_TOP_EDGE = 1.2

/**
 * JGJ 130-2011 §7.3.12 requires, at every 作业层, TWO rails per guarded side:
 *   1 栏杆和挡脚板均应搭设在外立杆的内侧; 2 上栏杆上皮高度应为 1.2m;
 *   4 中栏杆应居中设置.
 * GB 51210-2016 §8.2.8 条文说明 fixes the lower rail as 居中 between the deck and
 * the top rail. The standard gives the top rail as 上皮 (top edge), so its
 * centreline sits one radius lower. The mid rail has no stated number; 0.6 m is
 * the common site reading and does not affect any material quantity, because
 * every rail is horizontal and therefore the same length wherever it sits.
 *
 * Heights are measured from the 作业层, which is the lift axis.
 */
export const GUARDRAILS = [
  { id: 'top', label: '上栏杆', centreAboveDeck: GUARDRAIL_TOP_EDGE - 0.024 },
  { id: 'mid', label: '中栏杆', centreAboveDeck: 0.6 },
] as const

/**
 * Which rails a guarded side carries, as a function of the 步距.
 *
 * - **2 根**: the §7.3.12 set — 上栏杆 (上皮 1.2 m above the 作业层) + 中栏杆.
 * - **1 根**: 居中 **in the 步距** — `liftHeight / 2` above the 作业层 (0.94 m at the
 *   1.88 m default). This is the site's single-rail position, not the 上栏杆 pulled
 *   down: it follows the 步距, so changing the 步距 moves the rail.
 *
 * The first entry of the returned set is also what a deckless top lift carries as
 * its 架顶栏杆.
 */
export function guardrailsFor(count: number, liftHeight: number): ReadonlyArray<{
  id: string
  label: string
  centreAboveDeck: number
}> {
  const clamped = Math.max(1, Math.min(GUARDRAILS.length, Math.round(count)))
  return clamped === 1
    ? [{ id: 'centre', label: '栏杆', centreAboveDeck: liftHeight / 2 }]
    : GUARDRAILS
}

/**
 * 顶层立柱的固定延伸长度: the 立杆 rises this much above the TOP 作业层. It is what
 * turns a 作业层 count into a 搭设高度 — `理论搭设高度 = 0.3 + 步距 × 作业层数` — and it
 * is a fixed field dimension, not a start offset (the first 作业层 is a full 步距 up).
 */
export const TOP_POST_EXTENSION = 0.3

/**
 * The field-confirmed 钢笆片: a real 0.95 m × 1.2 m panel. It is laid with its
 * 0.95 m side across the 排距 and its 1.2 m side along the scaffold, so a bay takes
 * `ceil(bayLength / 1.2)` whole pieces.
 */
export const DECK_PANEL = { width: 0.95, length: 1.2 } as const

/** The deck surface is drawn a little above the lift axis. */
const DECK_SURFACE_OFFSET = 0.055

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
 * 槽钢 counts for the material list. The app estimates materials only — it does
 * not procure — so it records how many pieces and how long, not the section
 * properties of a particular supplier's stock.
 */
export type ChannelSteelSummary = {
  count: number
  lengthPerPiece: number
  totalLength: number
}

export type MaterialResult = {
  theoreticalLength: number
  actualLength: number
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
  /**
   * Guardrail tubes — side rails, the 架顶栏杆 and any 端部防护 returns. JGJ
   * 130-2011 §4.1.2 classifies 栏杆 as 构配件 (accessory), separate from
   * 架体结构自重, and 定额 practice takes it off as its own line. The tube is still
   * ordinary stock, so this is a breakdown of what is already inside
   * `stockSummary`; the material list shows it only as part of the standard
   * pipes, never as a separate quantity.
   */
  guardrail: {
    sides: number
    /** Rails per guarded side: 1 = 上栏杆, 2 = 上栏杆 + 中栏杆. */
    railCount: number
    runs: number
    /** Runs that return across an open scaffold end (端部防护). */
    endRuns: number
    totalLength: number
  }
  channelSteel: ChannelSteelSummary
  /**
   * What the height model produced, so the UI can state it without re-deriving it:
   * `theoretical` is 0.3 + 步距 × 作业层数 (the row against the building), `outer`/
   * `inner` are those two rows AFTER the standard-tube assembly.
   */
  postHeights: {
    theoretical: number
    inner: number
    outer: number
  }
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
  // 5 作业层 → 理论搭设高度 0.3 + 1.88 × 5 = 9.7 m.
  layerCount: 5,
  // 排距 (the post-row spacing the 横向杆 spans). It is deliberately narrower than
  // the 1.2 m site tube used for the transverse members: that tube is what
  // overhangs the two 立杆, so no `tubeEndExtension` is added to it.
  width: 0.9,
  deckSupportRailCount: 2,
  postSpacing: 1.8,
  // The 步距 is a site constant; `layerCount` is what sets the height.
  liftHeight: 1.88,
  sweepBarHeight: 0.2,
  guardrailSides: 1,
  // A site that only builds the 上栏杆 is the common case, so 1 is the default and
  // the 中栏杆 is opt-in (§7.3.12(4)).
  guardrailRailCount: 1,
  tubeEndExtension: 0.1,
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
  { id: 'brace', label: '剪刀撑', unit: '根' },
  { id: 'bindingWire', label: '扎丝', unit: '捆' },
  { id: 'padPlate', label: '小垫板', unit: '块' },
  { id: 'formwork', label: '支模板', unit: 'm²' },
]

/** Couplers are counted one by one but bought by the 包 (30 to a bag). */
export const COUPLER_PACK_SIZE = 30

/**
 * Keys for the manual quantity corrections a user can apply on top of the
 * calculated bill of materials. Kept in the domain so the view, the stored
 * project and the CSV export always agree on the same key.
 */
export const MATERIAL_KEYS = {
  stock: (length: string) => `stock:${length}`,
  connector: (type: ConnectorType) => `connector:${type}`,
  channel: 'channel',
  deck: 'deck',
  pending: (id: string) => `pending:${id}`,
} as const

/**
 * Manual corrections keyed by `MATERIAL_KEYS`, stored as a DELTA on the
 * calculated quantity rather than an absolute override: changing a parameter
 * keeps flowing through the calculation, with the user's correction still on top
 * of it, instead of the corrected number silently going stale.
 */
export type MaterialAdjustments = Record<string, number>

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

/**
 * Physical length of the tube actually bought for a member: the chosen stock
 * combination, less the length each butt joint swallows. Used by both the pipe
 * assembly and the 槽钢 base beam, which is laid to the same length as the
 * transverse tube above it.
 */
function assembledLength(requiredLength: number, stockLengths: number[], requestedOverlap: number) {
  const overlap = Math.max(0, Math.min(requestedOverlap, Math.min(...stockLengths) * 0.8))
  const selectedStocks = chooseStockLengths(requiredLength, stockLengths, overlap)
  return round(
    selectedStocks.reduce((sum, stock) => sum + stock, 0) - overlap * (selectedStocks.length - 1),
  )
}

function createPipeAssembly(
  member: ScaffoldMember,
  stockLengths: number[],
  requestedOverlap: number,
): { segments: PipeSegment[]; connectors: ScaffoldConnector[]; plan: PipeAssemblyPlan } {
  const minimumStock = Math.min(...stockLengths)
  const overlap = Math.max(0, Math.min(requestedOverlap, minimumStock * 0.8))
  const selectedStocks = chooseStockLengths(member.length, stockLengths, overlap)
  const effectiveLength = assembledLength(member.length, stockLengths, requestedOverlap)
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

/** Rails per guarded side, clamped to the modelled set (上栏杆 / 上栏杆 + 中栏杆). */
function guardrailRailCountOf(parameters: ScaffoldParameters) {
  const requested = parameters.guardrailRailCount ?? DEFAULT_PARAMETERS.guardrailRailCount
  return Math.max(1, Math.min(GUARDRAILS.length, Math.round(requested)))
}

function calculateMaterials(
  members: ScaffoldMember[],
  pipeSegments: PipeSegment[],
  decks: DeckPanel[],
  connectors: ScaffoldConnector[],
  baseChannels: BaseChannel[],
  parameters: ScaffoldParameters,
  assemblyPlans: PipeAssemblyPlan[],
  postHeights: MaterialResult['postHeights'],
): MaterialResult {
  const theoreticalLength = round(members.reduce((sum, member) => sum + member.length, 0))
  const actualLength = round(pipeSegments.reduce((sum, segment) => sum + segment.stockLength, 0))
  const stockSummary = pipeSegments.reduce<Record<string, number>>((summary, segment) => {
    const key = `${segment.stockLength}m`
    summary[key] = (summary[key] ?? 0) + 1
    return summary
  }, {})

  return {
    theoreticalLength,
    actualLength,
    usedLength: theoreticalLength,
    wasteLength: round(actualLength - theoreticalLength),
    utilization: actualLength ? round((theoreticalLength / actualLength) * 100, 1) : 0,
    stockSummary,
    connectorSummary: {
      cross: connectors.filter((connector) => connector.type === 'cross').length,
      butt: connectors.filter((connector) => connector.type === 'butt').length,
      swivel: null,
    },
    // 槽钢 is bought by the piece, so report the piece count and the run length
    // rather than folding it into the tube figures.
    channelSteel: {
      count: baseChannels.length,
      lengthPerPiece: baseChannels.length ? round(baseChannels[0].length) : 0,
      totalLength: round(baseChannels.reduce((sum, channel) => sum + channel.length, 0)),
    },
    postHeights,
    // A breakdown of tube already inside stockSummary, not an extra quantity.
    guardrail: (() => {
      const rails = members.filter((member) => member.type === 'guardrail')
      // A run is an end return if it is as long as the scaffold is wide.
      const endRuns = rails.filter((member) => Math.abs(member.length - parameters.width) < 0.5).length
      return {
        sides: Math.max(0, Math.min(2, Math.round(parameters.guardrailSides))),
        railCount: guardrailRailCountOf(parameters),
        runs: rails.length,
        endRuns,
        totalLength: round(rails.reduce((sum, member) => sum + member.length, 0)),
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
  const legacyParameters = parameters as ScaffoldParameters & { rowCount?: number; height?: number }
  parameters = {
    ...DEFAULT_PARAMETERS,
    ...parameters,
    deckSupportRailCount: parameters.deckSupportRailCount ?? legacyParameters.rowCount ?? DEFAULT_PARAMETERS.deckSupportRailCount,
    // A stored project from before `layerCount` carried a continuous 搭设高度; take the
    // number of whole 步距 that height held.
    layerCount: parameters.layerCount ?? (legacyParameters.height === undefined
      ? DEFAULT_PARAMETERS.layerCount
      : Math.max(1, Math.round((legacyParameters.height - TOP_POST_EXTENSION) / (parameters.liftHeight || DEFAULT_PARAMETERS.liftHeight)))),
  }
  const physical = getPhysicalPoints(points, segmentLengths)
  const members: ScaffoldMember[] = []
  const decks: DeckPanel[] = []
  const baseChannels: BaseChannel[] = []
  const warnings: LayoutWarning[] = []
  const postByPoint = new Map<string, ScaffoldMember>()
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
    if (length <= 0.001) return undefined
    const member: ScaffoldMember = {
      id: `M${memberSequence++}`,
      type,
      start: physicalStart,
      end: physicalEnd,
      connectionPoints,
      length,
      layer,
      pathSegment,
    }
    members.push(member)
    return member
  }

  // 作业层数 is what the user sets; every height follows from it, so the scaffold
  // grows in whole 步距 and nothing has to be squeezed to fill a leftover:
  //   T (理论搭设高度) = TOP_POST_EXTENSION + liftHeight × layerCount
  // 作业层 k sits at k × liftHeight — the FIRST one is a full 步距 above the base —
  // and `TOP_POST_EXTENSION` (0.3 m) is the 立杆's fixed extension above the TOP
  // 作业层, not a start offset.
  //
  // The two rows are NOT the same height. Only a row that carries 防护栏杆 needs the
  // extra 步距 (and its own 0.3 m) above the top 作业层 to tie those rails to: the
  // 内侧 row is normally the one against the building, so it stops at T while the
  // 外侧 row runs to T + liftHeight + TOP_POST_EXTENSION. Both are then built from
  // standard tubes, so the post actually bought is never shorter than that.
  const postRowCount = 2
  const guardrailSideCount = Math.max(0, Math.min(postRowCount, Math.round(parameters.guardrailSides)))
  const guardrailRailCount = guardrailRailCountOf(parameters)
  const guardrails: ReturnType<typeof guardrailsFor> = guardrailsFor(guardrailRailCount, parameters.liftHeight)
  const layerCount = Math.max(1, Math.round(parameters.layerCount ?? DEFAULT_PARAMETERS.layerCount))
  const theoreticalHeight = round(TOP_POST_EXTENSION + layerCount * parameters.liftHeight)
  const topLiftElevation = round(layerCount * parameters.liftHeight)
  const railedHeight = round(theoreticalHeight + parameters.liftHeight + TOP_POST_EXTENSION)
  const rowCarriesRails = (row: number) => (row === 0 ? guardrailSideCount >= 1 : guardrailSideCount >= 2)
  /**
   * The 立杆 height at one station. A post is built to the railed height when it
   * carries 防护栏杆: its row's own side rails, or — at an OPEN path end — the 端部防护
   * return, whose two posts both stand on the outside of the scaffold even when one
   * of them belongs to the inner row (nothing is against a wall at an end).
   */
  const postHeightAt = (row: number, atOpenEnd: boolean) =>
    rowCarriesRails(row) || (atOpenEnd && guardrailSideCount >= 1) ? railedHeight : theoreticalHeight
  /** The shortest post of a row: what that row's side rails must be able to tie to. */
  const rowTopEdge = (row: number) =>
    assembledLength(
      rowCarriesRails(row) ? railedHeight : theoreticalHeight,
      parameters.stockLengths,
      parameters.spliceOverlap,
    )
  /** An open end's two posts are both railed, so a return is tied to the railed height. */
  const endTopEdge = assembledLength(railedHeight, parameters.stockLengths, parameters.spliceOverlap)
  const sweepElevation = parameters.sweepBarHeight > 0 && parameters.sweepBarHeight < parameters.liftHeight
    ? round(parameters.sweepBarHeight)
    : 0
  // A closed path shares its first and last point, so it has no 临空 end.
  const pathIsClosed = physical.length > 2 &&
    Math.hypot(physical[0][0] - physical[physical.length - 1][0], physical[0][1] - physical[physical.length - 1][1]) < 0.01

  // The 横向杆 is a 1.2 m site tube with NO `tubeEndExtension`: the 排距 is narrower,
  // so the tube overhangs both 立杆 by half the surplus (createPipeAssembly centres
  // the excess). The 槽钢 base beam is laid to the same length as that tube.
  const transverseTubeLength = assembledLength(
    parameters.width,
    parameters.stockLengths,
    parameters.spliceOverlap,
  )

  /** Rails a row cannot reach — reported once, after every segment is walked. */
  const railsAboveRow = [new Set<string>(), new Set<string>()]
  /** 端部防护 returns, which need BOTH rows to reach the rail. */
  const railsAboveEnd = new Set<string>()
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

    // 端部防护: an end that is not closed off is itself a 临边 (JGJ 80-2016 §4.1.1,
    // 强制性条文). Both posts at such a station belong to the OUTSIDE of the scaffold
    // — nothing is against a wall at an end — so both are built to the railed height
    // and the return rail can be tied across them.
    const endStations: number[] = []
    if (!pathIsClosed && segmentIndex === 0) endStations.push(0)
    if (!pathIsClosed && segmentIndex === physical.length - 2) endStations.push(bayCount)

    for (let station = 0; station <= bayCount; station += 1) {
      const atOpenEnd = endStations.includes(station)
      for (let row = 0; row < postRowCount; row += 1) {
        const offset = row * parameters.width
        const point: Vector3Tuple = [
          round(start2d[0] + direction[0] * bayLength * station + normal[0] * offset),
          0,
          round(start2d[1] + direction[1] * bayLength * station + normal[1] * offset),
        ]
        postRows[row].push(point)
        const key = pointKey(point)
        const post = postHeightAt(row, atOpenEnd)
        const existingPost = postByPoint.get(key)
        if (existingPost) {
          // A shared corner can be the railed row of one path segment and the plain
          // row of another: the taller post is the one that gets built.
          if (existingPost.end[1] < post) {
            existingPost.end = [existingPost.start[0], post, existingPost.start[2]]
            existingPost.connectionPoints = [existingPost.start, existingPost.end]
            existingPost.length = round(post - existingPost.start[1])
          }
        } else {
          const member = addMember(
            'post',
            point,
            [point[0], post, point[2]],
            undefined,
            segmentIndex,
            [point, [point[0], post, point[2]]],
            0,
            0,
          )
          if (member) postByPoint.set(key, member)
        }
      }

      // 槽钢 base beam: one piece under each pair of posts, running in the same
      // direction as the transverse members and cut to the same length as the
      // transverse tube above it, so the two stay aligned. Deduplicated by post
      // pair so a shared path corner does not produce two identical beams.
      const outerBase = postRows[0][station]
      const innerBase = postRows[1][station]
      const channelKey = [pointKey(outerBase), pointKey(innerBase)].sort().join('|')
      if (!channelKeys.has(channelKey)) {
        channelKeys.add(channelKey)
        const channelCentre: Vector3Tuple = [
          round((outerBase[0] + innerBase[0]) / 2),
          0,
          round((outerBase[2] + innerBase[2]) / 2),
        ]
        const half = transverseTubeLength / 2
        const channelStart: Vector3Tuple = [
          round(channelCentre[0] - normal[0] * half),
          0,
          round(channelCentre[2] - normal[1] * half),
        ]
        const channelEnd: Vector3Tuple = [
          round(channelCentre[0] + normal[0] * half),
          0,
          round(channelCentre[2] + normal[1] * half),
        ]
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
          // No 管端外伸 here: the bought tube is longer than the 排距 on its own, and
          // the assembly centres that surplus so the rod overhangs both posts.
          0,
          0,
        )
      })

      // 作业层 protection. These are ADDITIONAL members, never a substitute for the
      // ordinary longitudinal rows: JGJ 130-2011 §4.1.2 puts 栏杆 in 构配件自重, a
      // different bucket from 架体结构自重.
      //
      // A decked lift is a 作业层 and gets its rails; a deckless lift gets only the
      // two normal longitudinal rows — except the top lift, which always carries the
      // 架顶栏杆, i.e. the first rail of the selected set.
      const guardedRails = withDeck
        ? guardrails
        : layer === layerCount ? [guardrails[0]] : []

      /**
       * The rails of this lift that `rowTop` can actually carry. A rail is tied to
       * the 立杆, so one reaching past that post's top is not emitted at all — it
       * would float in the air — and is recorded in `above` for a single report.
       */
      const railsWithin = (
        rowTop: number,
        above: Set<string>,
      ): Array<{ rail: (typeof guardrails)[number]; elevation: number }> => {
        const usable: Array<{ rail: (typeof guardrails)[number]; elevation: number }> = []
        for (const rail of guardedRails) {
          const railElevation = round(elevation + rail.centreAboveDeck)
          if (round(railElevation + parameters.pipeDiameter / 2) > rowTop + 0.001) {
            above.add(rail.label)
            continue
          }
          // A short 步距 can drop a rail onto the next lift's longitudinal member;
          // never emit two coincident tubes.
          if (layer < layerCount && Math.abs(railElevation - round(elevation + parameters.liftHeight)) < 0.05) {
            continue
          }
          usable.push({ rail, elevation: railElevation })
        }
        return usable
      }

      if (guardrailSideCount > 0 && guardedRails.length > 0) {
        for (let side = 0; side < guardrailSideCount; side += 1) {
          // Side 0 is the outer row, which is the one the standard mandates.
          const rowIndex = side === 0 ? 0 : postRowCount - 1
          const row = postRows[rowIndex]
          for (const { elevation: railElevation } of railsWithin(rowTopEdge(rowIndex), railsAboveRow[rowIndex])) {
            const points = row.map((point) => [point[0], railElevation, point[2]] as Vector3Tuple)
            addMember('guardrail', points[0], points[points.length - 1], layer, segmentIndex, points)
          }
        }

        // 端部防护 returns across an open end. Both of that station's posts are built to
        // the railed height (nothing is against a wall at an end), so the return is
        // checked against that height rather than against the shorter inner row.
        for (const { elevation: railElevation } of railsWithin(endTopEdge, railsAboveEnd)) {
          for (const station of endStations) {
            const outerPoint = postRows[0][station]
            const innerPoint = postRows[1][station]
            const start: Vector3Tuple = [outerPoint[0], railElevation, outerPoint[2]]
            const end: Vector3Tuple = [innerPoint[0], railElevation, innerPoint[2]]
            addMember('guardrail', start, end, layer, segmentIndex, [start, end])
          }
        }
      }

      if (!withDeck) return

      // 钢笆片 are real 0.95 × 1.2 m panels: the 0.95 m side spans the 排距, the
      // 1.2 m side runs along the bay. A bay is covered by whole pieces, so the
      // count the material list reports is the number of pieces actually laid —
      // while `deckArea` stays the geometric area covered, which a cut piece at the
      // end of a bay cannot exceed.
      const deckElevation = round(elevation + DECK_SURFACE_OFFSET)
      const panelsAlong = Math.max(1, Math.ceil(bayLength / DECK_PANEL.length))
      const panelsAcross = Math.max(1, Math.ceil(parameters.width / DECK_PANEL.width))

      for (let bay = 0; bay < bayCount; bay += 1) {
        /** A point on the bay: `along` 0..1 down the bay, `across` 0..1 between the rows. */
        const at = (along: number, across: number): Vector3Tuple => {
          const outerStart = postRows[0][bay]
          const outerEnd = postRows[0][bay + 1]
          const innerStart = postRows[1][bay]
          const innerEnd = postRows[1][bay + 1]
          const outerX = outerStart[0] + (outerEnd[0] - outerStart[0]) * along
          const outerZ = outerStart[2] + (outerEnd[2] - outerStart[2]) * along
          const innerX = innerStart[0] + (innerEnd[0] - innerStart[0]) * along
          const innerZ = innerStart[2] + (innerEnd[2] - innerStart[2]) * along
          return [
            round(outerX + (innerX - outerX) * across),
            deckElevation,
            round(outerZ + (innerZ - outerZ) * across),
          ]
        }

        for (let along = 0; along < panelsAlong; along += 1) {
          for (let across = 0; across < panelsAcross; across += 1) {
            const s0 = along / panelsAlong
            const s1 = (along + 1) / panelsAlong
            const a0 = across / panelsAcross
            const a1 = (across + 1) / panelsAcross
            decks.push({
              id: `D${decks.length + 1}`,
              corners: [at(s0, a0), at(s1, a0), at(s1, a1), at(s0, a1)],
              area: round((bayLength / panelsAlong) * (parameters.width / panelsAcross)),
              layer,
              pathSegment: segmentIndex,
            })
          }
        }
      }
    }

    // 扫地杆 layer. It gets ordinary transverse + longitudinal members only:
    // there is no deck here, so no deck-support rails and no edge protection.
    if (sweepElevation > 0) {
      addHorizontalBand(sweepElevation, SWEEP_BAR_LAYER, normalRows, false)
    }

    for (let layer = 1; layer <= layerCount; layer += 1) {
      // Every 作业层 is exactly `layer × liftHeight` above the base: the first one is
      // a full 步距 up, and `TOP_POST_EXTENSION` is the 立杆 extension above the TOP
      // one rather than a start offset.
      const elevation = round(layer * parameters.liftHeight)
      const withDeck = layer % Math.max(1, Math.round(parameters.deckLiftInterval)) === 0
      // A decked lift is a 作业层 and gets its rails; a deckless lift gets only the
      // two normal longitudinal rows — except the top lift, which always carries
      // the 架顶栏杆 that carries the top of the scaffold.
      addHorizontalBand(elevation, layer, withDeck ? supportRows : normalRows, withDeck)
    }

    if (bayLength < parameters.postSpacing * 0.55) {
      warnings.push({
        id: `short-bay-${segmentIndex}`,
        message: `第 ${segmentIndex + 1} 段末跨仅 ${bayLength.toFixed(2)}m，请复核立杆间距。`,
      })
    }
  })

  // A rail the 立杆 cannot reach was dropped rather than floated. The 内侧 row is the
  // short one on purpose (it is the row against the building), so an open end's top
  // return is the usual thing to go missing — say which rail, where, and what fixes it.
  if (railsAboveRow[0].size > 0 || railsAboveRow[1].size > 0 || railsAboveEnd.size > 0) {
    const parts: string[] = []
    if (railsAboveRow[0].size > 0) {
      parts.push(`外排立杆（顶 ${rowTopEdge(0)} m）固定不了${[...railsAboveRow[0]].join('、')}`)
    }
    if (railsAboveRow[1].size > 0) {
      parts.push(`内排立杆（顶 ${rowTopEdge(1)} m）固定不了${[...railsAboveRow[1]].join('、')}`)
    }
    if (railsAboveEnd.size > 0) {
      parts.push(`开口端端柱（顶 ${endTopEdge} m）固定不了折返栏杆${[...railsAboveEnd].join('、')}`)
    }
    warnings.push({
      id: 'top-rail-height',
      message: `顶层作业层 ${topLiftElevation} m：${parts.join('；')}，该处栏杆未设置。内侧按靠墙处理只到理论高度 ${theoreticalHeight} m（只有开口端的两根端柱与外排同高），若该端临空，请把「防护栏杆侧数」设为 2 让内排整排同步加高。`,
    })
  }

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
    const verticalOffset = member.type === 'transverse'
      ? -parameters.pipeDiameter * 0.65
      : parameters.pipeDiameter * 0.65

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
    materials: calculateMaterials(
      members,
      pipeSegments,
      decks,
      connectors,
      baseChannels,
      parameters,
      assemblyPlans,
      {
        theoretical: theoreticalHeight,
        inner: round(rowTopEdge(1)),
        outer: round(rowTopEdge(0)),
      },
    ),
  }
}

export function countMembers(layout: ScaffoldLayout) {
  return layout.members.reduce<Record<MemberType, number>>(
    (counts, member) => ({ ...counts, [member.type]: counts[member.type] + 1 }),
    { post: 0, longitudinal: 0, transverse: 0, guardrail: 0 },
  )
}