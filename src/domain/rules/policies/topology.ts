import type { ScaffoldParameters, Vector3Tuple, LayoutWarning } from '../../scaffold.ts'
import { roundDomain as round } from '../facts/precision.ts'
export type PlanPoint = [number, number]
export type TopologyParameters = Pick<ScaffoldParameters, 'width' | 'postSpacing'>

export function planStationGrid(physical: PlanPoint[], parameters: TopologyParameters, pathIsClosed: boolean) {
  const segmentCount = Math.max(0, physical.length - 1)
  const nextSegment = (index: number) => (index + 1) % segmentCount
  const segmentOrder = Array.from({ length: segmentCount }, (_, index) => index)
  // A closed outline has no privileged first vertex. Stable traversal also keeps
  // coincident-post height/stock ownership independent of where drawing began.
  if (pathIsClosed) {
    const signature = (start: number) => segmentOrder.map((_, offset) => {
      const i = (start + offset) % segmentCount, j = nextSegment(i)
      const a = physical[i], b = physical[i + 1], c = physical[j + 1]
      const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1]
      return `${round(Math.hypot(ux, uz))}:${round(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz), 6)}`
    }).join('|')
    const signatures = segmentOrder.map(signature)
    const first = segmentOrder.reduce((best, index) => {
      if (signatures[index] !== signatures[best]) return signatures[index] < signatures[best] ? index : best
      return physical[index][0] < physical[best][0] - 0.001 ||
        (Math.abs(physical[index][0] - physical[best][0]) < 0.001 && physical[index][1] < physical[best][1]) ? index : best
    }, 0)
    segmentOrder.splice(0, segmentCount, ...segmentOrder.slice(first), ...segmentOrder.slice(0, first))
  }
  const segmentBays = physical.slice(0, -1).map((point, index) => {
    const next = physical[index + 1]
    const length = Math.hypot(next[0] - point[0], next[1] - point[1])
    return length <= 0.001 ? 0 : Math.max(1, Math.ceil(length / parameters.postSpacing - 1e-9))
  })
  const stationOffsets: number[] = []
  segmentOrder.reduce((running, index) => {
    stationOffsets[index] = running
    return running + segmentBays[index]
  }, 0)

  return { segmentCount, segmentOrder, segmentBays, stationOffsets }
}
export type StationGrid = ReturnType<typeof planStationGrid>
export function solveCornerTopology(physical: PlanPoint[], parameters: TopologyParameters, pathIsClosed: boolean, supportRailCount: number, grid: StationGrid) {
  const { segmentCount, segmentOrder, segmentBays, stationOffsets } = grid
  const nextSegment = (index: number) => (index + 1) % segmentCount
  const previousSegment = (index: number) => (index + segmentCount - 1) % segmentCount
  const skippedOffsetPosts = new Set<string>(), warnings: LayoutWarning[] = []
  /**
   * A junction that TURNS leaves one post of the offset row standing inside the
   * corner from each side: the incoming segment's last station and the outgoing
   * segment's first one, each sitting on the other segment's 外排 line less than a bay
   * from the shared corner post (a 7.2 m edge shows six posts on that line, a 4.8 m
   * edge five, where the grid says five and four). The legs cross there and the
   * corner's own 横向杆 already close the gap, so both extras go and the corner keeps
   * just its shared 外排 post. Members are untouched — only those two 立杆 disappear.
   *
   * A collinear junction needs nothing (the two posts are the same point), and a
   * near-straight or doubled-back one keeps both (they are either coincident or
   * genuinely on opposite sides), hence the angle band.
   */
  const turnIsCorner = (index: number) => {
    const a = physical[index]
    const b = physical[index + 1]
    const c = physical[nextSegment(index) + 1]
    const ab: [number, number] = [b[0] - a[0], b[1] - a[1]]
    const bc: [number, number] = [c[0] - b[0], c[1] - b[1]]
    const lengths = Math.hypot(...ab) * Math.hypot(...bc)
    if (lengths <= 0.001) return false
    const cross = (ab[0] * bc[1] - ab[1] * bc[0]) / lengths
    const dot = (ab[0] * bc[0] + ab[1] * bc[1]) / lengths
    const turn = Math.abs(Math.atan2(cross, dot))
    const limit = (15 * Math.PI) / 180
    return turn >= limit && turn <= Math.PI - limit
  }
  /**
   * Where the two legs' offset rows cross — the corner's mitre point. It is inside
   * both runs exactly when the legs really turn there, which is also the check that
   * keeps a near-straight junction from throwing a post far off to one side.
   */
  const segmentLine = (index: number) => {
      const start = physical[index]
      const end = physical[index + 1]
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      if (length <= 0.001) return null
      const direction: [number, number] = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
      const normal: [number, number] = [-direction[1], direction[0]]
    return { origin: [start[0], start[1]] as [number, number], direction, normal, length }
  }
  /** A row of a segment: the segment's path line shifted by `ratio` x 排距. */
  const rowLine = (index: number, ratio: number) => {
    const line = segmentLine(index)
    if (!line) return null
    return {
      origin: [
        line.origin[0] + line.normal[0] * parameters.width * ratio,
        line.origin[1] + line.normal[1] * parameters.width * ratio,
      ] as [number, number],
      direction: line.direction,
      normal: line.normal,
      length: line.length,
    }
  }
  /** Where two lines meet, with how far along each: `null` when they are parallel. */
  const linesMeet = (
    a: { origin: [number, number]; direction: [number, number] },
    b: { origin: [number, number]; direction: [number, number] },
  ) => {
    const denominator = a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0]
    if (Math.abs(denominator) < 1e-6) return null
    const dx = b.origin[0] - a.origin[0]
    const dy = b.origin[1] - a.origin[1]
    return {
      point: [
        a.origin[0] + a.direction[0] * ((dx * b.direction[1] - dy * b.direction[0]) / denominator),
        a.origin[1] + a.direction[1] * ((dx * b.direction[1] - dy * b.direction[0]) / denominator),
      ] as [number, number],
      alongA: (dx * b.direction[1] - dy * b.direction[0]) / denominator,
      alongB: (dx * a.direction[1] - dy * a.direction[0]) / denominator,
    }
  }

  // A short leg can already be extended by its OTHER (convex) corner. Resolve
  // that envelope from the two adjacent lines, independently of traversal order.
  const offsetRowLimits = (index: number) => {
    const row = rowLine(index, 1)!
    let start = 0, end = row.length
    const previous = previousSegment(index), next = nextSegment(index)
    if ((pathIsClosed || index > 0) && turnIsCorner(previous)) {
      const other = rowLine(previous, 1)
      const crossing = other && linesMeet(row, other)
      if (crossing && crossing.alongA < 0 && crossing.alongA >= -parameters.width - 0.001
        && crossing.alongB >= other.length - 0.001
        && crossing.alongB <= other.length + parameters.width + 0.001) start = crossing.alongA
    }
    if ((pathIsClosed || index < segmentCount - 1) && turnIsCorner(index)) {
      const other = rowLine(next, 1)
      const crossing = other && linesMeet(row, other)
      if (crossing && crossing.alongA > row.length && crossing.alongA <= row.length + parameters.width + 0.001
        && crossing.alongB <= 0.001 && crossing.alongB >= -parameters.width - 0.001) end = crossing.alongA
    }
    return { start, end }
  }

  const offsetRowCrossing = (junction: number) => {
    const a = rowLine(junction, 1)
    const b = rowLine(nextSegment(junction), 1)
    if (!a || !b) return null
    const denominator = a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0]
    if (Math.abs(denominator) < 1e-6) return null
    const dx = b.origin[0] - a.origin[0]
    const dy = b.origin[1] - a.origin[1]
    const alongA = (dx * b.direction[1] - dy * b.direction[0]) / denominator
    const alongB = (dx * a.direction[1] - dy * a.direction[0]) / denominator
    const aLimits = offsetRowLimits(junction), bLimits = offsetRowLimits(nextSegment(junction))
    const inside = alongA >= aLimits.start - 0.001 && alongA <= a.length + 0.001
      && alongB >= -0.001 && alongB <= bLimits.end + 0.001
    // The offset rows are laid to the LEFT of each leg, so a turn that way puts them
    // inside the corner and they cross within both runs. A turn the other way leaves
    // them outside it, each stopping one 排距 short of the other — the convex corner,
    // where the rows have to be carried on to their crossing, or the two frames never
    // meet. Further apart than that is not this junction's corner at all.
    const slack = parameters.width + 0.001
    const meetsAtTheEnd = Math.abs(alongA - a.length) <= slack && Math.abs(alongB) <= slack
    // A short inside leg can put the crossing BEFORE its start or AFTER the
    // other leg's end. That is not a convex corner and cannot be extended here.
    const outside = alongA >= a.length - 0.001 && alongB <= 0.001
    if (!inside && !(outside && meetsAtTheEnd)) return null
    return {
      inside,
      alongA,
      alongB,
      aNormal: a.normal,
      bNormal: b.normal,
      // Which side actually falls short: a run that already passes the crossing (or
      // ends on it) is left alone, only the short one is carried on.
      reachesFromA: alongA > a.length + 0.001,
      reachesFromB: alongB < -0.001,
      point: [
        round(a.origin[0] + a.direction[0] * alongA),
        0,
        round(a.origin[1] + a.direction[1] * alongA),
      ] as Vector3Tuple,
      normal: a.normal,
    }
  }
  /**
   * Every row of a segment runs on to the OTHER leg's offset row line, so a corner has
   * each segment's 纵向水平杆 all the same length — 内排, 外排 and 填芯 alike, which is
   * also what the site needs to buy and cut (7.1 m + 1.1 m of corner = 8.2 m -> 6+2.4;
   * 4.3 m + 1.1 m = 5.4 m -> a single 6 m tube). An intersection that is not beyond the
   * row's own end is no extension at all, which is why an inside corner (the offset rows
   * already crossing within both legs) adds nothing here.
   *
   * The two legs' 填芯 therefore cross at a point in the corner square — a 转向扣 joint
   * on site, which is not counted here.
   */
  const offsetRowExtensions: Array<{
    atStart: Map<number, Vector3Tuple>
    atEnd: Map<number, Vector3Tuple>
  }> = physical.slice(0, -1).map(() => ({ atStart: new Map(), atEnd: new Map() }))
  const rowRatios = supportRailCount > 1
    ? Array.from({ length: supportRailCount }, (_, index) => index / (supportRailCount - 1))
    : [0, 1]
  /**
   * Stations that get no 槽钢: at a turning junction the outgoing leg's first station
   * would lay its beam across the incoming leg's last one — two channels crossing at
   * the corner post. The site picks ONE direction through the corner and keeps it, so
   * that station is left out and the corner's own beam (below) covers both posts.
   */
  const skippedChannels = new Set<string>()
  /**
   * The corner square of a convex junction — the 0.9 x 0.9 m between the building's
   * corner post and the carried-on runs. It is framed on all four sides (the other
   * leg's 内排 and 外排 runs), so a 作业层 lays a 钢笆 piece there and the platform
   * continues around the corner instead of stopping at it.
   */
  const cornerDecks: Array<{ points: Vector3Tuple[]; pathSegment: number }> = []
  /** The one offset-row post each corner keeps, standing on the mitre point. */
  const mitrePosts: Array<{
    point: Vector3Tuple
    normal: [number, number]
    pathSegment: number
    parity: number
    beamCentre: Vector3Tuple
  }> = []
  const joinedCorners = new Set<number>()
  const offsetPostLimits = physical.slice(0, -1).map(() => ({ start: -Infinity, end: Infinity }))
  const cornerStations: number[][] = physical.slice(0, -1).map(() => [])
  for (const junction of segmentOrder) {
    if (!pathIsClosed && junction === segmentCount - 1) continue
    const outgoing = nextSegment(junction)
    if (!turnIsCorner(junction)) continue
    // Nothing is dropped unless the replacement can stand there. A short leg, a wide
    // turn or a stub inserted by hand can put the crossing outside both runs, and
    // dropping the two posts then would leave the corner — or a whole short leg —
    // with no uprights at all, which is exactly what it must never do.
    const crossing = offsetRowCrossing(junction)
    if (!crossing) {
      warnings.push({ id: `short-corner-${junction}`, message: `第 ${junction + 1}、${outgoing + 1} 段转角的偏移排交点超出短边，保留原站位和横向杆，未自动合并角柱，请调整短边或排距。` })
      continue
    }
    joinedCorners.add(junction)
    cornerStations[junction].push(crossing.alongA)
    cornerStations[outgoing].push(crossing.alongB)
    skippedChannels.add(`${outgoing}:0`)
    const incomingParity = (1 + stationOffsets[junction] + segmentBays[junction]) % 2
    let mitreParity = incomingParity
    let beamCentre = crossing.point

    const reach = parameters.width * 2
    for (const ratio of rowRatios) {
      const incomingRow = rowLine(junction, ratio)
      const outgoingRow = rowLine(outgoing, ratio)
      const incomingOuter = rowLine(junction, 1)
      const outgoingOuter = rowLine(outgoing, 1)
      if (!incomingRow || !outgoingRow || !incomingOuter || !outgoingOuter) continue
      // The incoming leg's rows all reach the outgoing leg's 外排 line.
      const forward = linesMeet(incomingRow, outgoingOuter)
      if (forward && forward.alongA > incomingRow.length + 0.001
        && forward.alongA < incomingRow.length + reach) {
        offsetRowExtensions[junction].atEnd.set(ratio, [
          round(forward.point[0]),
          0,
          round(forward.point[1]),
        ])
      }
      // The outgoing leg's rows reach the same line, so its three rows are flush with
      // each other. The two legs' 填芯 then cross at a point in the corner (tied with a
      // 转向扣 on site, which this model does not count) rather than one stopping short
      // and leaving that row visibly short of its neighbours.
      const backward = linesMeet(outgoingRow, incomingOuter)
      if (backward && backward.alongA < -0.001 && backward.alongA > -reach) {
        offsetRowExtensions[outgoing].atStart.set(ratio, [
          round(backward.point[0]),
          0,
          round(backward.point[1]),
        ])
      }
    }

    if (crossing.inside) {
      offsetPostLimits[junction].end = Math.min(offsetPostLimits[junction].end, crossing.alongA)
      offsetPostLimits[outgoing].start = Math.max(offsetPostLimits[outgoing].start, crossing.alongB)
      skippedOffsetPosts.add(`${junction}:${segmentBays[junction]}`)
      skippedOffsetPosts.add(`${outgoing}:0`)
    } else {
      // Convex corner: the posts at the runs' old ends stay — they are what carries the
      // extension — and the corner post is added on the crossing.
      mitreParity = (incomingParity + 1) % 2
      // One beam under both corner posts, in the incoming leg's direction: the corner
      // region keeps ONE channel direction instead of two crossing each other.
      const partner: Vector3Tuple = [
        round(physical[junction + 1][0] + crossing.bNormal[0] * parameters.width),
        0,
        round(physical[junction + 1][1] + crossing.bNormal[1] * parameters.width),
      ]
      beamCentre = [
        round((crossing.point[0] + partner[0]) / 2),
        0,
        round((crossing.point[2] + partner[2]) / 2),
      ]
    }
    // Both legs' rows now run through each other's junction station (the 横向杆 there was
    // never emitted — the neighbouring segment's row spans it, see `isInternalPathNode`),
    // so a convex corner is also what frames the square 钢笆 piece laid below.
    if (offsetRowExtensions[outgoing].atStart.size > 0) {
      const corner = physical[junction + 1]
      const offsetBy = (normal: [number, number]): Vector3Tuple => [
        round(corner[0] + normal[0] * parameters.width),
        0,
        round(corner[1] + normal[1] * parameters.width),
      ]
      cornerDecks.push({
        points: [
          [round(corner[0]), 0, round(corner[1])],
          offsetBy(crossing.aNormal),
          crossing.point,
          offsetBy(crossing.bNormal),
        ],
        pathSegment: junction,
      })
    }
    mitrePosts.push({
      point: crossing.point,
      normal: crossing.normal,
      pathSegment: junction,
      parity: mitreParity,
      beamCentre,
    })
  }

  return { offsetRowExtensions: offsetRowExtensions.map(extension => ({ atStart: [...extension.atStart], atEnd: [...extension.atEnd] })),
    skippedOffsetPosts: [...skippedOffsetPosts], skippedChannels: [...skippedChannels], cornerDecks, mitrePosts,
    joinedCorners: [...joinedCorners], offsetPostLimits, cornerStations, warnings }
}
export type CornerTopology = ReturnType<typeof solveCornerTopology>

