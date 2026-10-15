import { describe, expect, it } from 'vitest'
import { planInput, SHAPES } from '../../scripts/geometry-audit/fixtures'
import { PLAN_LABEL_HEIGHT, PLAN_LABEL_WIDTH, placePlanLabels, segmentIntersectsLabel } from './planLabels'

describe('plan labels', () => {
  it('keeps the field demo labels inside a tablet drawing viewport', () => {
    const { points } = planInput(SHAPES.find(s => s.id === 'user-short-returns')!)
    const zoom = 1.31
    const viewport = { x: -130, y: -490, width: 696, height: 648 }
    for (const label of placePlanLabels(points, zoom, viewport)) {
      expect(label.x * zoom - PLAN_LABEL_WIDTH / 2).toBeGreaterThanOrEqual(viewport.x)
      expect(label.x * zoom + PLAN_LABEL_WIDTH / 2).toBeLessThanOrEqual(viewport.x + viewport.width)
      expect(label.y * zoom - PLAN_LABEL_HEIGHT / 2).toBeGreaterThanOrEqual(viewport.y)
      expect(label.y * zoom + PLAN_LABEL_HEIGHT / 2).toBeLessThanOrEqual(viewport.y + viewport.height)
    }
  })

  it('keeps labels clear of every segment, node and other label at different zooms', () => {
    for (const id of ['user-short-returns', 'minimum-step', 'double-notch', 'line']) {
      const { points } = planInput(SHAPES.find(s => s.id === id)!)
      const before = JSON.stringify(points)
      for (const zoom of [0.15, 0.6, 1, 1.82, 6]) {
        const screen = points.map(p => ({ x: p.x * zoom, y: p.y * zoom }))
        const labels = placePlanLabels(points, zoom)
        const boxes = labels.map(p => ({ x: p.x * zoom - PLAN_LABEL_WIDTH / 2,
          y: p.y * zoom - PLAN_LABEL_HEIGHT / 2, width: PLAN_LABEL_WIDTH, height: PLAN_LABEL_HEIGHT }))
        for (const [i, box] of boxes.entries()) {
          expect(screen.slice(1).some((b, j) => segmentIntersectsLabel(screen[j], b, box)), `${id}, zoom ${zoom}, label ${i}`).toBe(false)
          expect(screen.some(p => p.x >= box.x - 6 && p.x <= box.x + box.width + 6 && p.y >= box.y - 6 && p.y <= box.y + box.height + 6)).toBe(false)
          for (const other of boxes.slice(i + 1)) {
            expect(box.x < other.x + other.width && box.x + box.width > other.x
              && box.y < other.y + other.height && box.y + box.height > other.y).toBe(false)
          }
        }
      }
      expect(JSON.stringify(points)).toBe(before)
    }
  })
})
