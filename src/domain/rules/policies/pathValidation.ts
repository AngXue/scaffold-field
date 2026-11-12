import type { LayoutWarning } from '../../scaffold.ts'
import { signedArea, subtractCoverage, type PlanPolygon } from '../../polygons.ts'
export function pathWarnings(physical: [number, number][], pathIsClosed: boolean): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  for (let i = 0; i + 1 < physical.length; i++) for (let j = i + 1; j + 1 < physical.length; j++) {
    const a = physical[i], b = physical[i + 1], c = physical[j], d = physical[j + 1]
    const u = [b[0] - a[0], b[1] - a[1]], v = [d[0] - c[0], d[1] - c[1]]
    const cross = (x: number[], y: number[]) => x[0] * y[1] - x[1] * y[0]
    const delta = [c[0] - a[0], c[1] - a[1]], denominator = cross(u, v)
    const adjacent = j === i + 1 || (pathIsClosed && i === 0 && j === physical.length - 2)
    if (Math.abs(denominator) < 1e-8) {
      const length = Math.hypot(...u)
      if (length < 0.001 || Math.abs(cross(delta, u)) / length > 0.001) continue
      const t0 = (delta[0] * u[0] + delta[1] * u[1]) / length
      const t1 = ((d[0] - a[0]) * u[0] + (d[1] - a[1]) * u[1]) / length
      if (Math.min(length, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > 0.001) {
        warnings.push({ id: `path-overlap-${i}-${j}`, message: `第 ${i + 1}、${j + 1} 段重叠或原路折返，请调整路径。` })
      }
    } else if (!adjacent) {
      const t = cross(delta, v) / denominator, s = cross(delta, u) / denominator
      if (t >= -1e-8 && t <= 1 + 1e-8 && s >= -1e-8 && s <= 1 + 1e-8) {
        warnings.push({ id: `path-crossing-${i}-${j}`, message: `第 ${i + 1}、${j + 1} 段自交，交叉处构造未建模，请调整路径。` })
      }
    }
  }

  return warnings
}
export function bandWarnings(physical: [number, number][], pathIsClosed: boolean, width: number): LayoutWarning[] {
  const warnings: LayoutWarning[] = []
  const bands: PlanPolygon[] = physical.slice(0, -1).map((start, i) => {
    const end = physical[i + 1], length = Math.hypot(end[0] - start[0], end[1] - start[1]) || 1
    const nx = -(end[1] - start[1]) / length * width, nz = (end[0] - start[0]) / length * width
    return [start, end, [end[0] + nx, end[1] + nz], [start[0] + nx, start[1] + nz]]
  })
  const overlappingBands = bands.some((band, i) => bands.some((other, j) => {
    if (j <= i + 1 || (pathIsClosed && i === 0 && j === physical.length - 2)) return false
    const uncovered = subtractCoverage([band], [other]).reduce((sum, piece) => sum + Math.abs(signedArea(piece)), 0)
    return Math.abs(signedArea(band)) - uncovered > 0.001
  }))
  if (overlappingBands) warnings.push({ id: 'scaffold-overlap', message: '非相邻段的架体带重叠：共用直杆已合并、钢笆按覆盖区裁切，请复核重叠区域的搭设布置。' })
  return warnings
}

export const zeroLengthWarning = (index: number): LayoutWarning => ({ id: `zero-length-${index}`, message: `第 ${index + 1} 段的两个节点重合，请移动节点或删除该路径段。` })
export function shortBayWarnings(index: number, length: number, spacing: number): LayoutWarning[] {
  return length < spacing * 0.55 ? [{ id: `short-bay-${index}`, message: `第 ${index + 1} 段末跨仅 ${length.toFixed(2)}m，请复核立杆间距。` }] : []
}
export function componentWarnings(degrees: readonly number[], overlap: boolean): LayoutWarning[] {
  if (degrees.some(degree => degree > 2)) return [{ id: 'branch-junction', message: '图纸含三向或四向交汇点：已合并共点立杆，支路按各自端部估算；交汇处栏杆、钢笆及搭设细节需人工复核。' }]
  return overlap ? [{ id: 'overlapping-components', message: '独立架段的铺设范围重叠：钢笆覆盖已去重，交汇处立杆、栏杆及搭设细节需人工复核。' }] : []
}
export function sweepHeightWarnings(height: number): LayoutWarning[] {
  return height > 0.2 ? [{ id: 'sweep-bar-height', message: `扫地杆高度 ${height} m 超过 JGJ 130-2011 第 6.3.2 条“距钢管底端不大于 200 mm”的规定，请复核。` }] : []
}
