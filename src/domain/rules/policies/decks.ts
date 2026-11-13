import { PART_HISTORY, partHistory, partChanged, partShapeChanged, partList, removedParts, withRemoved, appendParts } from '../facts/partHistory.ts'
import { DECK_PANEL, DECK_PANEL_LAP, type DeckPanel, type ScaffoldParameters, type Vector3Tuple } from '../../scaffold.ts'
import { signedArea, subtractCoverage, type PlanPolygon } from '../../polygons.ts'
import { roundDomain as round } from '../facts/precision.ts'
import type { CornerTopology, PlanPoint } from './topology.ts'
import type { Band } from './bands.ts'
const DECK_SURFACE_OFFSET = 0.055
const vectorDistance = (a: Vector3Tuple, b: Vector3Tuple) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

/** How many panels cover `run` once every joint is lapped by `DECK_PANEL_LAP`. */
export function deckPanelCount(run: number, panel: number, lap = DECK_PANEL_LAP) {
  const gain = Math.max(0.05, panel - lap)
  return Math.max(1, Math.ceil((run - lap) / gain - 1e-9))
}

export function deckBetweenStations(start: [Vector3Tuple, Vector3Tuple], end: [Vector3Tuple, Vector3Tuple],
  layer: number, pathSegment: number, id: string, parameters: ScaffoldParameters): DeckPanel[] {
  const length = vectorDistance(start[0], end[0]), width = vectorDistance(start[0], start[1])
  const along = deckPanelCount(length, Math.max(0.1, parameters.deckPanelLength))
  const across = deckPanelCount(width, Math.max(0.1, parameters.deckPanelWidth))
  const point = (s: number, t: number): Vector3Tuple => [0, 1, 2].map(axis => round(
    start[0][axis] + (end[0][axis] - start[0][axis]) * s + (start[1][axis] - start[0][axis]) * t
      + (axis === 1 ? DECK_SURFACE_OFFSET : 0), 6)) as Vector3Tuple
  return Array.from({ length: along * across }, (_, index) => {
    const s = Math.floor(index / across), t = index % across
    return { id: `${id}-${index + 1}`, layer, pathSegment, area: round(length * width / (along * across)),
      corners: [point(s / along, t / across), point((s + 1) / along, t / across),
        point((s + 1) / along, (t + 1) / across), point(s / along, (t + 1) / across)] }
  })
}


