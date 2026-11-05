import type { Footprint, SitePoint } from '../domain/site'

/**
 * Screen-space placement for the drawing's annotations.
 *
 * The plan is an unbounded, zoomable canvas, so annotation collisions have to be
 * solved in screen pixels: a label is the same size at every zoom, while the
 * rectangles underneath it are not. This module never edits scene geometry; it
 * only decides which edge labels to draw and where.
 *
 * Dense drawings confuse a reader when every rectangle labels all four sides.
 * The rule is:
 *   - the selected block shows all four edges (it is the object under edit);
 *   - every other block shows at most one width and one depth label, on a side
 *     whose dimension band is free of other blocks;
 *   - section labels move to the first side that does not collide with those.
 * Nothing is dropped from the measured data — only from the annotation layer.
 */

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
type ScreenPoint = { x: number; y: number }

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

const intersectsAny = (rect: Rect, others: Rect[]) => others.some((other) => overlaps(rect, other))

const textWidth = (text: string) => Math.max(22, text.length * 6.6 + 10)
const LABEL_HEIGHT = 15

type SideGeometry = {
  from: ScreenPoint
  to: ScreenPoint
  normal: ScreenPoint
  length: number
}

function sideGeometry(block: Footprint, side: BlockSide, scale: number): SideGeometry {
  const x = block.x * scale
  const y = block.z * scale
  const width = Math.max(0, block.width * scale)
  const depth = Math.max(0, block.depth * scale)
  switch (side) {
    case 'top':
      return { from: { x, y }, to: { x: x + width, y }, normal: { x: 0, y: -1 }, length: block.width }
    case 'bottom':
      return { from: { x, y: y + depth }, to: { x: x + width, y: y + depth }, normal: { x: 0, y: 1 }, length: block.width }
    case 'left':
      return { from: { x, y }, to: { x, y: y + depth }, normal: { x: -1, y: 0 }, length: block.depth }
    case 'right':
      return { from: { x: x + width, y }, to: { x: x + width, y: y + depth }, normal: { x: 1, y: 0 }, length: block.depth }
  }
}

function blockRect(block: Footprint, scale: number): Rect {
  return {
    x: block.x * scale,
    y: block.z * scale,
    width: Math.max(0, block.width * scale),
    height: Math.max(0, block.depth * scale),
  }
}

/** Part of a side that no other block projects onto, as a 0..1 fraction. */
function exposedFraction(block: Footprint, side: BlockSide, others: Footprint[]): number {
  const horizontal = side === 'top' || side === 'bottom'
  const alongStart = horizontal ? block.x : block.z
  const alongEnd = alongStart + (horizontal ? block.width : block.depth)
  const length = alongEnd - alongStart
  if (length <= 0) return 0
  const sideAt = horizontal
    ? (side === 'top' ? block.z : block.z + block.depth)
    : (side === 'left' ? block.x : block.x + block.width)
  const intervals: Array<[number, number]> = []
  for (const other of others) {
    const crossStart = horizontal ? other.z : other.x
    const crossEnd = crossStart + (horizontal ? other.depth : other.width)
    // A side is only covered when the other footprint reaches through the line.
    if (crossStart > sideAt + 1e-6 || crossEnd < sideAt - 1e-6) continue
    const start = Math.max(alongStart, horizontal ? other.x : other.z)
    const end = Math.min(alongEnd, (horizontal ? other.x : other.z) + (horizontal ? other.width : other.depth))
    if (end > start + 1e-6) intervals.push([start, end])
  }
  intervals.sort((a, b) => a[0] - b[0])
  let covered = 0
  let cursor = alongStart
  for (const [start, end] of intervals) {
    const left = Math.max(start, cursor)
    if (end > left) { covered += end - left; cursor = end }
  }
  return Math.max(0, 1 - covered / length)
}

/** The band between the side and its dimension line, including the label. */
function dimensionBand(block: Footprint, side: BlockSide, scale: number, offset: number): Rect {
  const geometry = sideGeometry(block, side, scale)
  const horizontal = side === 'top' || side === 'bottom'
  const labelLength = textWidth(formatMetres(geometry.length)) + 8
  const total = offset + LABEL_HEIGHT + 4
  if (horizontal) {
    const left = (geometry.from.x + geometry.to.x) / 2 - labelLength / 2
    return {
      x: left,
      y: side === 'top' ? geometry.from.y - total : geometry.from.y,
      width: labelLength,
      height: total,
    }
  }
  const top = (geometry.from.y + geometry.to.y) / 2 - labelLength / 2
  return {
    x: side === 'left' ? geometry.from.x - total : geometry.from.x,
    y: top,
    width: total,
    height: labelLength,
  }
}

