import { describe, expect, it } from 'vitest'
import {
  calculateScaffold,
  countMembers,
  CONNECTOR_LABELS,
  COUPLER_PACK_SIZE,
  DECK_PANEL,
  DECK_PANEL_LAP,
  DECK_PANEL_ROW_GAP,
  DECK_PANEL_SIZES,
  deckPanelCount,
  DEFAULT_PARAMETERS,
  TOP_POST_EXTENSION,
  GUARDRAIL_TOP_EDGE,
  SPLICE_STAGGER,
  SWEEP_BAR_LAYER,
  type ScaffoldLayout,
} from './scaffold'

/** Tube centreline offset used when checking a rail's 上皮. */
const HALF_PIPE = DEFAULT_PARAMETERS.pipeDiameter / 2

const points = [
  { id: 'P1', x: 0, y: 0 },
  { id: 'P2', x: 200, y: 0 },
  { id: 'P3', x: 200, y: 200 },
]

describe('calculateScaffold', () => {
  it('deduplicates the outer post shared by an L-shaped corner', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const outerCornerPosts = layout.members.filter(
      (member) => member.type === 'post' && member.start[0] === 3.6 && member.start[2] === 0,
    )

    // 2 rows × 3 stations × 2 segments = 12, less the shared outer corner post, less
    // the two posts the junction does not need, plus the single post that replaces
    // them on the mitre point (see below).
    expect(outerCornerPosts).toHaveLength(1)
    expect(countMembers(layout).post).toBe(10)
  })

  it('drops the offset row\'s post on either side of a corner', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const postAt = (x: number, z: number) => layout.members.filter(
      (member) => member.type === 'post' && member.start[0] === x && member.start[2] === z,
    )

    // The corner is at (3.6, 0). The incoming segment used to end with a post at
    // (3.6, 0.9) — sitting on the outgoing segment's 外排 line — and the outgoing one
    // used to start with a post at (2.7, 0), on the incoming one's. Both are inside a
    // bay of the shared corner post and the legs cross there, so both go.
    expect(postAt(3.6, 0)).toHaveLength(1)
    expect(postAt(3.6, 0.9)).toHaveLength(0)
    expect(postAt(2.7, 0)).toHaveLength(0)
    // …and the two rows now meet on ONE post at their crossing (2.7, 0.9) instead,
    // which is what closes the corner: the offset row runs through it either way, so
    // when that row is the railed 外排 the 栏杆 are carried around the corner too.
    expect(postAt(2.7, 0.9)).toHaveLength(1)
    // The 纵向水平杆 are untouched: both rows still run to their own end points on
    // every lift, plus the 扫地杆 layer.
    expect(layout.members.filter((member) => member.type === 'longitudinal').length)
      .toBe(2 * 2 * (DEFAULT_PARAMETERS.layerCount + 1))
  })

  it('staggers the butt joints of neighbouring posts', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const rowPosts = layout.members
      .filter((member) => member.type === 'post' && member.start[2] === 0)
      .sort((a, b) => a.start[0] - b.start[0])
    const planOf = (memberId: string) =>
      layout.materials.assemblyPlans.find((assembly) => assembly.memberId === memberId)!
    const jointsOf = (memberId: string) => {
      let cursor = 0
      return planOf(memberId).stockLengths.slice(0, -1).map((stock) => (cursor += stock))
    }

    // Three posts along the 外排 line. Neighbours must not share a joint height
    // (JGJ 130-2011 §6.3.6, at least 500 mm apart); the two posts of the same parity
    // are built the same way.
    expect(rowPosts).toHaveLength(3)
    const [first, second, third] = rowPosts.map((post) => jointsOf(post.id))
    expect(third).toEqual(first)
    expect(second).not.toEqual(first)
    for (const a of first) {
      for (const b of second) expect(Math.abs(a - b)).toBeGreaterThanOrEqual(SPLICE_STAGGER - 0.001)
    }
    // A genuinely different mix, not just the same tubes in another order — and a
    // different TOTAL length, because a same-length one is indistinguishable from
    // its neighbour both on site and in the 3D view.
    expect(planOf(rowPosts[1].id).stockLengths.join('+'))
      .not.toBe(planOf(rowPosts[0].id).stockLengths.join('+'))
    expect(planOf(rowPosts[1].id).effectiveLength)
      .toBeGreaterThan(planOf(rowPosts[0].id).effectiveLength)
    // 11.88 m of railed post: 6+6 (12 m) beside 2.4+6+4 (12.4 m) — the cheapest mix
    // that differs in BOTH the joint heights (2.4 / 8.4 against 6) and the total.
    expect(planOf(rowPosts[0].id).stockLengths).toEqual([6, 6])
    expect(planOf(rowPosts[1].id).stockLengths).toEqual([2.4, 6, 4])
    expect(SPLICE_STAGGER).toBe(0.5)
  })

  it('follows the chosen 钢笆片 size, whose width the 排距 follows too', () => {
    // A 4.8 m run at 2.4 m bays, so the panel length actually changes the count.
    const longPanel = calculateScaffold(points.slice(0, 2), [4.8], { ...DEFAULT_PARAMETERS, postSpacing: 2.4 })
    const shortPanel = calculateScaffold(points.slice(0, 2), [4.8], {
      ...DEFAULT_PARAMETERS,
      postSpacing: 2.4,
      deckPanelLength: 1,
    })
    const perLift = (layout: ScaffoldLayout) =>
      layout.materials.deckCount / new Set(layout.decks.map((deck) => deck.layer)).size

    expect(DECK_PANEL_SIZES.lengths).toEqual([1, 1.2])
    expect(DECK_PANEL_SIZES.widths).toEqual([0.75, 0.8, 0.95])
    // 2 bays of 2.4 m, every joint lapped by 100 mm: three 1.2 m pieces along
    // (2.4 = 1.2 + 1.1 + 0.1) or three 1 m pieces (2.4 = 1 + 0.9 + 0.5).
    expect(DECK_PANEL_LAP).toBe(0.1)
    expect(perLift(longPanel)).toBe(6)
    expect(perLift(shortPanel)).toBe(6)
    // The lap only shows up where the arithmetic needs it: a 1.2 m bay still takes
    // one piece, and a 2.0 m bay takes two 1.2 m pieces but three 1 m ones.
    expect(deckPanelCount(1.2, 1.2)).toBe(1)
    expect(deckPanelCount(2, 1.2)).toBe(2)
    expect(deckPanelCount(2, 1)).toBe(3)
    // The 排距 the UI writes when a width is chosen: the panel width less 0.05 m.
    expect(DECK_PANEL_ROW_GAP).toBe(0.05)
    expect(Number((DEFAULT_PARAMETERS.deckPanelWidth - DECK_PANEL_ROW_GAP).toFixed(2)))
      .toBe(DEFAULT_PARAMETERS.width)
    // A narrower panel means a wider 排距 takes two pieces across instead of one.
    const wideRow = calculateScaffold(points.slice(0, 2), [3.6], {
      ...DEFAULT_PARAMETERS,
      width: 0.85,
      deckPanelWidth: 0.95,
    })
    const wideRowNarrowPanel = calculateScaffold(points.slice(0, 2), [3.6], {
      ...DEFAULT_PARAMETERS,
      width: 0.85,
      deckPanelWidth: 0.8,
    })

    expect(wideRowNarrowPanel.materials.deckCount).toBe(wideRow.materials.deckCount * 2)
  })

  it('derives material totals from the generated members', () => {
    const layout = calculateScaffold(points.slice(0, 2), [5.8], DEFAULT_PARAMETERS)
    const memberLength = layout.members.reduce((sum, member) => sum + member.length, 0)

    expect(layout.materials.theoreticalLength).toBeCloseTo(memberLength, 2)
    expect(layout.materials.actualLength).toBeGreaterThanOrEqual(memberLength)
    expect(layout.materials.utilization).toBeGreaterThan(0)
  })

  it('adds a third deck support rail without adding posts', () => {
    const parameters = { ...DEFAULT_PARAMETERS, deckSupportRailCount: 3 }
    const layout = calculateScaffold(points.slice(0, 2), [3.6], parameters)
    const twoRailLayout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const liftTransverse = layout.members.find((member) => member.type === 'transverse' && member.layer === 1)
    const sweepTransverse = layout.members.find(
      (member) => member.type === 'transverse' && member.layer === SWEEP_BAR_LAYER,
    )

    expect(countMembers(layout).post).toBe(6)
    expect(countMembers(layout).post).toBe(countMembers(twoRailLayout).post)
    // The extra rail is one more longitudinal row on every decked lift, and the
    // 扫地杆 layer deliberately gains nothing from it.
    const deckedLifts = new Set(layout.decks.map((deck) => deck.layer)).size
    expect(countMembers(layout).longitudinal - countMembers(twoRailLayout).longitudinal).toBe(deckedLifts)
    expect(liftTransverse?.connectionPoints).toHaveLength(3)
    expect(sweepTransverse?.connectionPoints).toHaveLength(2)
    // The 横向杆 spans the 排距 only; the bought tube is what overhangs it.
    expect(liftTransverse?.length).toBeCloseTo(parameters.width, 3)
    // 2 bays per decked lift, each covered by whole 0.95 × 1.2 m 钢笆片.
    const panelsPerBay = Math.ceil(1.8 / DECK_PANEL.length)
    expect(layout.decks).toHaveLength(2 * panelsPerBay * deckedLifts)
    expect(layout.materials.deckCount).toBe(layout.decks.length)
  })

  it('buys the 1.2 m site tube for the 横向杆 and lets it overhang the 排距', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const transverse = layout.members.find((member) => member.type === 'transverse')!
    const segments = layout.pipeSegments.filter((segment) => segment.memberId === transverse.id)

    // The confirmed field 排距 is narrower than the tube the site buys for the
    // 横向杆, so NO 管端外伸 is added to the member itself.
    expect(DEFAULT_PARAMETERS.width).toBe(0.9)
    expect(transverse.length).toBeCloseTo(DEFAULT_PARAMETERS.width, 3)
    expect(transverse.length).not.toBeCloseTo(DEFAULT_PARAMETERS.width + DEFAULT_PARAMETERS.tubeEndExtension * 2, 3)
    // The path runs along +x, so the transverse direction is +z: one 1.2 m stock
    // tube, centred on the post pair, overhanging each 立杆 by half the surplus.
    expect(segments).toHaveLength(1)
    expect(segments[0].stockLength).toBe(1.2)
    expect(segments[0].start[2]).toBeCloseTo(-(1.2 - DEFAULT_PARAMETERS.width) / 2, 3)
    expect(segments[0].end[2]).toBeCloseTo(DEFAULT_PARAMETERS.width + (1.2 - DEFAULT_PARAMETERS.width) / 2, 3)
  })

  it('covers a bay with whole 0.95 × 1.2 m 钢笆片 and keeps the covered area geometric', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const deckedLifts = new Set(layout.decks.map((deck) => deck.layer)).size

    // The 0.95 m side spans the 0.9 m 排距, the 1.2 m side runs along the bay, so a
    // 1.8 m bay takes two whole pieces.
    expect(DECK_PANEL.width).toBe(0.95)
    expect(DECK_PANEL.length).toBe(1.2)
    expect(layout.materials.deckCount).toBe(deckedLifts * 2 * 2)
    // 覆盖面积 stays the area actually covered, which the cut piece at the end of a
    // bay cannot exceed — the pieces bought cover more than the scaffold does.
    expect(layout.materials.deckArea).toBeCloseTo(deckedLifts * 2 * 1.8 * DEFAULT_PARAMETERS.width, 3)
    expect(layout.materials.deckArea).toBeLessThan(
      layout.materials.deckCount * DECK_PANEL.width * DECK_PANEL.length,
    )
  })

  it('splits tall posts into overlapping standard stock pipes', () => {
    const parameters = { ...DEFAULT_PARAMETERS, layerCount: 7 }
    const layout = calculateScaffold(points.slice(0, 2), [3.6], parameters)
    const innerPost = layout.members.find((member) => member.type === 'post' && member.end[1] > 13)!
    const segments = layout.pipeSegments.filter((segment) => segment.memberId === innerPost.id)

    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((segment) => parameters.stockLengths.includes(segment.stockLength))).toBe(true)
    expect(segments.every((segment) => segment.stockLength <= Math.max(...parameters.stockLengths))).toBe(true)
    // One 对接扣件 per butt joint: a sleeve joins two tube ends, so a joint takes
    // exactly one coupler, not one per side.
    expect(layout.connectors.filter((connector) => connector.type === 'butt' && connector.memberId === innerPost.id))
      .toHaveLength(segments.length - 1)
    // 理论搭设高度 0.3 + 1.88 × 7 = 13.46 m, and the bought tube combination only
    // ever goes above it.
    expect(layout.materials.postHeights.theoretical).toBeCloseTo(13.46, 3)
    expect(Math.max(...segments.map((segment) => segment.end[1]))).toBeGreaterThan(13.46)
    const plan = layout.materials.assemblyPlans.find((assembly) => assembly.memberId === innerPost.id)!
    // effectiveLength is rounded by the domain, so compare to 3 decimals.
    expect(plan.effectiveLength).toBeCloseTo(
      plan.stockLengths.reduce((sum, length) => sum + length, 0) - parameters.spliceOverlap * (plan.stockLengths.length - 1),
      3,
    )
  })

  it('treats a long longitudinal run as one assembly of stock pipes', () => {
    const layout = calculateScaffold(points.slice(0, 2), [7.2], DEFAULT_PARAMETERS)
    const longitudinal = layout.members.find((member) => member.type === 'longitudinal')!
    const segments = layout.pipeSegments.filter((segment) => segment.memberId === longitudinal.id)

    expect(longitudinal.length).toBeGreaterThan(Math.max(...DEFAULT_PARAMETERS.stockLengths))
    expect(segments.length).toBeGreaterThan(1)
    // Butt joints: each tube starts exactly where the previous one ends.
    expect(DEFAULT_PARAMETERS.spliceOverlap).toBe(0)
    expect(segments[1].start).toEqual(segments[0].end)
    expect(segments.every((segment) => segment.overlapWithPrevious === 0)).toBe(true)
  })

  it('uses the confirmed field stock lengths', () => {
    expect([...DEFAULT_PARAMETERS.stockLengths].sort((a, b) => a - b)).toEqual([0.8, 1.2, 2, 2.4, 3, 4, 4.5, 6])
    // Every confirmed length must stay usable, which means the butt-joint
    // engagement has to be shorter than the shortest stock.
    expect(DEFAULT_PARAMETERS.spliceOverlap).toBeLessThan(Math.min(...DEFAULT_PARAMETERS.stockLengths))
  })

  it('adds a 扫地杆 layer with horizontal members but no deck and no support rails', () => {
    const parameters = { ...DEFAULT_PARAMETERS, deckSupportRailCount: 3 }
    const layout = calculateScaffold(points.slice(0, 2), [3.6], parameters)
    const sweepLongitudinal = layout.members.filter(
      (member) => member.layer === SWEEP_BAR_LAYER && member.type === 'longitudinal',
    )
    const sweepTransverse = layout.members.filter(
      (member) => member.layer === SWEEP_BAR_LAYER && member.type === 'transverse',
    )

    // Both are at the configured height, both longitudinal and transverse exist...
    expect(parameters.sweepBarHeight).toBe(0.2)
    expect(sweepLongitudinal).toHaveLength(2)
    expect(sweepTransverse).toHaveLength(3)
    expect(sweepLongitudinal.every((member) => member.start[1] === 0.2)).toBe(true)
    expect(sweepTransverse.every((member) => member.connectionPoints.length === 2)).toBe(true)
    // ...but no deck sits on it, which is why the support rails are absent.
    expect(layout.decks.some((deck) => deck.layer === SWEEP_BAR_LAYER)).toBe(false)
    expect(sweepLongitudinal.length).toBeLessThan(
      layout.members.filter((member) => member.layer === 1 && member.type === 'longitudinal').length,
    )
  })

  it('only carries deck support rails on lifts that actually have a deck', () => {
    const parameters = { ...DEFAULT_PARAMETERS, deckSupportRailCount: 3, deckLiftInterval: 2 }
    const layout = calculateScaffold(points.slice(0, 2), [3.6], parameters)
    const transverseAt = (layer: number) =>
      layout.members.find((member) => member.type === 'transverse' && member.layer === layer)

    // Layer 2 carries a deck so it has the rails; layer 1 does not.
    expect(transverseAt(2)?.connectionPoints).toHaveLength(3)
    expect(transverseAt(1)?.connectionPoints).toHaveLength(2)
    expect(layout.decks.every((deck) => deck.layer % 2 === 0)).toBe(true)
  })

  it('lays one 槽钢 under each pair of posts, aligned with the 1.2 m 横向杆', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const channels = layout.baseChannels
    const transverse = layout.members.find((member) => member.type === 'transverse')!
    const transverseTube = layout.pipeSegments.find((segment) => segment.memberId === transverse.id)!

    // Two bays => three post pairs, matching the three transverse stations.
    expect(channels).toHaveLength(3)
    expect(layout.materials.channelSteel.count).toBe(3)
    // The base beam is cut to the same length as the transverse tube above it, so
    // the two stay aligned (both 1.2 m here).
    expect(layout.materials.channelSteel.lengthPerPiece).toBeCloseTo(transverseTube.stockLength, 3)
    expect(layout.materials.channelSteel.totalLength).toBeCloseTo(
      layout.materials.channelSteel.lengthPerPiece * channels.length,
      3,
    )
    // The path runs along +x, so the transverse direction is +z: every channel
    // must therefore keep a constant x while spanning the tube length, centred on
    // the post pair.
    for (const channel of channels) {
      expect(channel.start[0]).toBeCloseTo(channel.end[0], 6)
      expect(Math.abs(channel.end[2] - channel.start[2])).toBeCloseTo(transverseTube.stockLength, 3)
      expect(channel.start[2]).toBeCloseTo(-(1.2 - DEFAULT_PARAMETERS.width) / 2, 3)
    }
  })

  it('does not duplicate a 槽钢 when two path segments share a corner', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const keys = layout.baseChannels.map((channel) =>
      [channel.start.join(':'), channel.end.join(':')].sort().join('|'))

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('excludes wall ties and leaves braces pending outside the layout', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)

    expect(layout.members.every((member) =>
      ['post', 'longitudinal', 'transverse', 'guardrail'].includes(member.type))).toBe(true)
    // 转向扣 only appears in 剪刀撑 and in 搭接 laps, neither of which is modelled.
    expect(layout.materials.connectorSummary.swivel).toBeNull()
    expect(Object.keys(CONNECTOR_LABELS)).toEqual(['cross', 'butt', 'swivel'])
  })

  it('puts 作业层 k at k × 步距 and derives the 搭设高度 from the count', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const elevations = [...new Set(layout.members
      .filter((member) => member.type === 'longitudinal' && member.layer !== undefined)
      .map((member) => member.start[1]))].sort((a, b) => a - b)

    // 扫地杆 (layer 0) at its own height, then the 作业层 — the FIRST one is a full
    // 步距 above the base, and the top one is `TOP_POST_EXTENSION` below the 立杆 top.
    expect(elevations).toEqual([0.2, 1.88, 3.76, 5.64, 7.52, 9.4])
    const liftGaps = elevations.slice(2).map((y, index) => Number((y - elevations[index + 1]).toFixed(3)))
    expect(liftGaps).toEqual([1.88, 1.88, 1.88, 1.88])
    expect(DEFAULT_PARAMETERS.layerCount).toBe(5)
    expect(TOP_POST_EXTENSION).toBe(0.3)
    expect(layout.materials.postHeights.theoretical).toBeCloseTo(0.3 + 1.88 * 5, 3)
  })

  it('takes the 作业层 count as the input and grows in whole 步距', () => {
    const layoutAt = (layerCount: number) =>
      calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, layerCount })
    const liftsAt = (layerCount: number) =>
      Math.max(...layoutAt(layerCount).members.map((member) => member.layer ?? 0))

    expect(DEFAULT_PARAMETERS.liftHeight).toBe(1.88)
    expect(liftsAt(1)).toBe(1)
    expect(liftsAt(4)).toBe(4)
    expect(liftsAt(5)).toBe(5)
    expect(liftsAt(6)).toBe(6)
    // 理论搭设高度 follows the count alone — no leftover to squeeze a 步距 into.
    expect(layoutAt(5).materials.postHeights.theoretical).toBeCloseTo(9.7, 3)
    expect(layoutAt(6).materials.postHeights.theoretical).toBeCloseTo(11.58, 3)
  })

  it('builds the railed row one 步距 taller so the top rail has a post to tie to', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const topRail = layout.members.find(
      (member) => member.type === 'guardrail' && member.layer === 5 && member.length > 2,
    )!

    // 5 作业层 → 理论 9.7 m, 顶层作业层 9.4 m. The 内侧 row against the building stops
    // there (bought as 6 + 4 = 10 m); the 外侧 row that carries the rails runs to
    // 9.7 + 1.88 + 0.3 = 11.88 m (bought as 6 + 6 = 12 m).
    expect(layout.materials.postHeights).toEqual({ theoretical: 9.7, inner: 10, outer: 12 })
    // The single rail is 居中 in the 步距, one radius above the 作业层.
    expect(topRail.start[1] + HALF_PIPE).toBeCloseTo(9.4 + 0.94 + 0.024, 3)
    expect(topRail.start[1] + HALF_PIPE).toBeLessThanOrEqual(layout.materials.postHeights.outer)
  })

  it('flags a rail that no post can carry instead of floating it', () => {
    // A 0.4 m 步距 cannot hold a 1.2 m 上栏杆 above the 顶层作业层, and the 立杆 is not
    // grown to suit it: that rail is dropped and reported, while the 中栏杆 that does
    // fit stays on the railed row.
    const layout = calculateScaffold(points.slice(0, 2), [3.6], {
      ...DEFAULT_PARAMETERS,
      liftHeight: 0.4,
      guardrailRailCount: 2,
    })
    const topLift = Math.max(...layout.members.map((member) => member.layer ?? 0))
    const topSideRails = layout.members.filter(
      (member) => member.type === 'guardrail' && member.layer === topLift && member.length > 3,
    )

    expect(new Set(topSideRails.map((rail) => Number((rail.start[1] - topLift * 0.4).toFixed(3)))))
      .toEqual(new Set([0.6]))
    expect(layout.warnings.find((warning) => warning.id === 'top-rail-height')?.message).toContain('上栏杆')
  })

  it('never places a rail above the posts that carry it', () => {
    for (const guardrailRailCount of [1, 2]) {
      for (const swapInnerOuter of [false, true]) {
        for (const layerCount of [1, 3, 5, 8]) {
          const layout = calculateScaffold(points.slice(0, 2), [3.6], {
            ...DEFAULT_PARAMETERS,
            layerCount,
            guardrailRailCount,
            swapInnerOuter,
          })
          const postTop = Math.max(...layout.members
            .filter((member) => member.type === 'post')
            .map((member) => member.end[1]))

          // A rail is only emitted where its row's post actually reaches, so the
          // floating rails that once sat above the posts cannot come back.
          for (const rail of layout.members.filter((member) => member.type === 'guardrail')) {
            expect(rail.start[1] + HALF_PIPE).toBeLessThanOrEqual(postTop + 0.001)
          }
        }
      }
    }
  })

  it('puts a single rail 居中 in the 步距 instead of at the 1.2 m edge', () => {
    const one = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const layerOne = one.members.find((member) => member.type === 'longitudinal' && member.layer === 1)!
    const railsAt = (layout: ScaffoldLayout) => layout.members
      .filter((member) => member.type === 'guardrail' && member.layer === 1 && member.length > 2)
      .map((rail) => Number((rail.start[1] - layerOne.start[1]).toFixed(3)))

    // 1.88 / 2 above the 作业层 — the site's single-rail position, not the 上栏杆.
    expect(DEFAULT_PARAMETERS.guardrailRailCount).toBe(1)
    expect(railsAt(one)).toEqual([0.94])

    // It follows the 步距 rather than a fixed number.
    const wide = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, liftHeight: 2 })
    const wideLayer = wide.members.find((member) => member.type === 'longitudinal' && member.layer === 1)!
    const wideRail = wide.members.find(
      (member) => member.type === 'guardrail' && member.layer === 1 && member.length > 2,
    )!

    expect(Number((wideRail.start[1] - wideLayer.start[1]).toFixed(3))).toBe(1)
  })

  it('lays one 居中 rail per guarded side by default and both rails when asked', () => {
    const one = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const two = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, guardrailRailCount: 2 })
    const sideRuns = (layout: ScaffoldLayout) =>
      layout.members.filter((member) => member.type === 'guardrail' && member.length > DEFAULT_PARAMETERS.width + 1)
    const deckedLifts = new Set(one.decks.map((deck) => deck.layer)).size

    // A site that only builds one rail per side is the common case, and that rail
    // sits 居中 in the 步距; §7.3.12(2)(4) 上栏杆 + 中栏杆 are opt-in.
    expect(DEFAULT_PARAMETERS.guardrailRailCount).toBe(1)
    expect(one.materials.guardrail.railCount).toBe(1)
    expect(two.materials.guardrail.railCount).toBe(2)
    expect(sideRuns(one)).toHaveLength(deckedLifts)
    expect(sideRuns(two)).toHaveLength(deckedLifts * 2)
    // Additional members, never a substitute: they are their own type, so the
    // ordinary longitudinal rows are untouched.
    const rails = one.members.filter((member) => member.type === 'guardrail')
    expect(rails.every((rail) => rail.layer !== SWEEP_BAR_LAYER)).toBe(true)
    expect(rails.every((rail) => one.decks.some((deck) => deck.layer === rail.layer))).toBe(true)
  })

  it('puts the top rail 1.2 m above the 作业层 and the mid rail centred below it', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, guardrailRailCount: 2 })
    const layer = layout.members.find((member) => member.type === 'longitudinal' && member.layer === 1)!
    const heights = layout.members
      .filter((member) => member.type === 'guardrail' && member.layer === 1 && member.length > 2)
      .map((rail) => Number((rail.start[1] - layer.start[1]).toFixed(3)))

    // §7.3.12(2) gives 上栏杆上皮 1.2 m, so the centreline sits one radius lower;
    // §7.3.12(4) only says the mid rail is 居中.
    expect(GUARDRAIL_TOP_EDGE).toBe(1.2)
    expect([...new Set(heights)].sort((a, b) => a - b)).toEqual([0.6, GUARDRAIL_TOP_EDGE - 0.024])
  })

  it('caps a deckless top lift with the 架顶栏杆', () => {
    // Decks land on layer 3 only, so layers 4 and 5 have no 作业层 of their own.
    const parameters = { ...DEFAULT_PARAMETERS, layerCount: 5, deckLiftInterval: 3 }
    const layout = calculateScaffold(points.slice(0, 2), [3.6], parameters)
    const topRails = layout.members.filter(
      (member) => member.type === 'guardrail' && member.layer === 5 && member.length > 2,
    )

    expect(layout.decks.some((deck) => deck.layer === 5)).toBe(false)
    // The rail is still required: it is the one that carries the top of the scaffold.
    expect(topRails).toHaveLength(1)
    const postTop = Math.max(...layout.members
      .filter((member) => member.type === 'post')
      .map((member) => member.end[1]))
    expect(topRails[0].start[1] + HALF_PIPE).toBeLessThanOrEqual(postTop + 0.001)
  })

  it('returns the rails across an open end, but not a closed one', () => {
    const open = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const closed = calculateScaffold(
      [points[0], points[1], { id: 'P3', x: 0, y: 0 }],
      [3.6, 3.6],
      DEFAULT_PARAMETERS,
    )

    // JGJ 80-2016 §4.1.1: a scaffold end is itself a 临边.
    expect(open.materials.guardrail.endRuns).toBeGreaterThan(0)
    expect(closed.materials.guardrail.endRuns).toBe(0)
  })

  it('ties each rail to every post it crosses with one 十字扣', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const rail = layout.members.find((member) => member.type === 'guardrail' && member.length > 2)!

    // A 3.6 m run at 1.8 m bays has 3 posts. The physical rule is one coupler per
    // rail per post (JGJ 130-2011 §7.3.5(1)); the 条文说明 "2 per metre" figure is a
    // dead-load normalisation that assumes a post every metre.
    expect(rail.connectionPoints).toHaveLength(3)
    expect(layout.connectors.filter((connector) => connector.memberId === rail.id && connector.type === 'cross'))
      .toHaveLength(3)
  })

  it('puts the rails on the 外排 and follows the side the user says the building is on', () => {
    const pathSide = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const offsetSide = calculateScaffold(points.slice(0, 2), [3.6], {
      ...DEFAULT_PARAMETERS,
      swapInnerOuter: true,
    })
    // The path runs along +x, so the offset row is the one at z = 排距. Side runs are
    // long; an end return spans the width.
    const rowOf = (layout: ScaffoldLayout, z: number) =>
      layout.members.filter((member) =>
        member.type === 'guardrail' && member.length > DEFAULT_PARAMETERS.width + 1
        && member.start[2] === z)

    // §7.3.12(1) mandates the 外立杆 and the inner row is a gap to the building, so
    // there is no way to guard both sides — only to say WHICH side is the outside.
    expect(rowOf(pathSide, 0).length).toBeGreaterThan(0)
    expect(rowOf(pathSide, 0.9)).toHaveLength(0)
    expect(rowOf(offsetSide, 0)).toHaveLength(0)
    expect(rowOf(offsetSide, 0.9).length).toBeGreaterThan(0)
    // …and it is the 外排 that is built one 步距 taller to carry them.
    expect(pathSide.materials.postHeights).toEqual({ theoretical: 9.7, inner: 10, outer: 12 })
    expect(offsetSide.materials.postHeights).toEqual({ theoretical: 9.7, inner: 10, outer: 12 })
    expect(pathSide.warnings.find((warning) => warning.id === 'top-rail-height')).toBeUndefined()
    expect(offsetSide.warnings.find((warning) => warning.id === 'top-rail-height')).toBeUndefined()
  })

  it('builds an open end\'s two posts to the railed height so the top return closes', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const innerHeights = layout.members
      .filter((member) => member.type === 'post' && member.start[2] > 0.5)
      .map((member) => member.end[1])
      .sort((a, b) => a - b)

    // The inner row is the one against the building, so its middle post stops at the
    // 理论搭设高度 9.7 m — but the two END posts of that same row stand at the open ends
    // (nothing is against a wall there) and are built to the railed 11.88 m.
    expect(innerHeights).toEqual([9.7, 11.88, 11.88])
    // Which is what lets the 顶层 折返栏杆 be tied across at 10.34 m instead of going
    // missing: 2 ends × 1 rail.
    const topReturns = layout.members.filter(
      (member) => member.type === 'guardrail' && member.layer === 5 && member.length < 2,
    )
    expect(topReturns).toHaveLength(2)
    expect(topReturns.every((rail) => rail.start[1] === 10.34)).toBe(true)
  })

  it('drops a rail that would land on the next lift horizontal', () => {
    // A 1.2 m 步距 pushes the 1.2 m-high 上栏杆 onto the next lift's longitudinal
    // member, so two coincident tubes must not both be emitted. The mid rail still
    // fits, which is why it survives.
    const tight = calculateScaffold(points.slice(0, 2), [3.6], {
      ...DEFAULT_PARAMETERS,
      liftHeight: 1.2,
      guardrailRailCount: 2,
    })
    const layerOne = tight.members.filter(
      (member) => member.type === 'guardrail' && member.layer === 1 && member.length > 2,
    )
    const nextLift = tight.members.find(
      (member) => member.type === 'longitudinal' && member.layer === 2,
    )!

    expect(layerOne).toHaveLength(1)
    expect(Math.abs(layerOne[0].start[1] - nextLift.start[1])).toBeGreaterThan(0.05)
  })

  it('lists the site materials outside the calculation with an unknown quantity', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const pending = layout.materials.pendingMaterials

    expect(pending.map((material) => material.id)).toEqual(['brace', 'bindingWire', 'padPlate', 'formwork'])
    expect(pending.map((material) => material.label)).toEqual(['剪刀撑', '扎丝', '小垫板', '支模板'])
    // 扎丝 is bought as a bundle of wire, not by weight.
    expect(pending.map((material) => material.unit)).toEqual(['根', '捆', '块', 'm²'])
    // Couplers are counted individually but bagged 30 to a 包.
    expect(COUPLER_PACK_SIZE).toBe(30)
  })

  it('keeps the sweep bar inside the 200 mm the standard allows, and flags it if raised', () => {
    // JGJ 130-2011 §6.3.2 caps the longitudinal sweep bar at 200 mm above the tube
    // bottom, so the default sits exactly on the limit and stays quiet.
    expect(DEFAULT_PARAMETERS.sweepBarHeight).toBe(0.2)
    const compliant = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    expect(compliant.warnings.find((item) => item.id === 'sweep-bar-height')).toBeUndefined()

    const raised = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, sweepBarHeight: 0.3 })
    expect(raised.warnings.find((item) => item.id === 'sweep-bar-height')?.message).toContain('200 mm')
  })

  it('flags a lap joint, which needs 旋转扣件 rather than 对接扣件', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, spliceOverlap: 1 })

    expect(layout.warnings.find((item) => item.id === 'lap-not-modelled')).toBeDefined()
    // Still unknown, because laps are not modelled — flagged rather than faked.
    expect(layout.materials.connectorSummary.swivel).toBeNull()
  })

  it('does not generate transverse members on shared path corners', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const corner = [3.6, DEFAULT_PARAMETERS.liftHeight, 0]
    const cornerTransverse = layout.members.filter((member) =>
      member.type === 'transverse' && member.connectionPoints.some((point) =>
        point.every((value, index) => value === corner[index])))

    expect(cornerTransverse).toHaveLength(0)
  })

  it('ties both rows to the corner\'s mitre post', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const mitrePost = layout.members.find(
      (member) => member.type === 'post' && member.start[0] === 2.7 && member.start[2] === 0.9,
    )!
    // Both offset rows run through the mitre point at every lift, so the post is tied
    // to four runs there — the two rows, at each of the lifts they reach.
    // Coincident ties are nudged apart for rendering, so compare within that nudge.
    const ties = layout.connectors.filter((connector) =>
      connector.type === 'cross'
      && Math.abs(connector.position[0] - mitrePost.start[0]) < 0.05
      && Math.abs(connector.position[2] - mitrePost.start[2]) < 0.05)

    expect(mitrePost.end[1]).toBe(9.7)
    // Two runs reach the mitre post at every level — the two offset rows — and the
    // 扫地杆 layer crosses it too, so `layerCount + 1` levels of two ties each.
    expect(ties).toHaveLength((DEFAULT_PARAMETERS.layerCount + 1) * 2)
    // …and its own base beam, like every other post.
    expect(layout.baseChannels.filter((channel) =>
      Math.hypot((channel.start[0] + channel.end[0]) / 2 - 2.7, (channel.start[2] + channel.end[2]) / 2 - 0.9) < 0.001))
      .toHaveLength(1)
  })

  it('keeps rendered connector positions unique', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const positions = layout.connectors.map((connector) => connector.position.join(':'))

    expect(new Set(positions).size).toBe(positions.length)
  })

  it('does not emit physically identical pipe segments', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const segmentKeys = layout.pipeSegments.map((segment) =>
      [segment.start.join(':'), segment.end.join(':')].sort().join('|'))

    expect(new Set(segmentKeys).size).toBe(segmentKeys.length)
  })

  it('accepts legacy parameter objects without newly added fields', () => {
    const legacy = { ...DEFAULT_PARAMETERS, rowCount: 3 } as Partial<typeof DEFAULT_PARAMETERS> & { rowCount: number }
    delete legacy.deckSupportRailCount
    delete legacy.tubeEndExtension
    delete legacy.guardrailRailCount

    const layout = calculateScaffold(points.slice(0, 2), [3.6], legacy as typeof DEFAULT_PARAMETERS)
    expect(countMembers(layout).post).toBe(6)
    // 3 rails per decked lift, plus the 2 normal rows carried by the 扫地杆 layer.
    const deckedLifts = new Set(layout.decks.map((deck) => deck.layer)).size
    expect(countMembers(layout).longitudinal).toBe(3 * deckedLifts + 2)
    // A missing 栏杆根数 must fall back to the default rather than strip the rails.
    expect(layout.materials.guardrail.railCount).toBe(1)
    expect(countMembers(layout).guardrail).toBeGreaterThan(0)
  })
})