export type PanelGeometry = { stations: number[]; postRows: Vector3Tuple[][]; bands: Pick<Band, 'elevation' | 'layer' | 'withDeck'>[] }
function addOrdinaryPanels(decks: DeckPanel[], geometry: PanelGeometry, band: Pick<Band, 'elevation' | 'layer' | 'withDeck'>, segmentIndex: number, parameters: ScaffoldParameters) {
  const { stations, postRows } = geometry, bayCount = stations.length - 1
  const { elevation, layer } = band
      const deckElevation = round(elevation + DECK_SURFACE_OFFSET)
      const panelLength = Math.max(0.1, parameters.deckPanelLength ?? DECK_PANEL.length)
      const panelWidth = Math.max(0.1, parameters.deckPanelWidth ?? DECK_PANEL.width)
      const panelsAcross = deckPanelCount(parameters.width, panelWidth)

      for (let bay = 0; bay < bayCount; bay += 1) {
        const bayLength = stations[bay + 1] - stations[bay]
        const panelsAlong = deckPanelCount(bayLength, panelLength)
        /** A point on the bay: `along` 0..1 down the bay, `across` 0..1 between the rows. */
        const at = (along: number, across: number): Vector3Tuple => {
          const outerStart = postRows[0][bay]
          const outerEnd = postRows[0][bay + 1]
          const innerStart = postRows[1][bay]
          const innerEnd = postRows[1][bay + 1]
          const outerX = outerStart[0] + (outerEnd[0] - outerStart[0]) * along
          const outerZ = outerStart[2] + (outerEnd[2] - outerStart[2]) * along
          const innerX = innerStart[0] + (innerEnd[0] - innerStart[0]) * along
          const innerZ = innerStart[2] + (innerEnd[2] - innerStart[2]) * along
          return [
            round(outerX + (innerX - outerX) * across, 6),
            deckElevation,
            round(outerZ + (innerZ - outerZ) * across, 6),
          ]
        }

        for (let along = 0; along < panelsAlong; along += 1) {
          for (let across = 0; across < panelsAcross; across += 1) {
            const s0 = along / panelsAlong
            const s1 = (along + 1) / panelsAlong
            const a0 = across / panelsAcross
            const a1 = (across + 1) / panelsAcross
            decks.push({
              id: `D${decks.length + 1}`,
              corners: [at(s0, a0), at(s1, a0), at(s1, a1), at(s0, a1)],
              area: round((bayLength / panelsAlong) * (parameters.width / panelsAcross)),
              layer,
              pathSegment: segmentIndex,
            })
          }
        }
      }
}
export function generateDecks(geometry: PanelGeometry[], order: readonly number[], cornerDecks: CornerTopology['cornerDecks'],
  counts: readonly number[], lifts: readonly number[], parameters: ScaffoldParameters, deckLayerOffset: number): DeckPanel[] {
  const decks: DeckPanel[] = []
  for (const segment of order) for (const band of geometry[segment].bands) {
    if (band.withDeck) addOrdinaryPanels(decks, geometry[segment], band, segment, parameters)
  }
  const liftElevation = (layer: number) => lifts[layer - 1] ?? round(layer * parameters.liftHeight)
  if (cornerDecks.length > 0) {
    const deckInterval = Math.max(1, Math.round(parameters.deckLiftInterval))
    for (const corner of cornerDecks) {
      const sharedLayers = Math.min(counts[corner.pathSegment], counts[(corner.pathSegment + 1) % counts.length])
      for (let layer = 1; layer <= sharedLayers; layer += 1) {
        if ((layer + deckLayerOffset) % deckInterval !== 0) continue
        const deckElevation = round(liftElevation(layer) + DECK_SURFACE_OFFSET)
        const corners = corner.points.map(
          (point) => [point[0], deckElevation, point[2]] as Vector3Tuple,
        ) as [Vector3Tuple, Vector3Tuple, Vector3Tuple, Vector3Tuple]
        let twiceArea = 0
        for (let index = 0; index < corners.length; index += 1) {
          const current = corners[index]
          const next = corners[(index + 1) % corners.length]
          twiceArea += current[0] * next[2] - next[0] * current[2]
        }
        decks.push({
          id: `D${decks.length + 1}`,
          corners,
          area: round(Math.abs(twiceArea) / 2),
          layer,
          pathSegment: corner.pathSegment,
        })
      }
    }
  }

  return decks
}
function resolveDeckCoverageOwned(decks: DeckPanel[], path: Array<[number, number]>, closed: boolean) {
  if (!decks.length) return
  const firstLayer = Math.min(...decks.map(deck => deck.layer))
  const templates = decks.filter(deck => deck.layer === firstLayer)
  const plan = (deck: DeckPanel): PlanPolygon => deck.corners.map(p => [p[0], p[2]])
  const key = (deck: DeckPanel) => `${deck.pathSegment}:${plan(deck).map(p => p.join(',')).join('|')}`
  const raw = templates.map(plan)
  const faces = new Map<string, PlanPolygon[]>()
  const covered: PlanPolygon[] = []
  // At an ordinary inside corner the incoming leg owns the common square.
  // Applying this locally first makes the result independent of the closed seam.
  templates.forEach((deck, index) => {
    const previous = (deck.pathSegment + path.length - 2) % (path.length - 1)
    const cutters = (closed || deck.pathSegment > 0)
      ? templates.flatMap((other, i) => other.pathSegment === previous ? [raw[i]] : []) : []
    const remaining = subtractCoverage(subtractCoverage([raw[index]], cutters), covered)
    faces.set(key(deck), remaining)
    covered.push(...remaining)
  })
  // Recover regions involved in cyclic/multiple overlaps exactly once. This also
  // handles a narrow U without holes or guessing a fractional panel quantity.
  templates.forEach((deck, index) => {
    const remaining = subtractCoverage([raw[index]], covered)
    faces.get(key(deck))!.push(...remaining)
    covered.push(...remaining)
  })
  const inputs = Object.freeze(decks.map(partHistory)), retired = [...removedParts(decks)]
  const kept = decks.flatMap(deck => {
    const polygons = faces.get(key(deck))!
    const area = polygons.reduce((sum, polygon) => sum + Math.abs(signedArea(polygon)), 0)
    const before = partHistory(deck)
    if (area < 1e-7) {
      retired.push(partChanged({ ...deck, area: 0, coverage: [] }, [before], 'M06', 'remove', inputs, [], 'overlap'))
      return []
    }
    const next = { ...deck, area: round(area, 9), coverage: polygons.map(polygon => polygon.map(([x, z]) => [x, deck.corners[0][1], z] as Vector3Tuple)) }
    next[PART_HISTORY] = partShapeChanged(next, before) ? partChanged(next, [before], 'M06', 'coverage', inputs) : before
    return [next]
  })
  decks.splice(0, decks.length, ...kept)
  withRemoved(decks, retired)
}

/** M06 only mutates a private array; published candidate panels remain unchanged. */
export function resolveDeckCoverage(candidates: readonly DeckPanel[], path: PlanPoint[], closed: boolean, perSegmentCounts: boolean): DeckPanel[] {
  const decks = partList([...candidates], candidates)
  if (!perSegmentCounts) { resolveDeckCoverageOwned(decks, path, closed); return decks }
  const layers = new Set(decks.map(deck => deck.layer)), covered: DeckPanel[] = []
  for (const layer of layers) {
    const panels = decks.filter(deck => deck.layer === layer)
    resolveDeckCoverageOwned(panels, path, closed)
    appendParts(covered, panels)
  }
  return partList(covered, covered, candidates)
}
