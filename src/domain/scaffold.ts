import { resolveTopology } from './rules/topology.ts'
import { roundDomain as round } from './rules/facts/precision.ts'
import { normalizeKernelParameters } from './rules/boundaries/parameters.ts'
export { materialQuantity, materialAdjustmentStep, stockMaterialRows } from './rules/boundaries/adjustments.ts'
import { calculateMaterials } from './rules/materials.ts'
export { calculateMaterials } from './rules/materials.ts'
import { calculateConnections } from './rules/connections.ts'
import { CONNECTOR_CONTACT } from './rules/facts/connections.ts'
import { chooseStockLengths, neighbourStockSequence, assembledLength, postStocks, postStockWarnings } from './rules/policies/stock.ts'
import { assembleStockStage } from './rules/stock.ts'
import { mergeMemberStage } from './rules/sharedMembers.ts'
import { MEMBER_USES, makeUse, combineUses, memberUses, transformUses, type MemberPurpose } from './rules/facts/memberUses.ts'
import { drawingPaths, measurePath, PIXELS_PER_METER, type PlanDrawing } from './plan.ts'
import { fitGuardrailStock } from './guardrails.ts'
import { signedArea, subtractCoverage, type PlanPolygon } from './polygons.ts'

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
  /** 排距 — the distance between the two post rows. */
  width: number
  deckSupportRailCount: number
  postSpacing: number
  liftHeight: number
  /** Height of the 扫地杆 (sweep-bar) layer above the base. */
  sweepBarHeight: number
  /**
   * Which row of the drawn path faces the building. `false` (the default) puts the
   * 内侧 on the row offset by the 排距 — the path itself is then the 外立杆 line the
   * tape was run along; `true` swaps the two, for a path drawn along the wall.
   *
   * 防护栏杆 always sit on the 外排, and it is that row which is built one 步距
   * taller; there is no parameter that adds a second guarded side, because the row
   * against the building is regulated as a gap to it (§7.3.12(1)).
   */
  swapInnerOuter: boolean
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
  /** 钢笆片 length ALONG the scaffold: 1 or 1.2 m. */
  deckPanelLength: number
  /** 钢笆片 width ACROSS the 排距: 0.75 / 0.8 / 0.95 m. */
  deckPanelWidth: number
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
 * 立杆对接接头错开的距离 (JGJ 130-2011 §6.3.6: 两根相邻立杆的接头不应设置在同步内,
 * 错开不宜小于 500 mm). Two neighbouring posts are assembled from DIFFERENT stock
 * sequences so no two joints land at the same height; see `postStockSequence`.
 */
export const SPLICE_STAGGER = 0.5

/**
 * The 钢笆片 sizes the field stocks. Defaults, not constants: a site picks one of
 * each (`deckPanelLength` / `deckPanelWidth`), and the 排距 then defaults to the
 * chosen width less 0.05 m, so the panel spans the two rows with a little margin.
 */
export const DECK_PANEL_SIZES = { lengths: [1, 1.2], widths: [0.75, 0.8, 0.95] } as const
export const DECK_PANEL = { width: 0.75, length: 1 } as const
/** 排距 when a 钢笆片 width is chosen: the panel width less this. */
export const DECK_PANEL_ROW_GAP = 0.05
/**
 * Where two 钢笆片 meet, the field laps them by 100 mm and ties the lap down, so each
 * piece after the first only gains `panelLength - DECK_PANEL_LAP` of new ground.
 */
export const DECK_PANEL_LAP = 0.1

/** How many panels cover `run` once every joint is lapped by `DECK_PANEL_LAP`. */
export function deckPanelCount(run: number, panel: number, lap = DECK_PANEL_LAP) {
  const gain = Math.max(0.05, panel - lap)
  return Math.max(1, Math.ceil((run - lap) / gain - 1e-9))
}

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
  [MEMBER_USES]?: import('./rules/facts/memberUses.ts').MemberUse[]
  id: string
  type: MemberType
  start: Vector3Tuple
  end: Vector3Tuple
  connectionPoints: Vector3Tuple[]
  length: number
  layer?: number
  pathSegment?: number
  /** Shared physical run can serve both longitudinal and transverse roles. */
  roles?: MemberType[]
  /** Incoming segment indices of actual mitre replacements at this post. */
  cornerJunctions?: number[]
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
  /** Visible, non-overlapping cut faces belonging to this one purchased panel. */
  coverage?: Vector3Tuple[][]
  area: number
  layer: number
  pathSegment: number
}

export type ScaffoldConnector = {
  [CONNECTOR_CONTACT]?: Vector3Tuple
  id: string
  type: ConnectorType
  position: Vector3Tuple
  memberId: string
  /** Tube axes used to orient the simplified fitting, independent of the camera. */
  axis: Vector3Tuple
  secondaryAxis?: Vector3Tuple
  connectedMemberId?: string
}

/** Model dimensions for the 10# 槽钢 base beam, in metres. */
export const BASE_CHANNEL_HEIGHT = 0.1
export const BASE_CHANNEL_WIDTH = 0.048

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

export type PathDimension = {
  index: number
  labelIndex?: string
  length: number
  start: Vector3Tuple
  end: Vector3Tuple
  labelPosition: Vector3Tuple
}

export type ScaffoldLayout = {
  /** Measured path only: an open path has no implied closing edge. */
  pathDimensions: PathDimension[]
  perimeter: number
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
  // Default row spacing and panel width are both 0.75 m. The three support
  // rows include the two post rows and one intermediate deck-support rail.
  width: 0.75,
  deckSupportRailCount: 3,
  postSpacing: 1.8,
  // The 步距 is a site constant; `layerCount` is what sets the height.
  liftHeight: 1.88,
  sweepBarHeight: 0.2,
  // The path itself is the 外立杆 line by default: the 内侧 is the row offset by the
  // 排距, which is where the building is.
  swapInnerOuter: false,
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
  deckPanelLength: DECK_PANEL.length,
  deckPanelWidth: DECK_PANEL.width,
  pipeDiameter: 0.048,
  stockLengths: [6, 5, 4.5, 4, 3.5, 3, 2.4, 2, 1.2, 0.8],
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
    const actualLength = Math.max(0.1, lengths[index] ?? visualLength / PIXELS_PER_METER)
    const previous = physical[index]
    physical.push([
      round(previous[0] + (dx / visualLength) * actualLength),
      round(previous[1] + (dy / visualLength) * actualLength),
    ])
  }
  return physical
}

export function scaffoldTransverseLength(parameters: ScaffoldParameters) {
  return assembledLength(parameters.width, parameters.stockLengths, parameters.spliceOverlap)
}

