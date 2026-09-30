import { describe, expect, it } from 'vitest'
import {
  calculateScaffold,
  countMembers,
  CONNECTOR_LABELS,
  COUPLER_PACK_SIZE,
  DEFAULT_PARAMETERS,
  GUARDRAIL_TOP_EDGE,
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

    expect(outerCornerPosts).toHaveLength(1)
    expect(countMembers(layout).post).toBe(11)
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
    expect(liftTransverse?.length).toBeCloseTo(parameters.width + parameters.tubeEndExtension * 2, 3)
    // 2 bays per decked lift.
    expect(layout.decks).toHaveLength(2 * deckedLifts)
    expect(layout.materials.deckCount).toBe(layout.decks.length)
  })

  it('splits tall posts into overlapping standard stock pipes', () => {
    const parameters = { ...DEFAULT_PARAMETERS, height: 12.4 }
    const layout = calculateScaffold(points.slice(0, 2), [3.6], parameters)
    const post = layout.members.find((member) => member.type === 'post')!
    const segments = layout.pipeSegments.filter((segment) => segment.memberId === post.id)

    expect(segments.length).toBeGreaterThan(1)
    expect(segments.every((segment) => parameters.stockLengths.includes(segment.stockLength))).toBe(true)
    expect(segments.every((segment) => segment.stockLength <= Math.max(...parameters.stockLengths))).toBe(true)
    // One 对接扣件 per butt joint: a sleeve joins two tube ends, so a joint takes
    // exactly one coupler, not one per side.
    expect(layout.connectors.filter((connector) => connector.type === 'butt' && connector.memberId === post.id))
      .toHaveLength(segments.length - 1)
    expect(Math.max(...segments.map((segment) => segment.end[1]))).toBeGreaterThan(parameters.height)
    const plan = layout.materials.assemblyPlans.find((assembly) => assembly.memberId === post.id)!
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

  it('lays one 槽钢 under each pair of posts, running with the transverse members', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const channels = layout.baseChannels

    // Two bays => three post pairs, matching the three transverse stations.
    expect(channels).toHaveLength(3)
    expect(layout.materials.channelSteel.count).toBe(3)
    expect(layout.materials.channelSteel.lengthPerPiece).toBeCloseTo(
      DEFAULT_PARAMETERS.width + DEFAULT_PARAMETERS.tubeEndExtension * 2,
      3,
    )
    expect(layout.materials.channelSteel.totalLength).toBeCloseTo(
      layout.materials.channelSteel.lengthPerPiece * channels.length,
      3,
    )
    // The path runs along +x, so the transverse direction is +z: every channel
    // must therefore keep a constant x while spanning the scaffold width.
    for (const channel of channels) {
      expect(channel.start[0]).toBeCloseTo(channel.end[0], 6)
      expect(Math.abs(channel.end[2] - channel.start[2])).toBeCloseTo(
        DEFAULT_PARAMETERS.width + DEFAULT_PARAMETERS.tubeEndExtension * 2,
        3,
      )
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

  it('divides the height into equal 步距, including the bottom step', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const elevations = [...new Set(layout.members
      .filter((member) => member.type === 'longitudinal' && member.layer !== undefined)
      .map((member) => member.start[1]))].sort((a, b) => a - b)

    // 扫地杆 (layer 0) plus every lift is evenly spaced. A short top step is what
    // JGJ 130-2011 §2.1.23 (步距 = 上下水平杆轴线间的距离) rules out.
    expect(elevations).toHaveLength(5)
    expect(elevations[0]).toBeCloseTo(0.2, 3)
    expect(elevations[elevations.length - 1]).toBeCloseTo(7.2, 3)
    const gaps = elevations.slice(1).map((y, index) => y - elevations[index])
    // Uniform to the millimetre the model rounds every coordinate to, and none
    // exceeds the configured 步距.
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(0.001)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(DEFAULT_PARAMETERS.liftHeight)
  })

  it('measures the scaffold height to the 架顶栏杆上皮', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const topLift = Math.max(...layout.members.map((member) => member.layer ?? 0))
    const topRail = layout.members.find(
      (member) => member.type === 'guardrail' && member.layer === topLift && member.length > 2,
    )!

    // JGJ 130-2011 §2.1.20: 脚手架高度 is measured from the post base to the 架顶栏杆
    // 上皮, so the top 作业层 sits one guardrail height below `height`.
    expect(GUARDRAIL_TOP_EDGE).toBe(1.2)
    expect(topRail.start[1] + HALF_PIPE).toBeCloseTo(DEFAULT_PARAMETERS.height, 3)
  })

  it('never places a rail above the posts that carry it', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const postTop = DEFAULT_PARAMETERS.height + DEFAULT_PARAMETERS.postTopExtension

    // The floating rails that sat above the top lift were the symptom of measuring
    // `height` to the deck instead of to the rail.
    for (const rail of layout.members.filter((member) => member.type === 'guardrail')) {
      expect(rail.start[1]).toBeLessThanOrEqual(postTop + 0.001)
    }
  })

  it('adds the two 作业层 rails per guarded side on every decked lift', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const rails = layout.members.filter((member) => member.type === 'guardrail')
    const sideRuns = rails.filter((rail) => rail.length > DEFAULT_PARAMETERS.width + 1)

    // 4 decked lifts x 1 side (the default) x 2 rails (上栏杆 + 中栏杆, §7.3.12).
    expect(DEFAULT_PARAMETERS.guardrailSides).toBe(1)
    expect(sideRuns).toHaveLength(8)
    expect(layout.materials.guardrail.sides).toBe(1)
    // Additional members, never a substitute: they are their own type, so the
    // ordinary longitudinal rows are untouched.
    expect(rails.every((rail) => rail.layer !== SWEEP_BAR_LAYER)).toBe(true)
    expect(rails.every((rail) => layout.decks.some((deck) => deck.layer === rail.layer))).toBe(true)
  })

  it('puts the top rail 1.2 m above the 作业层 and the mid rail centred below it', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const layer = layout.members.find((member) => member.type === 'longitudinal' && member.layer === 1)!
    const heights = layout.members
      .filter((member) => member.type === 'guardrail' && member.layer === 1 && member.length > 2)
      .map((rail) => Number((rail.start[1] - layer.start[1]).toFixed(3)))

    // §7.3.12(2) gives 上栏杆上皮 1.2 m, so the centreline sits one radius lower;
    // §7.3.12(4) only says the mid rail is 居中.
    expect([...new Set(heights)].sort((a, b) => a - b)).toEqual([0.6, 1.176])
  })

  it('caps a deckless top lift with the 架顶栏杆', () => {
    // Decks land on layer 3 only, so layer 4 has no 作业层 of its own.
    const layout = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, deckLiftInterval: 3 })
    const topRails = layout.members.filter(
      (member) => member.type === 'guardrail' && member.layer === 4 && member.length > 2,
    )

    expect(layout.decks.some((deck) => deck.layer === 4)).toBe(false)
    // The rail is still required: it is what `height` is measured to.
    expect(topRails).toHaveLength(1)
    expect(topRails[0].start[1] + HALF_PIPE).toBeCloseTo(DEFAULT_PARAMETERS.height, 3)
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

  it('guards one side by default and both when the inner face is open', () => {
    const one = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const two = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, guardrailSides: 2 })
    const sideRuns = (layout: ScaffoldLayout) =>
      layout.members.filter((member) => member.type === 'guardrail' && member.length > DEFAULT_PARAMETERS.width + 1)

    // JGJ 130-2011 §7.3.12(1) mandates 外立杆 only, so 1 is the default and the code
    // minimum; 2 is the site rule and is required when the inner face is 临空.
    expect(sideRuns(two)).toHaveLength(sideRuns(one).length * 2)
    // The end return spans the full width, so it is ONE run per rail height
    // whichever sides are guarded — doubling it would stack two identical tubes.
    expect(two.materials.guardrail.endRuns).toBe(one.materials.guardrail.endRuns)
  })

  it('omits edge protection entirely when no side is guarded', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, guardrailSides: 0 })

    expect(countMembers(layout).guardrail).toBe(0)
    expect(layout.materials.guardrail.totalLength).toBe(0)
  })

  it('drops a rail that would land on the next lift horizontal', () => {
    // A 1.2 m 步距 pushes a rail onto the next lift's longitudinal member, so two
    // coincident tubes must not both be emitted.
    const tight = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, liftHeight: 1.2 })
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

    const layout = calculateScaffold(points.slice(0, 2), [3.6], legacy as typeof DEFAULT_PARAMETERS)
    expect(countMembers(layout).post).toBe(6)
    // 3 rails per decked lift, plus the 2 normal rows carried by the 扫地杆 layer.
    const deckedLifts = new Set(layout.decks.map((deck) => deck.layer)).size
    expect(countMembers(layout).longitudinal).toBe(3 * deckedLifts + 2)
  })
})
