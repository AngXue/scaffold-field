import { resolvePosts } from './rules/posts.ts'
import { resolveBaseCandidates, resolveSupportingBases } from './rules/bases.ts'
import { reconcileComponents } from './rules/components.ts'
import { resolveBands } from './rules/bands.ts'
import { resolveDecks } from './rules/decks.ts'
import { resolveFrameRows } from './rules/frameRows.ts'
import { resolveHeightStages } from './rules/heights.ts'
import { resolveTopology } from './rules/topology.ts'
import { roundDomain as round } from './rules/facts/precision.ts'
import { normalizeKernelParameters } from './rules/boundaries/parameters.ts'
export { materialQuantity, materialAdjustmentStep, stockMaterialRows } from './rules/boundaries/adjustments.ts'
import { calculateMaterials } from './rules/materials.ts'
export { calculateMaterials } from './rules/materials.ts'
import { calculateConnections } from './rules/connections.ts'
import { CONNECTOR_CONTACT } from './rules/facts/connections.ts'
import { assembledLength, postStockWarnings } from './rules/policies/stock.ts'
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

export { GUARDRAIL_TOP_EDGE, GUARDRAILS, guardrailsFor } from './rules/policies/guardCourses.ts'

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

export { deckPanelCount, deckBetweenStations } from './rules/policies/decks.ts'

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
  const warnings: LayoutWarning[] = []
  warnings.push(...postStockWarnings(parameters))
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
    rules: readonly string[] = [],
  ) => {
    const [physicalStart, physicalEnd] = extendLine(start, end, startExtension, endExtension)
    const length = round(vectorDistance(physicalStart, physicalEnd))
    if (length <= 0.001) return undefined
    const geometryKey = `${type}:${layer}:${[pointKey(physicalStart), pointKey(physicalEnd)].sort().join('|')}`
    const shared = memberByGeometry.get(geometryKey)
    const use = makeUse(pathSegment ?? 0, purpose, physicalStart, physicalEnd, type === 'post' ? 'M01' : type === 'guardrail' ? 'P02' : 'M03')
    use.rules = [...new Set([...use.rules, ...rules])]
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
  const heightStages = resolveHeightStages(parameters, segmentLayerCounts ?? [], localLifts, deckLayerOffset)
  const layerCount = Math.max(1, Math.round(parameters.layerCount ?? DEFAULT_PARAMETERS.layerCount))
  const profiles = new Map(heightStages.profiles.map(profile => [profile.count, profile]))
  const globalProfile = profiles.get(layerCount)!
  const liftElevation = (layer: number) => localLifts?.[layer - 1] ?? round(layer * parameters.liftHeight)
  const topLiftElevation = liftElevation(layerCount)
  const theoreticalHeight = globalProfile.height.theoretical
  const { outerRow, innerRow } = globalProfile.height
  const layersAt = (index: number) => Math.max(1, Math.round(segmentLayerCounts?.[index] ?? layerCount))
  const profileAt = (index: number) => profiles.get(layersAt(index))!
  const rowTopEdge = (row: number) => globalProfile.support.rowTops[row]
  const endTopEdge = globalProfile.support.endTop
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

  /** The sequence each post was built with, keyed by member id. */
  const postSequences = new Map<string, number[]>()
  const topology = resolveTopology(physical, parameters, pathIsClosed, supportRailCount, requiredEndPairs)
  const { segmentCount, segmentOrder } = topology.grid
  const previousSegment = (index: number) => (index + segmentCount - 1) % segmentCount
  const { mitrePosts } = topology.corners
  const joinedCorners = new Set(topology.corners.joinedCorners)
  const frame = resolveFrameRows(physical, topology.stations, topology.corners, physical.slice(0, -1).map((_, index) => layersAt(index)), pathIsClosed, parameters)
  const postPlan = resolvePosts({ rows: frame.rows.map(rows => rows.postRows), heights: frame.rows.map((_, index) => profileAt(index).height),
    ends: frame.ends, grid: topology.grid, stations: topology.stations, mitres: topology.corners.mitrePosts, retained: topology.retained }, parameters)
  const postDemands = new Map(postPlan.posts.map(post => [post.key, post])), emittedPosts = new Set<string>()
  const emitPost = (point: Vector3Tuple) => {
    const key = pointKey(point)
    if (emittedPosts.has(key)) return
    const post = postDemands.get(key)!
    const end: Vector3Tuple = [post.point[0], post.top, post.point[2]]
    const member = addMember('post', post.point, end, undefined, post.pathSegment, [post.point, end], 0, 0)
    if (!member) return
    member[MEMBER_USES] = post.uses
    if (post.cornerJunctions) member.cornerJunctions = post.cornerJunctions
    postSequences.set(member.id, postPlan.sequences[key])
    emittedPosts.add(key)
  }
  const baseChannels = resolveBaseCandidates({ rows: frame.rows.map(rows => rows.postRows), stations: topology.stations,
    corners: topology.corners, order: segmentOrder, transverseTubeLength })
  const working = resolveBands(frame.rows.map((rows, index) => ({ rows, bayCount: topology.stations[index].bayCount,
    joinedStart: joinedCorners.has(previousSegment(index)), joinedEnd: joinedCorners.has(index), lifts: profileAt(index).height.lifts })), parameters, deckLayerOffset)
  const decks = resolveDecks({ geometry: frame.rows.map((rows, index) => ({ postRows: rows.postRows, stations: topology.stations[index].stations, bands: working[index].map(({ elevation, layer, withDeck }) => ({ elevation, layer, withDeck })) })),
    order: segmentOrder, corners: topology.corners.cornerDecks, counts: physical.slice(0, -1).map((_, index) => layersAt(index)), lifts: localLifts ? [...localLifts] : [],
    parameters, deckLayerOffset, physical, closed: pathIsClosed, perSegmentCounts: Boolean(segmentLayerCounts) })
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

  for (const mitre of mitrePosts) emitPost(mitre.point)

  segmentOrder.forEach((segmentIndex) => {
    const guardCourses = profileAt(segmentIndex).courses
    const { segmentLength, bayCount, bayLength } = topology.stations[segmentIndex]
    if (segmentLength <= 0.001) {
      warnings.push({ id: `zero-length-${segmentIndex}`, message: `第 ${segmentIndex + 1} 段的两个节点重合，请移动节点或删除该路径段。` })
      return
    }
    const postRows = frame.rows[segmentIndex].postRows
    for (let station = 0; station <= bayCount; station++) for (let row = 0; row < postRows.length; row++) {
      if (row === 1 && !topology.retained[segmentIndex][station]) continue
      emitPost(postRows[row][station])
    }

    // Every row of this segment is carried on to the other leg's offset row line (see
    // `offsetRowExtensions`), so all of a segment's 纵向水平杆 come out the same length.
    // `supportRows` itself stays on the station grid — the 横向杆 tie to it and the deck
    // takes its corners from it — and the members are built from these extended copies.
    for (const band of working[segmentIndex]) {
      const { layer } = band
      for (const member of band.members) addMember(member.type, member.start, member.end, layer, segmentIndex,
        member.connectionPoints, member.startExtension, member.endExtension, member.type, band.layer === SWEEP_BAR_LAYER ? ['M04'] : ['M03'])

      // 作业层 protection. These are ADDITIONAL members, never a substitute for the
      // ordinary longitudinal rows: JGJ 130-2011 §4.1.2 puts 栏杆 in 构配件自重, a
      // different bucket from 架体结构自重.
      //
      // A decked lift is a 作业层 and gets its rails; a deckless lift gets only the
      // two normal longitudinal rows — except the top lift, which always carries the
      // 架顶栏杆, i.e. the first rail of the selected set.
      const course = guardCourses[layer - 1]
      // 防护栏杆 sit on the 外排 and nowhere else: §7.3.12(1) mandates the 外立杆, and
      // the row against the building is regulated as a gap to it. There is no
      // parameter that changes this — only `swapInnerOuter`, which says WHICH side of
      // the drawing the building is on.
      if (course?.enabled) {
        for (const label of course.side.above) railsAboveRow[outerRow].add(label)
        for (const label of course.end.above) railsAboveEnd.add(label)
        const range = frame.guards[segmentIndex][layer - 1]
        const { clipStart, clipEnd, points: kept } = range
        for (const { elevation: railElevation } of course.side.usable) {
          const points = kept.map((point) => [point[0], railElevation, point[2]] as Vector3Tuple)
          if (points.length >= 2) addMember('guardrail', points[0], points[points.length - 1], layer, segmentIndex, points,
            clipStart ? 0 : parameters.tubeEndExtension, clipEnd ? 0 : parameters.tubeEndExtension, 'side-guard',
            ['P01', 'P07', ...(clipStart || clipEnd ? ['P03'] : [])])
        }


        // 端部防护 returns across an open end. Both of that station's posts are built to
        // the railed height (nothing is against a wall at an end), so the return is
        // checked against that height rather than against the shorter inner row.
        for (const { elevation: railElevation } of course.end.usable) {
          for (const station of range.endStations) {
            const outerPoint = postRows[0][station]
            const innerPoint = postRows[1][station]
            const start: Vector3Tuple = [outerPoint[0], railElevation, outerPoint[2]]
            const end: Vector3Tuple = [innerPoint[0], railElevation, innerPoint[2]]
            addMember('guardrail', start, end, layer, segmentIndex, [start, end], parameters.tubeEndExtension, parameters.tubeEndExtension, 'end-guard', ['P01', 'P07'])
          }
        }
      }

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
  if (!fixedPostsAndBases) baseChannels = resolveSupportingBases(baseChannels, members)

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
  const reconciled = reconcileComponents(members, decks, baseChannels, Object.fromEntries(postSequences))
  const overlap = reconciled.overlap
  if (overlap && !warnings.some(w => w.id === 'branch-junction')) warnings.unshift({ id: 'overlapping-components',
    message: '独立架段的铺设范围重叠：钢笆覆盖已去重，交汇处立杆、栏杆及搭设细节需人工复核。' })
  return finishLayout(reconciled.members, reconciled.decks, reconciled.bases, warnings, parameters, new Map(Object.entries(reconciled.sequences)),
    dimensions.sort((a, b) => a.index - b.index), postHeights!)
}