/** Panels in the bay between two existing end stations, with no extra posts. */
export function deckBetweenStations(start: [Vector3Tuple, Vector3Tuple], end: [Vector3Tuple, Vector3Tuple],
  layer: number, pathSegment: number, id: string, parameters: ScaffoldParameters): DeckPanel[] {
  const length = vectorDistance(start[0], end[0]), width = vectorDistance(start[0], start[1])
  const along = deckPanelCount(length, Math.max(0.1, parameters.deckPanelLength))
  const across = deckPanelCount(width, Math.max(0.1, parameters.deckPanelWidth))
  const point = (s: number, t: number): Vector3Tuple => [0, 1, 2].map(axis => round(
    start[0][axis] + (end[0][axis] - start[0][axis]) * s + (start[1][axis] - start[0][axis]) * t
      + (axis === 1 ? DECK_SURFACE_OFFSET : 0), 6)) as Vector3Tuple
  return Array.from({ length: along * across }, (_, index) => {
    const s = Math.floor(index / across), t = index % across
    return { id: `${id}-${index + 1}`, layer, pathSegment, area: round(length * width / (along * across)),
      corners: [point(s / along, t / across), point((s + 1) / along, t / across),
        point((s + 1) / along, (t + 1) / across), point(s / along, (t + 1) / across)] }
  })
}

/** Rails per guarded side, clamped to the modelled set (上栏杆 / 上栏杆 + 中栏杆). */
function guardrailRailCountOf(parameters: ScaffoldParameters) {
  const requested = parameters.guardrailRailCount ?? DEFAULT_PARAMETERS.guardrailRailCount
  return Math.max(1, Math.min(GUARDRAILS.length, Math.round(requested)))
}

/** Co-linear runs are one design member, including a straight drawing split. */

/** One panel can have several cut faces; it is still bought/counts only once. */
function resolveDeckCoverage(decks: DeckPanel[], path: Array<[number, number]>, closed: boolean) {
  if (!decks.length) return
  const firstLayer = Math.min(...decks.map(deck => deck.layer))
  const templates = decks.filter(deck => deck.layer === firstLayer)
  const plan = (deck: DeckPanel): PlanPolygon => deck.corners.map(p => [p[0], p[2]])
  const key = (deck: DeckPanel) => `${deck.pathSegment}:${plan(deck).map(p => p.join(',')).join('|')}`
  const raw = templates.map(plan)
  const faces = new Map<string, PlanPolygon[]>()
  const covered: PlanPolygon[] = []
  // At an ordinary inside corner the incoming leg owns the common square.
  // Applying this locally first makes the result independent of the closed seam.
  templates.forEach((deck, index) => {
    const previous = (deck.pathSegment + path.length - 2) % (path.length - 1)
    const cutters = (closed || deck.pathSegment > 0)
      ? templates.flatMap((other, i) => other.pathSegment === previous ? [raw[i]] : []) : []
    const remaining = subtractCoverage(subtractCoverage([raw[index]], cutters), covered)
    faces.set(key(deck), remaining)
    covered.push(...remaining)
  })
  // Recover regions involved in cyclic/multiple overlaps exactly once. This also
  // handles a narrow U without holes or guessing a fractional panel quantity.
  templates.forEach((deck, index) => {
    const remaining = subtractCoverage([raw[index]], covered)
    faces.get(key(deck))!.push(...remaining)
    covered.push(...remaining)
  })
  const kept = decks.flatMap(deck => {
    const polygons = faces.get(key(deck))!
    const area = polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon)), 0)
    if (area < 1e-7) return []
    return [{ ...deck, area: round(area, 9), coverage: polygons.map(polygon => polygon.map(([x, z]) => [x, deck.corners[0][1], z] as Vector3Tuple)) }]
  })
  decks.splice(0, decks.length, ...kept)
}

