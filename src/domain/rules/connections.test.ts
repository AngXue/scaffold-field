import { it, expect } from 'vitest'
import { calculateConnections } from './connections'
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
    expect(graph.nodes.find(node => node.connectorIds.includes(connector.id))!.position).toEqual(contact)
  }
  expect(contacts.some(connector => contactOf(connector).some((value, axis) => value !== connector.position[axis]))).toBe(true)
})
it('ties only to the actual built post top and leaves its input intact', () => {
  const post: ScaffoldMember = { id: 'P', type: 'post', start: [0, 0, 0], end: [0, 2, 0], length: 2, connectionPoints: [] }
  const rail: ScaffoldMember = { id: 'R', type: 'guardrail', start: [-1, 3, 0], end: [1, 3, 0], length: 2, connectionPoints: [[0, 3, 0]] }
  const input = [post, rail], original = structuredClone(input)
  expect(calculateConnections(input, { P: 2.4 }, DEFAULT_PARAMETERS)).toEqual([])
  expect(calculateConnections(input, { P: 3.5 }, DEFAULT_PARAMETERS)).toHaveLength(1)
  expect(input).toEqual(original)
  expect(() => calculateConnections([post, post], {}, DEFAULT_PARAMETERS)).toThrow('Duplicate member input')
})
