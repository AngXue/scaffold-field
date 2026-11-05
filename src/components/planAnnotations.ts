import type { Footprint, SitePoint } from '../domain/site'
import { footprintCells, footprintContains, footprintOutline } from '../domain/siteFootprints'
import { signedArea } from '../domain/polygons'

/** Dimensions follow actual contour edges; covered intervals are subtracted before labeling. */
export type BlockSide = 'top' | 'right' | 'bottom' | 'left'

export type PlanBlockInput = Footprint & {
  id: string
  /** Text shown above the block, e.g. `B1 · 10.00 m`. */
  name: string
  /** Resolved elevations; used to tell a stacked parent from a neighbour. */
  base?: number
  top?: number
  selected?: boolean
  active?: boolean
  invalid?: boolean
}

export type PlanSectionInput = {
  id: string
  start: SitePoint
  end: SitePoint
  /** Complete label text, e.g. `第 1 段 · 8.00 m`. */
  text: string
}

export type PlanDimension = {
  key: string
  blockId: string
  side: BlockSide
  length: number
  /** Side endpoints in site metres. */
  from: SitePoint
  to: SitePoint
  /** Outward unit vector in site coordinates. */
  normal: SitePoint
  /** Distance from the side to the dimension line, in metres. */
  offset: number
  selected: boolean
  text: string
}

export type PlanSectionLabel = {
  id: string
  text: string
  position: SitePoint
  vertical: boolean
  anchor: 'start' | 'middle' | 'end'
}

export type PlanAnnotationLayout = {
  dimensions: PlanDimension[]
  sectionLabels: PlanSectionLabel[]
}

type Rect = { x: number; y: number; width: number; height: number }
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const intersectsAny = (rect: Rect, others: Rect[]) => others.some(other => overlaps(rect, other))
const textWidth = (text: string) => Math.max(22, text.length * 6.6 + 10)
const LABEL_HEIGHT = 15
const blockRect = (block: Footprint, scale: number): Rect => ({ x: block.x * scale, y: block.z * scale, width: block.width * scale, height: block.depth * scale })
/** Shared with the SVG chip: reserve CJK glyphs and the actual padded height. */
export const sectionAnnotationSize = (text: string) => ({
  width: [...text].reduce((sum, character) => sum + (character.charCodeAt(0) > 255 ? 10 : 6.4), 12),
  height: 16,
})
export const formatMetres = (value: number) => `${value.toFixed(2)} m`

function visibleEdges(block: PlanBlockInput, others: PlanBlockInput[]) {
  const points = footprintOutline(block)
  const winding = Math.sign(signedArea(points.map(p => [p.x, p.z])))
  const covers = others.filter(other => !((other.top ?? 0) <= (block.base ?? 0) + 0.001 && footprintContains(other, block)))
  return points.flatMap((from, index) => {
    const to = points[(index + 1) % points.length]
    const horizontal = from.z === to.z
    const axis = horizontal ? 'x' : 'z', cross = horizontal ? 'z' : 'x'
    const low = Math.min(from[axis], to[axis]), high = Math.max(from[axis], to[axis])
    const normal = horizontal ? { x: 0, z: -Math.sign(to.x - from.x) * winding }
      : { x: Math.sign(to.z - from.z) * winding, z: 0 }
    let ranges = [[low, high]]
    if (!block.selected) for (const other of covers) for (const cell of footprintCells(other)) {
      if (from[cross] < cell[cross] - 0.001 || from[cross] > cell[cross] + (horizontal ? cell.depth : cell.width) + 0.001) continue
      const a = cell[axis], b = a + (horizontal ? cell.width : cell.depth)
      ranges = ranges.flatMap(([start, end]) => b <= start || a >= end ? [[start, end]]
        : [[start, Math.min(end, a)], [Math.max(start, b), end]].filter(([l, r]) => r - l >= 0.001))
    }
    return ranges.map(([a, b], part) => ({ from: { ...from, [axis]: a }, to: { ...to, [axis]: b }, normal,
      length: b - a, key: `${block.id}:${index}:${part}`,
      side: (horizontal ? normal.z < 0 ? 'top' : 'bottom' : normal.x < 0 ? 'left' : 'right') as BlockSide }))
  })
}

export function layoutPlanAnnotations(blocks: PlanBlockInput[], sections: PlanSectionInput[], scale: number): PlanAnnotationLayout {
  const safeScale = scale > 0 ? scale : 1
  const rects = blocks.flatMap(block => footprintCells(block).map(cell => blockRect(cell, safeScale)))
  const occupied: Rect[] = []
  const dimensions: PlanDimension[] = []
  const ordered = [...blocks].sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)))
  for (const block of ordered) {
    const others = blocks.filter(other => other.id !== block.id)
    for (const edge of visibleEdges(block, others)) {
      const text = formatMetres(edge.length), horizontal = edge.normal.x === 0
      const labelBox = (offset: number): Rect => {
        const x = (edge.from.x + edge.to.x) / 2 * safeScale + edge.normal.x * (offset + 10)
        const y = (edge.from.z + edge.to.z) / 2 * safeScale + edge.normal.z * (offset + 10)
        const width = horizontal ? textWidth(text) : LABEL_HEIGHT, height = horizontal ? LABEL_HEIGHT : textWidth(text)
        return { x: x - width / 2, y: y - height / 2, width, height }
      }
      // Keep small exposed lengths too; move the annotation instead of dropping it.
      let offset = 15
      while (offset < 147 && intersectsAny(labelBox(offset), occupied)) offset += 12
      occupied.push(labelBox(offset))
      dimensions.push({ ...edge, blockId: block.id, offset: offset / safeScale, selected: Boolean(block.selected), text })
    }
  }

  const sectionLabels: PlanSectionLabel[] = []
  for (const section of sections) {
    const from = { x: section.start.x * safeScale, y: section.start.z * safeScale }
    const to = { x: section.end.x * safeScale, y: section.end.z * safeScale }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const length = Math.hypot(dx, dy) || 1
    const nx = -dy / length
    const ny = dx / length
    const size = sectionAnnotationSize(section.text)
    const width = size.width + 6, height = size.height + 6
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    const vertical = Math.abs(dy) > Math.abs(dx)
    // Start a little farther out than a dimension label: a section chip and the
    // edge measurement are different readings and must not sit shoulder to shoulder.
    let chosen: { x: number; y: number } | undefined
    // Prefer nearby space outside houses. In a recess, a clear chip inside the
    // footprint is easier to associate with its edge than one far across the plan.
    // The fallback still respects every dimension and previously placed chip.
    for (let attempt = 0; !chosen; attempt++) {
      const outside = attempt < 6
      const distance = 28 + (outside ? attempt : attempt - 6) * 14
      for (const sign of [1, -1]) {
        const at = { x: mid.x + nx * sign * distance, y: mid.y + ny * sign * distance }
        const box = vertical
          ? { x: at.x - height / 2, y: at.y - width / 2, width: height, height: width }
          : { x: at.x - width / 2, y: at.y - height / 2, width, height }
        if (!intersectsAny(box, occupied) && (!outside || !intersectsAny(box, rects))) {
          chosen = at; occupied.push(box); break
        }
      }
    }
    sectionLabels.push({
      id: section.id,
      text: section.text,
      position: { x: chosen.x / safeScale, z: chosen.y / safeScale },
      vertical,
      anchor: 'middle',
    })
  }

  return { dimensions, sectionLabels }
}