export function calculateScaffold(
  points: Point2D[],
  segmentLengths: number[],
  parameters: ScaffoldParameters,
  localLifts?: readonly number[],
  deckLayerOffset = 0,
  segmentLayerCounts?: readonly number[],
  requiredEndPairs: readonly (readonly [boolean, boolean])[] = [],
): ScaffoldLayout {
  parameters = normalizeKernelParameters(parameters)
  const physical = getPhysicalPoints(points, segmentLengths)
  const members: ScaffoldMember[] = []
  const decks: DeckPanel[] = []
  const baseChannels: BaseChannel[] = []
  const warnings: LayoutWarning[] = []
  warnings.push(...postStockWarnings(parameters))
  const postByPoint = new Map<string, ScaffoldMember>()
  const channelKeys = new Set<string>()
  let memberSequence = 1
  const memberByGeometry = new Map<string, ScaffoldMember>()

  const addMember = (
    type: MemberType,
    start: Vector3Tuple,
    end: Vector3Tuple,
    layer?: number,
    pathSegment?: number,
    connectionPoints: Vector3Tuple[] = [start, end],
    startExtension = parameters.tubeEndExtension,
    endExtension = parameters.tubeEndExtension,
    purpose: MemberPurpose = type === 'guardrail' ? 'side-guard' : type,
  ) => {
    const [physicalStart, physicalEnd] = extendLine(start, end, startExtension, endExtension)
    const length = round(vectorDistance(physicalStart, physicalEnd))
    if (length <= 0.001) return undefined
    const geometryKey = `${type}:${layer}:${[pointKey(physicalStart), pointKey(physicalEnd)].sort().join('|')}`
    const shared = memberByGeometry.get(geometryKey)
    const use = makeUse(pathSegment ?? 0, purpose, physicalStart, physicalEnd, type === 'post' ? 'M01' : type === 'guardrail' ? 'P02' : 'M03')
    if (shared) { shared[MEMBER_USES] = combineUses(memberUses(shared), [use]); return shared }
    const member: ScaffoldMember = {
      id: `M${memberSequence++}`,
      [MEMBER_USES]: [use],
      type,
      start: physicalStart,
      end: physicalEnd,
      connectionPoints,
      length,
      layer,
      pathSegment,
    }
    members.push(member)
    memberByGeometry.set(geometryKey, member)
    return member
  }

  // 作业层数 is what the user sets; every height follows from it, so the scaffold
  // grows in whole 步距 and nothing has to be squeezed to fill a leftover:
  //   T (理论搭设高度) = TOP_POST_EXTENSION + liftHeight × layerCount
  // 作业层 k sits at k × liftHeight — the FIRST one is a full 步距 above the base —
  // and `TOP_POST_EXTENSION` (0.3 m) is the 立杆's fixed extension above the TOP
  // 作业层, not a start offset.
  //
  // The two rows are NOT the same height. Only the 外排 carries 防护栏杆, and only it
  // needs the extra 步距 (and its own 0.3 m) above the top 作业层 to tie those rails
  // to: the 内排 is the row against the building and stops at T. Both are then built
  // from standard tubes, so the post actually bought is never shorter than that.
  const postRowCount = 2
  const guardrailRailCount = guardrailRailCountOf(parameters)
  const guardrails: ReturnType<typeof guardrailsFor> = guardrailsFor(guardrailRailCount, parameters.liftHeight)
  const layerCount = Math.max(1, Math.round(parameters.layerCount ?? DEFAULT_PARAMETERS.layerCount))
  const liftElevation = (layer: number) => localLifts?.[layer - 1] ?? round(layer * parameters.liftHeight)
  const topLiftElevation = liftElevation(layerCount)
  const theoreticalHeight = round(TOP_POST_EXTENSION + topLiftElevation)
  const railedHeight = round(theoreticalHeight + parameters.liftHeight + TOP_POST_EXTENSION)
  // Which row of the drawing is which. The path is the 外立杆 line unless the user
  // says the building is on that side (`swapInnerOuter`), and ONLY the 外排 is railed.
  const outerRow = parameters.swapInnerOuter ? 1 : 0
  const innerRow = outerRow === 0 ? 1 : 0
  const rowCarriesRails = (row: number) => row === outerRow
  /**
   * The 立杆 height at one station. A post is built to the railed height when it
   * carries 防护栏杆: the 外排's own side rails, or — at an OPEN path end — the 端部防护
   * return, whose two posts both stand on the outside of the scaffold even when one
   * of them belongs to the inner row (nothing is against a wall at an end).
   */
  const layersAt = (index: number) => Math.max(1, Math.round(segmentLayerCounts?.[index] ?? layerCount))
  const theoreticalAt = (index: number) => round(TOP_POST_EXTENSION + liftElevation(layersAt(index)))
  const railedAt = (index: number) => round(theoreticalAt(index) + parameters.liftHeight + TOP_POST_EXTENSION)
  const postHeightAt = (row: number, atOpenEnd: boolean, segmentIndex: number) =>
    rowCarriesRails(row) || atOpenEnd ? railedAt(segmentIndex) : theoreticalAt(segmentIndex)
  /** The shortest post of a row: what that row's side rails must be able to tie to. */
  const rowTopEdge = (row: number) =>
    assembledLength(
      rowCarriesRails(row) ? railedHeight : theoreticalHeight,
      postStocks(parameters),
      parameters.spliceOverlap,
    )
  /** An open end's two posts are both railed, so a return is tied to the railed height. */
  const endTopEdge = assembledLength(railedHeight, postStocks(parameters), parameters.spliceOverlap)
  const sweepElevation = parameters.sweepBarHeight > 0 && parameters.sweepBarHeight < parameters.liftHeight
    ? round(parameters.sweepBarHeight)
    : 0
  // A closed path shares its first and last point, so it has no 临空 end.
  const pathIsClosed = physical.length > 2 &&
    Math.hypot(physical[0][0] - physical[physical.length - 1][0], physical[0][1] - physical[physical.length - 1][1]) < 0.01

  // Validate the measured path separately from local corner construction.
  for (let i = 0; i + 1 < physical.length; i++) for (let j = i + 1; j + 1 < physical.length; j++) {
    const a = physical[i], b = physical[i + 1], c = physical[j], d = physical[j + 1]
    const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - c[0], d[1] - c[1]]
    const cross = (x: number[], y: number[]) => x[0] * y[1] - x[1] * y[0]
    const delta = [c[0] - a[0], c[1] - a[1]], denominator = cross(u, v)
    const adjacent = j === i + 1 || (pathIsClosed && i === 0 && j === physical.length - 2)
    if (Math.abs(denominator) < 1e-8) {
      const length = Math.hypot(...u)
      if (length < 0.001 || Math.abs(cross(delta, u)) / length > 0.001) continue
      const t0 = (delta[0] * u[0] + delta[1] * u[1]) / length
      const t1 = ((d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1]) / length
      if (Math.min(length, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > 0.001) {
        warnings.push({ id: `path-overlap-${i}-${j}`, message: `第 ${i + 1}、${j + 1} 段重叠或原路折返，请调整路径。` })
      }
    } else if (!adjacent) {
      const t = cross(delta, v) / denominator, s = cross(delta, u) / denominator
      if (t >= -1e-8 && t <= 1 + 1e-8 && s >= -1e-8 && s <= 1 + 1e-8) {
        warnings.push({ id: `path-crossing-${i}-${j}`, message: `第 ${i + 1}、${j + 1} 段自交，交叉处构造未建模，请调整路径。` })
      }
    }
  }

  // The 横向杆 is a 1.2 m site tube with NO `tubeEndExtension`: the 排距 is narrower,
  // so the tube overhangs both 立杆 by half the surplus (createPipeAssembly centres
  // the excess). The 槽钢 base beam is laid to the same length as that tube.
  const transverseTubeLength = scaffoldTransverseLength(parameters)

  /** Rails a row cannot reach — reported once, after every segment is walked. */
  const railsAboveRow = [new Set<string>(), new Set<string>()]
  /** 端部防护 returns, which need BOTH rows to reach the rail. */
  const railsAboveEnd = new Set<string>()
  const supportRailCount = Math.max(2, Math.round(parameters.deckSupportRailCount))

  // --- 立杆: staggered splices, and the two posts a corner does not need ---------

  /**
   * 立杆 stock sequence by parity, cached per required length. Neighbouring posts
   * are built from different sequences so their butt joints never land at the same
   * height (JGJ 130-2011 §6.3.6) — `neighbourStockSequence` is what picks the
   * neighbour's. Parity is `(row + station along the whole path) % 2`, so a post
   * differs from the one beside it AND from the one opposite it.
   */
  const postSequenceCache = new Map<string, number[]>()
  const postSequenceFor = (requiredLength: number, parity: number) => {
    const key = `${requiredLength}:${parity}`
    const cached = postSequenceCache.get(key)
    if (cached) return cached
    const overlap = Math.max(0, Math.min(parameters.spliceOverlap, Math.min(...postStocks(parameters)) * 0.8))
    const primary = chooseStockLengths(requiredLength, postStocks(parameters), overlap)
    const sequence = parity === 0
      ? primary
      : neighbourStockSequence(primary, requiredLength, postStocks(parameters), overlap)
    postSequenceCache.set(key, sequence)
    return sequence
  }
  /** The sequence each post was built with, keyed by member id. */
  const postSequences = new Map<string, number[]>()
  const topology = resolveTopology(physical, parameters, pathIsClosed, supportRailCount, requiredEndPairs)
  const { segmentCount, segmentOrder, stationOffsets } = topology.grid
  const nextSegment = (index: number) => (index + 1) % segmentCount
  const previousSegment = (index: number) => (index + segmentCount - 1) % segmentCount
  const { cornerDecks, mitrePosts, offsetPostLimits } = topology.corners
  const skippedChannels = new Set(topology.corners.skippedChannels), joinedCorners = new Set(topology.corners.joinedCorners)
  const offsetRowExtensions = topology.corners.offsetRowExtensions.map(extension => ({ atStart: new Map(extension.atStart), atEnd: new Map(extension.atEnd) }))
  const bands: PlanPolygon[] = physical.slice(0, -1).map((start, i) => {
    const end = physical[i + 1], length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    const nx = -(end[1] - start[1]) / length * parameters.width, nz = (end[0] - start[0]) / length * parameters.width
    return [start, end, [end[0] + nx, end[1] + nz], [start[0] + nx, start[1] + nz]]
  })
  const overlappingBands = bands.some((band, i) => bands.some((other, j) => {
    if (j <= i + 1 || (pathIsClosed && i === 0 && j === segmentCount - 1)) return false
    const uncovered = subtractCoverage([band], [other]).reduce((sum, piece) => sum + Math.abs(signedArea(piece)), 0)
    return Math.abs(signedArea(band)) - uncovered > 0.001
  }))
  if (overlappingBands) warnings.push({ id: 'scaffold-overlap', message: '非相邻段的架体带重叠：共用直杆已合并、钢笆按覆盖区裁切，请复核重叠区域的搭设布置。' })
  warnings.push(...topology.corners.warnings)

  // The corner keeps ONE offset-row post, where the two offset rows cross: both runs
  // then arrive at the same upright — which is also what carries the 栏杆 around the
  // corner when the offset row is the railed 外排 — instead of two posts a bay apart
  // with the frame open between them.
  for (const mitre of mitrePosts) {
    const height = Math.max(postHeightAt(1, false, mitre.pathSegment), postHeightAt(1, false, nextSegment(mitre.pathSegment)))
    const key = pointKey(mitre.point)
    if (!postByPoint.has(key)) {
      const member = addMember(
        'post',
        mitre.point,
        [mitre.point[0], height, mitre.point[2]],
        undefined,
        mitre.pathSegment,
        [mitre.point, [mitre.point[0], height, mitre.point[2]]],
        0,
        0,
      )
      if (member) {
        postByPoint.set(key, member)
        postSequences.set(member.id, postSequenceFor(height, mitre.parity))
      }
    }
    const cornerPost = postByPoint.get(key)
    if (cornerPost) {
      cornerPost.cornerJunctions = [...(cornerPost.cornerJunctions ?? []), mitre.pathSegment]
      cornerPost[MEMBER_USES] = combineUses(memberUses(cornerPost), [makeUse(nextSegment(mitre.pathSegment), 'post', cornerPost.start, cornerPost.end, 'G08')])
    }
    const half = transverseTubeLength / 2
    const channelStart: Vector3Tuple = [
      round(mitre.beamCentre[0] - mitre.normal[0] * half),
      0,
      round(mitre.beamCentre[2] - mitre.normal[1] * half),
    ]
    const channelEnd: Vector3Tuple = [
      round(mitre.beamCentre[0] + mitre.normal[0] * half),
      0,
      round(mitre.beamCentre[2] + mitre.normal[1] * half),
    ]
    const channelKey = [pointKey(channelStart), pointKey(channelEnd)].sort().join('|')
    if (!channelKeys.has(channelKey)) {
      channelKeys.add(channelKey)
      baseChannels.push({
        id: `B${baseChannels.length + 1}`,
        start: channelStart,
        end: channelEnd,
        length: round(vectorDistance(channelStart, channelEnd)),
        pathSegment: mitre.pathSegment,
      })
    }
  }

  segmentOrder.forEach((segmentIndex) => {
    const layerCount = layersAt(segmentIndex)
    const theoreticalHeight = theoreticalAt(segmentIndex)
    const railedHeight = railedAt(segmentIndex)
    const rowTopEdge = (row: number) => assembledLength(rowCarriesRails(row) ? railedHeight : theoreticalHeight,
      postStocks(parameters), parameters.spliceOverlap)
    const endTopEdge = assembledLength(railedHeight, postStocks(parameters), parameters.spliceOverlap)
    const start2d = physical[segmentIndex]
    const { segmentLength, bayCount, bayLength, stations, direction, normal } = topology.stations[segmentIndex]
    if (segmentLength <= 0.001) {
      warnings.push({ id: `zero-length-${segmentIndex}`, message: `第 ${segmentIndex + 1} 段的两个节点重合，请移动节点或删除该路径段。` })
      return
    }
    const postRows: Array<Array<Vector3Tuple>> = Array.from({ length: postRowCount }, () => [])

    // 端部防护: an end that is not closed off is itself a 临边 (JGJ 80-2016 §4.1.1,
    // 强制性条文). Both posts at such a station belong to the OUTSIDE of the scaffold
    // — nothing is against a wall at an end — so both are built to the railed height
    // and the return rail can be tied across them.
    const endStations: number[] = []
    if (!pathIsClosed && segmentIndex === 0) endStations.push(0)
    if (!pathIsClosed && segmentIndex === physical.length - 2) endStations.push(bayCount)
    const neighbourLayers = new Map<number, number>()
    if (pathIsClosed || segmentIndex > 0) neighbourLayers.set(0, layersAt(previousSegment(segmentIndex)))
    if (pathIsClosed || segmentIndex < physical.length - 2) neighbourLayers.set(bayCount, layersAt(nextSegment(segmentIndex)))
    for (const [station, count] of neighbourLayers) if (count < layerCount) endStations.push(station)

    for (let station = 0; station <= bayCount; station += 1) {
      const atOpenEnd = endStations.includes(station)
      for (let row = 0; row < postRowCount; row += 1) {
        const offset = row * parameters.width
        const point: Vector3Tuple = [
          round(start2d[0] + direction[0] * stations[station] + normal[0] * offset),
          0,
          round(start2d[1] + direction[1] * stations[station] + normal[1] * offset),
        ]
        postRows[row].push(point)
        // Row 1 is the row offset from the path; a corner does not need its post at
        // either side of the junction (see `skippedOffsetPosts`).
        // On a short return, an old endpoint can fall just INSIDE the mitre
        // instead of just outside it. If the other convex corner already carries
        // this entire short row, the endpoint is equally redundant.
        if (row === 1 && !topology.retained[segmentIndex][station]) continue
        const key = pointKey(point)
        const post = postHeightAt(row, atOpenEnd, segmentIndex)
        const parity = (row + stationOffsets[segmentIndex] + station) % 2
        const existingPost = postByPoint.get(key)
        if (existingPost) {
          existingPost[MEMBER_USES] = combineUses(memberUses(existingPost), [makeUse(segmentIndex, 'post', point, [point[0], post, point[2]], 'G08')])
          // A shared corner can be the railed row of one path segment and the plain
          // row of another: the taller post is the one that gets built.
          if (existingPost.end[1] < post) {
            existingPost.end = [existingPost.start[0], post, existingPost.start[2]]
            existingPost.connectionPoints = [existingPost.start, existingPost.end]
            existingPost.length = round(post - existingPost.start[1])
            postSequences.set(existingPost.id, postSequenceFor(post, parity))
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
          if (member) {
            postByPoint.set(key, member)
            postSequences.set(member.id, postSequenceFor(post, parity))
          }
        }
      }

      // 槽钢 base beam: one piece under each pair of posts, running in the same
      // direction as the transverse members and cut to the same length as the
      // transverse tube above it, so the two stay aligned. Deduplicated by post
      // pair so a shared path corner does not produce two identical beams.
      const outerBase = postRows[0][station]
      const innerBase = postRows[1][station]
      const channelKey = [pointKey(outerBase), pointKey(innerBase)].sort().join('|')
      if (!skippedChannels.has(`${segmentIndex}:${station}`) && !channelKeys.has(channelKey)) {
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

    // Every row of this segment is carried on to the other leg's offset row line (see
    // `offsetRowExtensions`), so all of a segment's 纵向水平杆 come out the same length.
    // `supportRows` itself stays on the station grid — the 横向杆 tie to it and the deck
    // takes its corners from it — and the members are built from these extended copies.
    const extensionAt = (map: Map<number, Vector3Tuple>, ratio: number): Vector3Tuple | undefined => {
      if (map.size === 0) return undefined
      let best: Vector3Tuple | undefined
      let bestGap = Number.POSITIVE_INFINITY
      for (const [rowRatio, point] of map) {
        const gap = Math.abs(rowRatio - ratio)
        if (gap < bestGap) {
          bestGap = gap
          best = point
        }
      }
      return bestGap < 0.001 ? best : undefined
    }
    const extendRow = (row: Vector3Tuple[], ratio: number): Vector3Tuple[] => {
      const points = [...row]
      const atStart = extensionAt(offsetRowExtensions[segmentIndex].atStart, ratio)
      const atEnd = extensionAt(offsetRowExtensions[segmentIndex].atEnd, ratio)
      if (atStart) points.unshift(atStart)
      if (atEnd) points.push(atEnd)
      return points
    }

    const supportRows = Array.from({ length: supportRailCount }, (_, supportIndex) => {
      const ratio = supportRailCount > 1 ? supportIndex / (supportRailCount - 1) : 1
      return postRows[0].map((outerPoint, station) => {
        const innerPoint = postRows[1][station]
        return [
          round(outerPoint[0] + (innerPoint[0] - outerPoint[0]) * ratio),
          0,
          round(outerPoint[2] + (innerPoint[2] - outerPoint[2]) * ratio),
        ] as Vector3Tuple
      })
    })

    const memberRows = supportRows.map((row, rowIndex) => extendRow(
      row,
      supportRailCount > 1 ? rowIndex / (supportRailCount - 1) : 1,
    ))
    const offsetRowPoints = extendRow(postRows[1], 1)
    if (offsetRowPoints.length !== postRows[1].length) {
      memberRows[memberRows.length - 1] = offsetRowPoints
    }

    // The two post rows carry the ordinary 纵向水平杆. Any rows between them are
    // 钢笆纵向支承杆 (deck-support rails), which only exist where a deck does.
    const normalRows = [extendRow(supportRows[0], 0), offsetRowPoints]
    const normalStationRows = [supportRows[0], postRows[1]]

    const addHorizontalBand = (
      elevation: number,
      layer: number,
      rows: Vector3Tuple[][],
      stationRows: Vector3Tuple[][],
      withDeck: boolean,
    ) => {
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
        const isInternalPathNode = (station === 0 && joinedCorners.has(previousSegment(segmentIndex))) ||
          (station === bayCount && joinedCorners.has(segmentIndex))
        if (isInternalPathNode) return

        const innerPoint = postRows[1][station]
        // Ties come off the STATION rows: the extended row of a convex corner carries
        // an extra point at its end, so indexing it by station would shift every tie.
        const transverseConnections = stationRows.map(
          (row) => [row[station][0], elevation, row[station][2]] as Vector3Tuple,
        )
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

      /** 架顶栏杆 is a 作业层-level rail like any other, only one course higher. */
      const topRail = layer === layerCount
        ? round(theoreticalHeight + parameters.liftHeight)
        : null
      const topRailUsable = topRail !== null
        && round(topRail + parameters.pipeDiameter / 2) <= rowTopEdge(outerRow) + 0.001
        && round(topRail + parameters.pipeDiameter / 2) <= endTopEdge + 0.001
      const guardedThisLift: ReadonlyArray<{ id: string; label: string; centreAboveDeck: number }> =
        topRailUsable && topRail !== null
          ? [...guardedRails, { id: 'coping', label: '架顶栏杆', centreAboveDeck: round(topRail - elevation) }]
          : guardedRails

      /**
       * The rails of this lift that `rowTop` can actually carry. A rail is tied to
       * the 立杆, so one reaching past that post's top is not emitted at all — it
       * would float in the air — and is recorded in `above` for a single report.
       */
      const railsWithin = (
        rowTop: number,
        above: Set<string>,
        rails: typeof guardedThisLift = guardedRails,
      ): Array<{ rail: (typeof guardedThisLift)[number]; elevation: number }> => {
        const usable: Array<{ rail: (typeof guardedThisLift)[number]; elevation: number }> = []
        for (const rail of rails) {
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

      // 防护栏杆 sit on the 外排 and nowhere else: §7.3.12(1) mandates the 外立杆, and
      // the row against the building is regulated as a gap to it. There is no
      // parameter that changes this — only `swapInnerOuter`, which says WHICH side of
      // the drawing the building is on.
      if (guardedRails.length > 0) {
        const railRow = outerRow === 1 ? offsetRowPoints : postRows[0]
        // Only the railing is cut back at an inward crossing. Deck-supporting
        // longitudinals still span the entire corner; higher unmatched lifts keep
        // their end protection because there is no connected walkway there.
        const limits = offsetPostLimits[segmentIndex]
        const clipStart = outerRow === 1 && (neighbourLayers.get(0) ?? 0) >= layer && limits.start > 0
        const clipEnd = outerRow === 1 && (neighbourLayers.get(bayCount) ?? 0) >= layer && limits.end < segmentLength
        const from = clipStart ? limits.start : -Infinity, to = clipEnd ? limits.end : Infinity
        const stationOf = (p: Vector3Tuple) => (p[0] - start2d[0]) * direction[0] + (p[2] - start2d[1]) * direction[1]
        const at = (distance: number): Vector3Tuple => [round(start2d[0] + direction[0] * distance + normal[0] * parameters.width), 0,
          round(start2d[1] + direction[1] * distance + normal[1] * parameters.width)]
        const kept = railRow.filter(p => stationOf(p) > from + 0.001 && stationOf(p) < to - 0.001)
        if (clipStart) kept.unshift(at(from))
        if (clipEnd) kept.push(at(to))
        for (const { elevation: railElevation } of railsWithin(rowTopEdge(outerRow), railsAboveRow[outerRow], guardedThisLift)) {
          const points = kept.map((point) => [point[0], railElevation, point[2]] as Vector3Tuple)
          if (points.length >= 2) addMember('guardrail', points[0], points[points.length - 1], layer, segmentIndex, points,
            clipStart ? 0 : parameters.tubeEndExtension, clipEnd ? 0 : parameters.tubeEndExtension)
        }


        // 端部防护 returns across an open end. Both of that station's posts are built to
        // the railed height (nothing is against a wall at an end), so the return is
        // checked against that height rather than against the shorter inner row.
        for (const { elevation: railElevation } of railsWithin(endTopEdge, railsAboveEnd, guardedThisLift)) {
          for (const station of endStations) {
            if (layer <= (neighbourLayers.get(station) ?? 0)) continue
            const outerPoint = postRows[0][station]
            const innerPoint = postRows[1][station]
            const start: Vector3Tuple = [outerPoint[0], railElevation, outerPoint[2]]
            const end: Vector3Tuple = [innerPoint[0], railElevation, innerPoint[2]]
            addMember('guardrail', start, end, layer, segmentIndex, [start, end], parameters.tubeEndExtension, parameters.tubeEndExtension, 'end-guard')
          }
        }
      }

      if (!withDeck) return

      // 钢笆片 are whole panels: the chosen width spans the 排距 (which follows it) and
      // the chosen length runs along the bay, so the count the material list reports
      // is the number of pieces actually laid — while `deckArea` stays the geometric
      // area covered, which a cut piece at the end of a bay cannot exceed.
      const deckElevation = round(elevation + DECK_SURFACE_OFFSET)
      const panelLength = Math.max(0.1, parameters.deckPanelLength ?? DECK_PANEL.length)
      const panelWidth = Math.max(0.1, parameters.deckPanelWidth ?? DECK_PANEL.width)
      const panelsAcross = deckPanelCount(parameters.width, panelWidth)

      for (let bay = 0; bay < bayCount; bay += 1) {
        const bayLength = stations[bay + 1] - stations[bay]
        const panelsAlong = deckPanelCount(bayLength, panelLength)
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
            round(outerX + (innerX - outerX) * across, 6),
            deckElevation,
            round(outerZ + (innerZ - outerZ) * across, 6),
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
      addHorizontalBand(sweepElevation, SWEEP_BAR_LAYER, normalRows, normalStationRows, false)
    }

    for (let layer = 1; layer <= layerCount; layer += 1) {
      // Every 作业层 is exactly `layer × liftHeight` above the base: the first one is
      // a full 步距 up, and `TOP_POST_EXTENSION` is the 立杆 extension above the TOP
      // one rather than a start offset.
      const elevation = liftElevation(layer)
      const withDeck = (layer + deckLayerOffset) % Math.max(1, Math.round(parameters.deckLiftInterval)) === 0
      // A decked lift is a 作业层 and gets its rails; a deckless lift gets only the
      // two normal longitudinal rows — except the top lift, which always carries
      // the 架顶栏杆 that carries the top of the scaffold.
      addHorizontalBand(
        elevation,
        layer,
        withDeck ? memberRows : normalRows,
        withDeck ? supportRows : normalStationRows,
        withDeck,
      )
    }

    if (bayLength < parameters.postSpacing * 0.55) {
      warnings.push({
        id: `short-bay-${segmentIndex}`,
        message: `第 ${segmentIndex + 1} 段末跨仅 ${bayLength.toFixed(2)}m，请复核立杆间距。`,
      })
    }
  })

  // The corner square of a convex junction is framed on all four sides — the two
  // 横向杆 of the junction and the two carried-on runs — so the 作业层 platform
  // continues around the building's corner instead of stopping at it. One 钢笆 piece
  // per decked lift, cut to the square, and only for the lifts that carry a deck.
  if (cornerDecks.length > 0) {
    const deckInterval = Math.max(1, Math.round(parameters.deckLiftInterval))
    for (const corner of cornerDecks) {
      const sharedLayers = Math.min(layersAt(corner.pathSegment), layersAt(nextSegment(corner.pathSegment)))
      for (let layer = 1; layer <= sharedLayers; layer += 1) {
        if ((layer + deckLayerOffset) % deckInterval !== 0) continue
        const deckElevation = round(liftElevation(layer) + DECK_SURFACE_OFFSET)
        const corners = corner.points.map(
          (point) => [point[0], deckElevation, point[2]] as Vector3Tuple,
        ) as [Vector3Tuple, Vector3Tuple, Vector3Tuple, Vector3Tuple]
        let twiceArea = 0
        for (let index = 0; index < corners.length; index += 1) {
          const current = corners[index]
          const next = corners[(index + 1) % corners.length]
          twiceArea += current[0] * next[2] - next[0] * current[2]
        }
        decks.push({
          id: `D${decks.length + 1}`,
          corners,
          area: round(Math.abs(twiceArea) / 2),
          layer,
          pathSegment: corner.pathSegment,
        })
      }
    }
  }

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
      message: `顶层作业层 ${topLiftElevation} m：${parts.join('；')}，该处栏杆未设置。内侧按靠墙处理只到理论高度 ${theoreticalHeight} m（只有开口端的两根端柱与外排同高），请复核步距与栏杆根数。`,
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

  const pathDimensions: PathDimension[] = physical.slice(0, -1).flatMap((point, index) => {
    const next = physical[index + 1]
    const dx = next[0] - point[0]
    const dz = next[1] - point[1]
    const distance = Math.hypot(dx, dz)
    if (distance < 0.001) return []
    // Row 0 is the path. When row 1 is outside, move past the full row width.
    const offset = parameters.swapInnerOuter ? parameters.width + 1.2 : -1.2
    return [{
      index,
      length: round(Math.max(0.1, segmentLengths[index] ?? distance)),
      start: [point[0], 0, point[1]] as Vector3Tuple,
      end: [next[0], 0, next[1]] as Vector3Tuple,
      labelPosition: [
        round((point[0] + next[0]) / 2 - dz / distance * offset),
        0.015,
        round((point[1] + next[1]) / 2 + dx / distance * offset),
      ] as Vector3Tuple,
    }]
  })
  if (segmentLayerCounts) {
    const layers = new Set(decks.map(deck => deck.layer))
    const covered: DeckPanel[] = []
    for (const layer of layers) {
      const panels = decks.filter(deck => deck.layer === layer)
      resolveDeckCoverage(panels, physical, pathIsClosed)
      covered.push(...panels)
    }
    decks.splice(0, decks.length, ...covered)
  } else resolveDeckCoverage(decks, physical, pathIsClosed)
  return finishLayout(members, decks, baseChannels, warnings, parameters, postSequences, pathDimensions, {
    theoretical: theoreticalHeight,
    inner: round(rowTopEdge(innerRow)),
    outer: round(rowTopEdge(outerRow)),
  })
}

/** One assembly/counting pass for all components of the same drawing. */
function finishLayout(
  members: ScaffoldMember[], decks: DeckPanel[], baseChannels: BaseChannel[],
  warnings: LayoutWarning[], parameters: ScaffoldParameters, postSequences: Map<string, number[]>,
  pathDimensions: PathDimension[], postHeights: MaterialResult['postHeights'], fixedPostsAndBases = false,
): ScaffoldLayout {
  // Merge collinear shared runs before stock assembly and coupler counting.
  // This keeps all three views on the same physical quantities.
  members = mergeMemberStage(members)
  // A relocated station may now carry a mitre that already had its own beam.
  // Remove a beam only when ALL of its posts are carried by one other beam;
  // never join beams into a longer piece or leave a post without a base.
  if (!fixedPostsAndBases) {
    const postsForBases = members.filter(member => member.type === 'post')
    const beamSupports = (beam: BaseChannel) => postsForBases.filter(post => {
      const dx = beam.end[0] - beam.start[0], dz = beam.end[2] - beam.start[2]
      const length = Math.hypot(dx, dz)
      const x = post.start[0] - beam.start[0], z = post.start[2] - beam.start[2]
      const along = (x * dx + z * dz) / length
      return along >= -0.001 && along <= length + 0.001 && Math.abs(x * dz - z * dx) / length < 0.001
    }).map(post => post.id)
    const supportedByBeam = new Map(baseChannels.map(beam => [beam, beamSupports(beam)]))
    for (let index = baseChannels.length - 1; index >= 0; index--) {
      const beam = baseChannels[index], supported = supportedByBeam.get(beam)!
      if (supported.length === 0 || baseChannels.some(other => other !== beam
        && supportedByBeam.get(other)!.length > supported.length
        && supported.every(id => supportedByBeam.get(other)!.includes(id)))) baseChannels.splice(index, 1)
    }
  }

  const stock = assembleStockStage(members, Object.fromEntries(postSequences), parameters, fixedPostsAndBases)
  warnings.push(...stock.warnings)
  const assemblies = stock.assemblies
  const builtPostTops = new Map(assemblies
    .filter((assembly) => assembly.segments[0]?.type === 'post')
    .map((assembly) => [assembly.plan.memberId, Math.max(...assembly.segments.map((segment) => segment.end[1]))]))

  const crossConnectors = calculateConnections(members, Object.fromEntries(builtPostTops), parameters)
  const pipeSegments = assemblies.flatMap((assembly) => assembly.segments)
  const connectors = [
    ...crossConnectors,
    ...assemblies.flatMap((assembly) => assembly.connectors),
  ]
  const assemblyPlans = assemblies.map((assembly) => assembly.plan)
  fitGuardrailStock({ members, pipeSegments, connectors, decks })


  return {
    pathDimensions,
    perimeter: round(pathDimensions.reduce((sum, segment) => sum + segment.length, 0)),
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
      postHeights,
    ),
  }
}

/** Rebuild merged lift runs and their fittings while keeping the solved uprights and bases. */
export function reassembleSiteRuns(layout: ScaffoldLayout, members: ScaffoldMember[], decks: DeckPanel[], settings: ScaffoldParameters) {
  const posts = new Set(members.filter(member => member.type === 'post').map(member => member.id))
  const sequences = new Map(layout.materials.assemblyPlans.filter(plan => posts.has(plan.memberId))
    .map(plan => [plan.memberId, plan.stockLengths]))
  return finishLayout(members, decks, layout.baseChannels, layout.warnings, settings, sequences,
    layout.pathDimensions, layout.materials.postHeights, true)
}

export function countMembers(layout: ScaffoldLayout) {
  return layout.members.reduce<Record<MemberType, number>>(
    (counts, member) => ({ ...counts, [member.type]: counts[member.type] + 1 }),
    { post: 0, longitudinal: 0, transverse: 0, guardrail: 0 },
  )
}

/**
 * Build each connected trail in its true location, then assemble/count the union.
 * No synthetic segment is inserted between disconnected components. Branches
 * remain editable but are flagged because their fabrication detail is unspecified.
 */
export function calculateScaffoldPlan(drawing: PlanDrawing, parameters: ScaffoldParameters, localLifts?: readonly number[], deckLayerOffset = 0,
  segmentLayerCounts?: readonly number[], preserveDirection = false, requiredEndPairs: readonly (readonly [boolean, boolean])[] = []): ScaffoldLayout {
  const paths = drawingPaths(drawing)
  if (preserveDirection) for (const path of paths) {
    if (path.points[0].id !== drawing.segments[path.edgeIndices[0]].start) {
      path.points.reverse(); path.edgeIndices.reverse()
    }
  }
  if (!paths.length) return calculateScaffold([], [], parameters)
  const origin = drawing.points[0]
  // Transition bridges require both end posts even beside a short corner return.
  const retainedPairs = (path: ReturnType<typeof drawingPaths>[number]): [boolean, boolean][] => path.edgeIndices.map((edge, i) => {
    const pair = requiredEndPairs[edge] ?? [false, false]
    return path.points[i].id === drawing.segments[edge].start ? [pair[0], pair[1]] : [pair[1], pair[0]]
  })
  // A normal connected outline needs exactly one domain calculation on mobile.
  if (paths.length === 1) {
    const path = paths[0], result = calculateScaffold(path.points, measurePath(path.points, localLifts ? 3 : 2), parameters, localLifts, deckLayerOffset,
      segmentLayerCounts && path.edgeIndices.map(index => segmentLayerCounts[index]), retainedPairs(path))
    const dx = (path.points[0].x - origin.x) / PIXELS_PER_METER, dz = (path.points[0].y - origin.y) / PIXELS_PER_METER
    const move = (p: Vector3Tuple): Vector3Tuple => [round(p[0] + dx), p[1], round(p[2] + dz)]
    result.members.forEach(m => {
      m[MEMBER_USES] = transformUses(m, move, use => ({ pathSegment: path.edgeIndices[use.pathSegment] }))
      m.start = move(m.start); m.end = move(m.end); m.connectionPoints = m.connectionPoints.map(move)
      if (m.pathSegment !== undefined) m.pathSegment = path.edgeIndices[m.pathSegment]
      m.cornerJunctions = m.cornerJunctions?.map(i => path.edgeIndices[i])
    })
    result.pipeSegments.forEach(p => { p.start = move(p.start); p.end = move(p.end) })
    result.connectors.forEach(c => { c.position = move(c.position); if (c[CONNECTOR_CONTACT]) c[CONNECTOR_CONTACT] = move(c[CONNECTOR_CONTACT]) })
    result.decks.forEach(d => {
      d.corners = d.corners.map(move) as DeckPanel['corners']; d.coverage = d.coverage?.map(face => face.map(move))
      d.pathSegment = path.edgeIndices[d.pathSegment]
    })
    result.baseChannels.forEach(b => { b.start = move(b.start); b.end = move(b.end); b.pathSegment = path.edgeIndices[b.pathSegment] })
    result.pathDimensions.forEach(d => { d.index = path.edgeIndices[d.index]; d.start = move(d.start); d.end = move(d.end); d.labelPosition = move(d.labelPosition) })
    result.pathDimensions.sort((a, b) => a.index - b.index)
    return result
  }
  const members: ScaffoldMember[] = [], decks: DeckPanel[] = [], baseChannels: BaseChannel[] = []
  const warnings: LayoutWarning[] = [], dimensions: PathDimension[] = []
  const postSequences = new Map<string, number[]>()
  let postHeights: MaterialResult['postHeights'] | undefined
  paths.forEach((path, component) => {
    const layout = calculateScaffold(path.points, measurePath(path.points, localLifts ? 3 : 2), parameters, localLifts, deckLayerOffset,
      segmentLayerCounts && path.edgeIndices.map(index => segmentLayerCounts[index]), retainedPairs(path))
    postHeights ??= layout.materials.postHeights
    const dx = (path.points[0].x - origin.x) / PIXELS_PER_METER
    const dz = (path.points[0].y - origin.y) / PIXELS_PER_METER
    const translate = (p: Vector3Tuple): Vector3Tuple => [round(p[0] + dx), p[1], round(p[2] + dz)]
    const prefix = `G${component}-`
    const edgeIndex = (index: number | undefined) => index === undefined ? undefined : path.edgeIndices[index]
    const postIds = new Set(layout.members.filter(member => member.type === 'post').map(member => member.id))
    layout.materials.assemblyPlans.forEach(plan => {
      if (postIds.has(plan.memberId)) postSequences.set(prefix + plan.memberId, plan.stockLengths)
    })
    members.push(...layout.members.map(m => ({ ...m, id: prefix + m.id,
      [MEMBER_USES]: transformUses(m, translate, use => ({ pathSegment: edgeIndex(use.pathSegment)! })),
      start: translate(m.start), end: translate(m.end), connectionPoints: m.connectionPoints.map(translate),
      pathSegment: edgeIndex(m.pathSegment), cornerJunctions: m.cornerJunctions?.map(index => edgeIndex(index)!),
    })))
    decks.push(...layout.decks.map(deck => ({ ...deck, id: prefix + deck.id,
      corners: deck.corners.map(translate) as DeckPanel['corners'], coverage: deck.coverage?.map(face => face.map(translate)),
      pathSegment: edgeIndex(deck.pathSegment)!,
    })))
    baseChannels.push(...layout.baseChannels.map(beam => ({ ...beam, id: prefix + beam.id,
      start: translate(beam.start), end: translate(beam.end), pathSegment: edgeIndex(beam.pathSegment)!,
    })))
    dimensions.push(...layout.pathDimensions.map(d => ({ ...d, index: edgeIndex(d.index)!,
      start: translate(d.start), end: translate(d.end), labelPosition: translate(d.labelPosition),
    })))
    layout.warnings.forEach(warning => {
      if (!warnings.some(w => w.id === warning.id)) warnings.push(warning)
    })
  })
  const degrees = new Map<string, number>()
  drawing.segments.forEach(s => [s.start, s.end].forEach(id => degrees.set(id, (degrees.get(id) ?? 0) + 1)))
  if ([...degrees.values()].some(degree => degree > 2)) warnings.unshift({
    id: 'branch-junction', message: '图纸含三向或四向交汇点：已合并共点立杆，支路按各自端部估算；交汇处栏杆、钢笆及搭设细节需人工复核。',
  })
  // Shared endpoints belong to one physical post, taking the taller requirement.
  const posts = new Map<string, ScaffoldMember>()
  for (let i = members.length - 1; i >= 0; i--) {
    const post = members[i]
    if (post.type !== 'post') continue
    const key = pointKey(post.start), existing = posts.get(key)
    if (!existing) { posts.set(key, post); continue }
    existing[MEMBER_USES] = combineUses(memberUses(existing), memberUses(post))
    if (post.length > existing.length) {
      existing.length = post.length; existing.end = [...post.end]
      postSequences.set(existing.id, postSequences.get(post.id)!)
    }
    members.splice(i, 1)
  }
  const beams = new Set<string>()
  for (let i = baseChannels.length - 1; i >= 0; i--) {
    const b = baseChannels[i], key = [pointKey(b.start), pointKey(b.end)].sort().join('|')
    if (beams.has(key)) baseChannels.splice(i, 1)
    else beams.add(key)
  }
  // Components/branches may overlap in plan. Count and draw covered ground once.
  const coveredByLayer = new Map<number, PlanPolygon[]>()
  let overlap = false
  for (let i = 0; i < decks.length;) {
    const deck = decks[i], covered = coveredByLayer.get(deck.layer) ?? []
    const original = (deck.coverage ?? [deck.corners]).map(face => face.map(p => [p[0], p[2]] as [number, number]))
    const faces = subtractCoverage(original, covered)
    const area = faces.reduce((sum, face) => sum + Math.abs(signedArea(face)), 0)
    if (area < deck.area - 0.001) overlap = true
    if (area < 0.00001) { decks.splice(i, 1); continue }
    deck.coverage = faces.map(face => face.map(p => [p[0], deck.corners[0][1], p[1]] as Vector3Tuple))
    deck.area = round(area, 4)
    coveredByLayer.set(deck.layer, [...covered, ...faces]); i++
  }
  if (overlap && !warnings.some(w => w.id === 'branch-junction')) warnings.unshift({ id: 'overlapping-components',
    message: '独立架段的铺设范围重叠：钢笆覆盖已去重，交汇处立杆、栏杆及搭设细节需人工复核。' })
  return finishLayout(members, decks, baseChannels, warnings, parameters, postSequences,
    dimensions.sort((a, b) => a.index - b.index), postHeights!)
}
