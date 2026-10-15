import type { Point2D, ScaffoldParameters } from '../../src/domain/scaffold.ts'

export type XY = [number, number]
export type Shape = { id: string; name: string; points: XY[]; kind: 'ordinary' | 'boundary' | 'invalid' }

/** All coordinates are metres. Every edge is horizontal or vertical. */
export const SHAPES: Shape[] = [
  { id: 'line', name: '直线 7.2 m', points: [[0,0],[7.2,0]], kind: 'ordinary' },
  { id: 'line-split', name: '同一直线分成两段', points: [[0,0],[3.6,0],[7.2,0]], kind: 'ordinary' },
  { id: 'line-handle', name: '直线上插入 0.5 m 短段', points: [[0,0],[3.6,0],[4.1,0],[7.2,0]], kind: 'ordinary' },
  { id: 'l-inside', name: 'L 形内转角', points: [[0,0],[7.2,0],[7.2,4.8]], kind: 'ordinary' },
  { id: 'l-outside', name: 'L 形外转角', points: [[0,0],[7.2,0],[7.2,-4.8]], kind: 'ordinary' },
  { id: 'u-inside', name: 'U 形内侧偏移', points: [[0,0],[7.2,0],[7.2,4.8],[0,4.8]], kind: 'ordinary' },
  { id: 'u-outside', name: 'U 形外侧偏移', points: [[0,0],[7.2,0],[7.2,-4.8],[0,-4.8]], kind: 'ordinary' },
  { id: 'stairs', name: '连续阶梯', points: [[0,0],[3.6,0],[3.6,2.4],[7.2,2.4],[7.2,4.8],[10.8,4.8]], kind: 'ordinary' },
  { id: 'zigzag', name: '左右交替折线', points: [[0,0],[4.8,0],[4.8,2.4],[2.4,2.4],[2.4,4.8],[7.2,4.8]], kind: 'ordinary' },
  { id: 'notch', name: '建筑凹槽', points: [[0,0],[3.6,0],[3.6,2.4],[6,2.4],[6,0],[9.6,0]], kind: 'ordinary' },
  { id: 'double-notch', name: '连续双凹槽', points: [[0,0],[3.6,0],[3.6,2.4],[6,2.4],[6,0],[9.6,0],[9.6,2.4],[12,2.4],[12,0],[15.6,0]], kind: 'ordinary' },
  { id: 'spiral', name: '矩形内旋路径', points: [[0,0],[10.8,0],[10.8,9.6],[0,9.6],[0,3.6],[7.2,3.6],[7.2,6],[3.6,6]], kind: 'ordinary' },
  { id: 'rectangle-in', name: '闭合矩形·偏移在内', points: [[0,0],[7.2,0],[7.2,4.8],[0,4.8],[0,0]], kind: 'ordinary' },
  { id: 'rectangle-out', name: '闭合矩形·偏移在外', points: [[0,0],[0,4.8],[7.2,4.8],[7.2,0],[0,0]], kind: 'ordinary' },
  { id: 'closed-l', name: '闭合 L 形建筑', points: [[0,0],[7.2,0],[7.2,3.6],[3.6,3.6],[3.6,7.2],[0,7.2],[0,0]], kind: 'ordinary' },
  { id: 'closed-notch', name: '闭合凹字建筑', points: [[0,0],[10.8,0],[10.8,7.2],[7.2,7.2],[7.2,3.6],[3.6,3.6],[3.6,7.2],[0,7.2],[0,0]], kind: 'ordinary' },
  { id: 'user-short-returns', name: '现场闭合图·0.7 / 0.8 m 短折返', points: [[0,0],[7.1,0],[7.1,-4.3],[4.8,-4.3],[4.8,-3.5],[-0.7,-3.5],[-0.7,-2],[0,-2],[0,0]], kind: 'boundary' },
  { id: 'odd-bays', name: '闭环含奇数跨', points: [[0,0],[5.4,0],[5.4,1.8],[3,1.8],[3,3.6],[0,3.6],[0,0]], kind: 'boundary' },
  { id: 'short-start', name: '首段仅 0.5 m', points: [[0,0],[0.5,0],[0.5,4.8]], kind: 'boundary' },
  { id: 'short-end', name: '末段仅 0.5 m', points: [[0,0],[7.2,0],[7.2,0.5]], kind: 'boundary' },
  { id: 'short-middle', name: '中间错台 0.5 m', points: [[0,0],[3.6,0],[3.6,0.5],[7.2,0.5]], kind: 'boundary' },
  { id: 'narrow-u', name: 'U 形间隙仅 1.2 m', points: [[0,0],[4.8,0],[4.8,1.2],[0,1.2]], kind: 'boundary' },
  { id: 'width-u', name: 'U 形间隙等于排距', points: [[0,0],[4.8,0],[4.8,0.9],[0,0.9]], kind: 'boundary' },
  { id: 'minimum-step', name: '连续 0.1 m 小台阶', points: [[0,0],[3.6,0],[3.6,0.1],[3.7,0.1],[3.7,3.6]], kind: 'boundary' },
  { id: 'near-closed', name: '距离闭合还差 0.1 m', points: [[0,0],[7.2,0],[7.2,4.8],[0,4.8],[0,0.1]], kind: 'boundary' },
  { id: 'backtrack', name: '原路折返（输入边界）', points: [[0,0],[4.8,0],[0,0]], kind: 'invalid' },
  { id: 'crossing', name: '路径自交（输入边界）', points: [[0,0],[4.8,0],[4.8,4.8],[2.4,4.8],[2.4,-2.4]], kind: 'invalid' },
]

export const CONFIGURATIONS: Array<{ id: string; parameters: Partial<ScaffoldParameters> }> = [
  { id: 'default', parameters: {} },
  { id: 'outer-offset', parameters: { swapInnerOuter: true } },
  { id: 'four-supports', parameters: { deckSupportRailCount: 4 } },
  { id: 'narrow-row', parameters: { width: 0.7, deckPanelWidth: 0.75 } },
  { id: 'alternate-decks', parameters: { layerCount: 3, deckLiftInterval: 2, guardrailRailCount: 2 } },
  { id: 'different-bays', parameters: { postSpacing: 1.5 } },
]

export function planInput(shape: Shape): { points: Point2D[]; lengths: number[] } {
  const points = shape.points.map(([x, y], index) => ({ id: `P${index + 1}`, x: x * 50, y: y * 50 }))
  const lengths = shape.points.slice(1).map(([x, y], index) => Number(Math.hypot(x - shape.points[index][0], y - shape.points[index][1]).toFixed(3)))
  return { points, lengths }
}

/** Reproducible, non-self-intersecting orthogonal paths. X increases at each leg. */
export function generatedShapes(count = 80): Shape[] {
  let seed = 0x20261015
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000 }
  const lengths = [0.5, 0.9, 1.2, 1.8, 2.4, 3.6, 4.8]
  return Array.from({ length: count }, (_, index) => {
    const points: XY[] = [[0, 0]]
    const steps = 2 + Math.floor(next() * 5)
    for (let i = 0; i < steps; i++) {
      const [x, y] = points.at(-1)!
      const dx = lengths[Math.floor(next() * lengths.length)]
      const dy = lengths[Math.floor(next() * lengths.length)] * (next() > 0.5 ? 1 : -1)
      points.push([+(x + dx).toFixed(3), y], [+(x + dx).toFixed(3), +(y + dy).toFixed(3)])
    }
    return { id: `generated-${String(index + 1).padStart(2, '0')}`, name: `固定种子折线 ${index + 1}`, points, kind: 'boundary' }
  })
}
