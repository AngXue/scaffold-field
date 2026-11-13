import { it, expect } from 'vitest'
import { prepareFittingPlan, finishFittings } from './connections'
import { contactOf, CONNECTOR_CONTACT } from './facts/connections'
import { buildEntityGraph } from './facts/entityGraph'
import { calculateSite } from '../site'
import { SITE_DEMOS } from '../siteDemos'
import { DEFAULT_PARAMETERS, type ScaffoldMember } from '../scaffold'

it('preserves actual connection contacts through scene coordinates, independently of rendering offsets', () => {
  const demo = SITE_DEMOS.find(demo => demo.id === 'roof')!
  const layout = calculateSite(demo.site, demo.parameters), graph = buildEntityGraph(demo.site, layout)
  const byId = new Map(layout.members.map(member => [member.id, member]))
  const contacts = layout.connectors.filter(connector => connector.type === 'cross')
  expect(contacts).toHaveLength(28)
  for (const connector of contacts) {
    const contact = contactOf(connector), member = byId.get(connector.memberId)!
    expect(connector[CONNECTOR_CONTACT]).toBeDefined()
    expect(contact[1]).toBe(member.start[1])
    expect(graph.nodes.find(node => node.connectorIds.includes(graph.connectors.find(fitting => fitting.legacyId === connector.id)!.id))!.position).toEqual(contact)
  }
  expect(contacts.some(connector => contactOf(connector).some((value, axis) => value !== connector.position[axis]))).toBe(true)
})
it('ties only to the actual built post top and leaves its input intact', () => {
  const post: ScaffoldMember = { id: 'P', type: 'post', start: [0, 0, 0], end: [0, 2, 0], length: 2, connectionPoints: [] }
  const rail: ScaffoldMember = { id: 'R', type: 'guardrail', start: [-1, 3, 0], end: [1, 3, 0], length: 2, connectionPoints: [[0, 3, 0]] }
  const input = [post, rail], original = structuredClone(input)
  expect(prepareFittingPlan(input, { P: 2.4 }, DEFAULT_PARAMETERS, []).contacts).toEqual([])
  expect(prepareFittingPlan(input, { P: 3.5 }, DEFAULT_PARAMETERS, []).contacts).toHaveLength(1)
  expect(input).toEqual(original)
  expect(() => prepareFittingPlan([post, post], {}, DEFAULT_PARAMETERS, [])).toThrow('Duplicate member input')
})

it('creates sleeves at the final stock seam after positioning and keeps ordinary contacts fixed', () => {
  const member: ScaffoldMember = { id: 'rail', type: 'guardrail', start: [0, 2, 0], end: [3.7, 2, 0], length: 3.7, connectionPoints: [] }
  const pipes: import('../scaffold').PipeSegment[] = [1, 2].map(sequence => ({ id: `p${sequence}`, memberId: member.id, type: member.type,
    stockLength: 2, sequence, overlapWithPrevious: 0, start: [-0.3 + (sequence - 1) * 2, 2, 0], end: [-0.3 + sequence * 2, 2, 0] }))
  const plan = prepareFittingPlan([member], {}, DEFAULT_PARAMETERS, pipes)
  expect(plan.contacts).toEqual([])
  expect(() => finishFittings([member], [], [plan])).toThrow('no physical stock')
  const result = finishFittings([member], pipes, [plan])
  expect(() => finishFittings([member], pipes, [{ ...plan, splices: [] }])).toThrow('stock seam plan')
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ type: 'butt', position: [1.7, 2, 0], memberId: 'rail' })
  expect(finishFittings([member], pipes, [plan])).toEqual(result)
})

it('rejects stale contact intents when final pipes no longer cover the actual tie', () => {
  const post: ScaffoldMember = { id: 'post', type: 'post', start: [0, 0, 0], end: [0, 2, 0], length: 2, connectionPoints: [] }
  const rail: ScaffoldMember = { id: 'rail', type: 'longitudinal', start: [-1, 1, 0], end: [1, 1, 0], length: 2, connectionPoints: [[0, 1, 0]] }
  const members = [post, rail]
  const pipes: import('../scaffold').PipeSegment[] = members.map(member => ({ id: `pipe-${member.id}`, memberId: member.id, type: member.type,
    start: [...member.start], end: [...member.end], stockLength: 2, sequence: 1, overlapWithPrevious: 0 }))
  const plan = prepareFittingPlan(members, { post: 2 }, DEFAULT_PARAMETERS, pipes)
  expect(finishFittings(members, pipes, [plan]).filter(connector => connector.type === 'cross')).toHaveLength(1)
  pipes[1].start[0] += 3; pipes[1].end[0] += 3
  expect(() => finishFittings(members, pipes, [plan])).toThrow('final stock geometry')
  expect(() => finishFittings(members, pipes, [plan, plan])).toThrow('Duplicate')
})