export function alignStationGrid(physical: PlanPoint[], parameters: TopologyParameters, cornerStations: number[][]) {
  return physical.slice(0, -1).map((_, segmentIndex) => {
    const start2d = physical[segmentIndex]
    const end2d = physical[segmentIndex + 1]
    const segmentLength = Math.hypot(end2d[0] - start2d[0], end2d[1] - start2d[1])
    if (segmentLength <= 0.001) return { segmentLength, stations: [], bayCount: 0, bayLength: 0, direction: [0, 0] as PlanPoint, normal: [0, 0] as PlanPoint }
    const bayCount = Math.max(1, Math.ceil(segmentLength / parameters.postSpacing - 1e-9))
    const bayLength = segmentLength / bayCount
    const stations = Array.from({ length: bayCount + 1 }, (_, index) => index * bayLength)
    // Share a nearby corner station across BOTH rows, its crossbar, base and deck
    // bay. Never move an outline endpoint or increase a bay beyond the spacing.
    for (const anchor of [...cornerStations[segmentIndex]].sort((a, b) => a - b)) {
      if (anchor <= 0.001 || anchor >= segmentLength - 0.001) continue
      const nearest = stations.reduce((best, value, index) =>
        Math.abs(value - anchor) < Math.abs(stations[best] - anchor) ? index : best, 0)
      if (nearest === 0 || nearest === bayCount || Math.abs(stations[nearest] - anchor) > 0.25) continue
      if (anchor - stations[nearest - 1] > parameters.postSpacing + 0.001
        || stations[nearest + 1] - anchor > parameters.postSpacing + 0.001) continue
      stations[nearest] = anchor
    }
    const direction: [number, number] = [
      (end2d[0] - start2d[0]) / segmentLength,
      (end2d[1] - start2d[1]) / segmentLength,
    ]
    const normal: [number, number] = [-direction[1], direction[0]]
    return { segmentLength, stations, bayCount, bayLength, direction, normal }
  })
}
export type AlignedStations = ReturnType<typeof alignStationGrid>
export function retainedOffsetStations(stations: AlignedStations, corners: CornerTopology, requiredEndPairs: readonly (readonly [boolean, boolean])[], parameters: TopologyParameters) {
  const { offsetPostLimits, cornerStations } = corners, skippedOffsetPosts = new Set(corners.skippedOffsetPosts)
  return stations.map(({ stations, bayCount, segmentLength }, segmentIndex) => stations.map((_, station) => {
    const limits = offsetPostLimits[segmentIndex], anchors = cornerStations[segmentIndex]
    const requiredPair = (station === 0 && requiredEndPairs[segmentIndex]?.[0]) || (station === bayCount && requiredEndPairs[segmentIndex]?.[1])
    const nearTrimmedCorner = (station === 0 && limits.end > 0 && limits.end <= 0.25
      && anchors.some(anchor => anchor < -0.001 && limits.end - anchor <= parameters.postSpacing + 0.001))
      || (station === bayCount && segmentLength - limits.start > 0 && segmentLength - limits.start <= 0.25
      && anchors.some(anchor => anchor > segmentLength + 0.001 && anchor - limits.start <= parameters.postSpacing + 0.001))
    return !!requiredPair || !(nearTrimmedCorner || skippedOffsetPosts.has(`${segmentIndex}:${station}`)
      || stations[station] > limits.end + 0.001 || stations[station] < limits.start - 0.001)
  }))
}
