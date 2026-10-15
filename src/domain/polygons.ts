/** Convex plan polygons, in metres. Rendering and quantities share these faces. */
export type PlanPolygon = Array<[number, number]>

export function signedArea(polygon: PlanPolygon) {
  return polygon.reduce((area, p, i) => {
    const q = polygon[(i + 1) % polygon.length]
    return area + p[0] * q[1] - q[0] * p[1]
  }, 0) / 2
}

/** Exact convex subtraction: disjoint convex fragments, without rasterisation. */
export function subtractPolygon(subject: PlanPolygon, cutter: PlanPolygon): PlanPolygon[] {
  const bounds = (p: PlanPolygon) => [Math.min(...p.map(v => v[0])), Math.min(...p.map(v => v[1])), Math.max(...p.map(v => v[0])), Math.max(...p.map(v => v[1]))]
  const a = bounds(subject), b = bounds(cutter)
  if (a[2] <= b[0] + 1e-9 || b[2] <= a[0] + 1e-9 || a[3] <= b[1] + 1e-9 || b[3] <= a[1] + 1e-9) return [subject]
  const clip = signedArea(cutter) < 0 ? [...cutter].reverse() : cutter
  const outside: PlanPolygon[] = []
  let inside = subject
  for (let edge = 0; edge < clip.length && inside.length; edge++) {
    const p = clip[edge], q = clip[(edge + 1) % clip.length]
    const distance = (v: [number, number]) => (q[0] - p[0]) * (v[1] - p[1]) - (q[1] - p[1]) * (v[0] - p[0])
    const half = (keepInside: boolean): PlanPolygon => {
      const result: PlanPolygon = []
      for (let i = 0; i < inside.length; i++) {
        const v = inside[i], w = inside[(i + 1) % inside.length]
        const dv = distance(v), dw = distance(w)
        const vKept = keepInside ? dv >= -1e-9 : dv <= 1e-9
        const wKept = keepInside ? dw >= -1e-9 : dw <= 1e-9
        if (vKept) result.push(v)
        if (vKept !== wKept) {
          const t = dv / (dv - dw)
          result.push([v[0] + (w[0] - v[0]) * t, v[1] + (w[1] - v[1]) * t])
        }
      }
      return result.filter((v, i) => Math.hypot(v[0] - result[(i + 1) % result.length][0], v[1] - result[(i + 1) % result.length][1]) > 1e-8)
    }
    const removed = half(false)
    if (removed.length >= 3 && Math.abs(signedArea(removed)) > 1e-8) outside.push(removed)
    inside = half(true)
  }
  return outside
}

export function subtractCoverage(subject: PlanPolygon[], cutters: PlanPolygon[]) {
  return cutters.reduce((fragments, cutter) => fragments.flatMap(fragment => subtractPolygon(fragment, cutter)), subject)
}