const SIDE_PREFERENCE: Record<BlockSide, number> = { top: 0.08, right: 0.04, bottom: 0, left: 0 }

const topOf = (block: PlanBlockInput) => block.top ?? 0
const baseOf = (block: PlanBlockInput) => block.base ?? 0
const containsFootprint = (outer: Footprint, inner: Footprint) =>
  inner.x >= outer.x - 1e-6 && inner.z >= outer.z - 1e-6
  && inner.x + inner.width <= outer.x + outer.width + 1e-6
  && inner.z + inner.depth <= outer.z + outer.depth + 1e-6

/**
 * A block stacked directly on another is drawn on top of it, so the lower
 * block's body must not block the upper block's dimension band. Only a block
 * that is below AND contains this footprint is such a parent.
 */
const isStackParent = (candidate: PlanBlockInput, block: PlanBlockInput) =>
  topOf(candidate) <= baseOf(block) + 1e-6 && containsFootprint(candidate, block)

/** The portion of a side line that another, taller block covers (0..1). */
function sideCoverage(block: Footprint, side: BlockSide, other: Footprint): number {
  const horizontal = side === 'top' || side === 'bottom'
  const start = horizontal ? block.x : block.z
  const end = start + (horizontal ? block.width : block.depth)
  const sideAt = horizontal
    ? (side === 'top' ? block.z : block.z + block.depth)
    : (side === 'left' ? block.x : block.x + block.width)
  const crossStart = horizontal ? other.z : other.x
  const crossEnd = crossStart + (horizontal ? other.depth : other.width)
  if (crossStart > sideAt + 1e-6 || crossEnd < sideAt - 1e-6) return 0
  const overlapStart = Math.max(start, horizontal ? other.x : other.z)
  const overlapEnd = Math.min(end, (horizontal ? other.x : other.z) + (horizontal ? other.width : other.depth))
  return Math.max(0, overlapEnd - overlapStart) / Math.max(1e-9, end - start)
}

function chooseSides(block: PlanBlockInput, others: PlanBlockInput[], scale: number): BlockSide[] {
  if (block.selected) return ['top', 'right', 'bottom', 'left']
  const relevant = others.filter((other) => !isStackParent(other, block))
  const hiddenByHigher = (side: BlockSide) => others.some((other) =>
    topOf(other) > topOf(block) + 1e-6 && sideCoverage(block, side, other) > 0.25)
  const free = (side: BlockSide) => {
    const band = dimensionBand(block, side, scale, 15)
    return !intersectsAny(band, relevant.map((other) => blockRect(other, scale)))
      && exposedFraction(block, side, relevant) > 0.45
      && !hiddenByHigher(side)
  }
  const horizontal = (['top', 'bottom'] as const)
    .filter(free)
    .sort((a, b) => (exposedFraction(block, b, relevant) + SIDE_PREFERENCE[b])
      - (exposedFraction(block, a, relevant) + SIDE_PREFERENCE[a]))
  const vertical = (['right', 'left'] as const)
    .filter(free)
    .sort((a, b) => (exposedFraction(block, b, relevant) + SIDE_PREFERENCE[b])
      - (exposedFraction(block, a, relevant) + SIDE_PREFERENCE[a]))
  return [horizontal[0], vertical[0]].filter((side): side is BlockSide => side !== undefined)
}

/** Two decimals is the drawing's working precision, like the old labels. */
export function formatMetres(value: number) {
  return `${value.toFixed(2)} m`
}

