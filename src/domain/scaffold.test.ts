import { describe, expect, it } from 'vitest'
import {
  calculateScaffold,
  countMembers,
  CONNECTOR_LABELS,
  DEFAULT_PARAMETERS,
  SWEEP_BAR_LAYER,
} from './scaffold'

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
    expect(layout.materials.purchasedLength).toBeGreaterThanOrEqual(memberLength)
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
    // The extra rail is one more longitudinal row on every lift, and the 扫地杆
    // layer deliberately gains nothing from it.
    expect(countMembers(layout).longitudinal - countMembers(twoRailLayout).longitudinal).toBe(5)
    expect(liftTransverse?.connectionPoints).toHaveLength(3)
    expect(sweepTransverse?.connectionPoints).toHaveLength(2)
    expect(liftTransverse?.length).toBeCloseTo(parameters.width + parameters.tubeEndExtension * 2, 3)
    expect(layout.decks).toHaveLength(10)
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
    expect(parameters.sweepBarHeight).toBe(0.3)
    expect(sweepLongitudinal).toHaveLength(2)
    expect(sweepTransverse).toHaveLength(3)
    expect(sweepLongitudinal.every((member) => member.start[1] === 0.3)).toBe(true)
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
    expect(layout.materials.channelSteel.size).toBe('10#')
    expect(layout.materials.channelSteel.totalMass).toBeCloseTo(
      layout.materials.channelSteel.totalLength * 10,
      1,
    )
  })

  it('does not duplicate a 槽钢 when two path segments share a corner', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)
    const keys = layout.baseChannels.map((channel) =>
      [channel.start.join(':'), channel.end.join(':')].sort().join('|'))

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('excludes wall ties and leaves braces pending outside the layout', () => {
    const layout = calculateScaffold(points, [3.6, 3.6], DEFAULT_PARAMETERS)

    expect(layout.members.every((member) => ['post', 'longitudinal', 'transverse'].includes(member.type))).toBe(true)
    // 转向扣 only appears in 剪刀撑, which is not modelled, so it stays unknown.
    expect(layout.materials.connectorSummary.swivel).toBeNull()
    expect(Object.keys(CONNECTOR_LABELS)).toEqual(['cross', 'butt', 'swivel'])
  })

  it('lists the site materials outside the calculation with an unknown quantity', () => {
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const pending = layout.materials.pendingMaterials

    expect(pending.map((material) => material.id)).toEqual(['brace', 'bindingWire', 'padPlate', 'formwork'])
    expect(pending.map((material) => material.label)).toEqual(['剪刀撑', '扎丝', '小垫板', '支模板'])
    expect(pending.every((material) => material.unit.length > 0)).toBe(true)
  })

  it('flags a sweep bar higher than the 200 mm the standard allows, without changing it', () => {
    // The site-confirmed 300 mm is what gets built, but not silently: JGJ 130-2011
    // §6.3.2 caps the longitudinal sweep bar at 200 mm above the tube bottom.
    const layout = calculateScaffold(points.slice(0, 2), [3.6], DEFAULT_PARAMETERS)
    const warning = layout.warnings.find((item) => item.id === 'sweep-bar-height')

    expect(DEFAULT_PARAMETERS.sweepBarHeight).toBe(0.3)
    expect(warning?.message).toContain('200 mm')

    const compliant = calculateScaffold(points.slice(0, 2), [3.6], { ...DEFAULT_PARAMETERS, sweepBarHeight: 0.2 })
    expect(compliant.warnings.find((item) => item.id === 'sweep-bar-height')).toBeUndefined()
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
    // 3 rails x 5 lifts, plus the 2 normal rows carried by the 扫地杆 layer.
    expect(countMembers(layout).longitudinal).toBe(17)
  })
})