/** A label's screen box for one candidate offset, measured from the side. */
function labelBox(block: Footprint, side: BlockSide, scale: number, offset: number): Rect {
  const geometry = sideGeometry(block, side, scale)
  const text = formatMetres(geometry.length)
  const width = textWidth(text)
  const horizontal = side === 'top' || side === 'bottom'
  if (horizontal) {
    const centerX = (geometry.from.x + geometry.to.x) / 2
    const centerY = side === 'top' ? geometry.from.y - offset - 10 : geometry.from.y + offset + 10
    return { x: centerX - width / 2, y: centerY - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT }
  }
  // A vertical label is drawn rotated -90°, so its screen box is tall and narrow:
  // the text length runs along the side and only the text height pushes outward.
  const centerY = (geometry.from.y + geometry.to.y) / 2
  const centerX = side === 'left' ? geometry.from.x - offset - 10 : geometry.from.x + offset + 10
  return { x: centerX - LABEL_HEIGHT / 2, y: centerY - width / 2, width: LABEL_HEIGHT, height: width }
}

export function layoutPlanAnnotations(
  blocks: PlanBlockInput[],
  sections: PlanSectionInput[],
  scale: number,
): PlanAnnotationLayout {
  const safeScale = scale > 0 ? scale : 1
  const rects = blocks.map((block) => blockRect(block, safeScale))
  // Only accepted labels occupy space; block footprints are considered separately
  // so a selected block can keep its dimension label close to its own edge.
  const occupied: Rect[] = []
  const dimensions: PlanDimension[] = []

  // Selected first: its four labels are the reference the others must avoid.
  const ordered = [...blocks].sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)))
  const offsets = [15, 26, 38, 52]
  for (const block of ordered) {
    const others = blocks.filter((other) => other.id !== block.id)
    const sides = chooseSides(block, others, safeScale)
    for (const side of sides) {
      const geometry = sideGeometry(block, side, safeScale)
      const text = formatMetres(geometry.length)
      const blockRects = others.map((other) => blockRect(other, safeScale))
      let chosen = -1
      let fallback = -1
      for (const offset of offsets) {
        const box = labelBox(block, side, safeScale, offset)
        const collides = intersectsAny(box, occupied) || (!block.selected && intersectsAny(box, blockRects))
        if (!collides && chosen < 0) { chosen = offset; break }
        if (fallback < 0) fallback = offset
      }
      // A selected block must still show every edge, even if the only free slot
      // is outside the normal offset range. Unselected labels are optional.
      if (chosen < 0) {
        if (!block.selected) continue
        chosen = Math.max(offsets[offsets.length - 1], fallback)
      }
      const box = labelBox(block, side, safeScale, chosen)
      occupied.push(box)
      dimensions.push({
        key: `${block.id}:${side}`,
        blockId: block.id,
        side,
        length: geometry.length,
        from: { x: geometry.from.x / safeScale, z: geometry.from.y / safeScale },
        to: { x: geometry.to.x / safeScale, z: geometry.to.y / safeScale },
        normal: { x: geometry.normal.x, z: geometry.normal.y },
        offset: chosen / safeScale,
        selected: Boolean(block.selected),
        text,
      })
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
    const width = textWidth(section.text)
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    const vertical = Math.abs(dy) > Math.abs(dx)
    // Start a little farther out than a dimension label: a section chip and the
    // edge measurement are different readings and must not sit shoulder to shoulder.
    const candidates = [28, 42, 58, 76, 96]
    let chosen: { x: number; y: number } | undefined
    for (const distance of candidates) {
      for (const sign of [1, -1]) {
        const at = { x: mid.x + nx * sign * distance, y: mid.y + ny * sign * distance }
        const box = vertical
          ? { x: at.x - LABEL_HEIGHT / 2, y: at.y - width / 2, width: LABEL_HEIGHT, height: width }
          : { x: at.x - width / 2, y: at.y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT }
        // Avoid every accepted label and every block footprint. A section label
        // belongs beside the line, never on top of a rectangle it does not explain.
        if (!intersectsAny(box, occupied) && !intersectsAny(box, rects)) { chosen = at; occupied.push(box); break }
      }
      if (chosen) break
    }
    if (!chosen) {
      const at = { x: mid.x + nx * 78, y: mid.y + ny * 78 }
      const box = vertical
        ? { x: at.x - LABEL_HEIGHT / 2, y: at.y - width / 2, width: LABEL_HEIGHT, height: width }
        : { x: at.x - width / 2, y: at.y - LABEL_HEIGHT / 2, width, height: LABEL_HEIGHT }
      occupied.push(box)
      chosen = at
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
