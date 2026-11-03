import { DEFAULT_PARAMETERS, type ScaffoldParameters } from './scaffold.ts'
import { EMPTY_SITE, GROUND, type Site, type SiteBlock, type SiteSection } from './site.ts'

const section = (id: string, surfaceId: string, layers: number, x: number, z: number, endX: number, endZ: number): SiteSection =>
  ({ id, surfaceId, layers, start: { x, z }, end: { x: endX, z: endZ } })
const roof = { id: 'B1', parentId: GROUND, x: 0, z: 0, width: 6, depth: 4, height: 3.5 }
const house = { id: 'B1', parentId: GROUND, x: 0, z: 0, width: 8, depth: 6, height: 7.5 }
const garden = { id: 'B2', parentId: GROUND, x: -4, z: 0, width: 4, depth: 6, height: 3.5 }
const stacked: SiteBlock[] = [{ ...roof, height: 3 }, { ...roof, id: 'B2', parentId: 'B1', x: 1, width: 4, height: 0.5 }]
const scene = (blocks: SiteBlock[], sections: SiteSection[]): Site => ({ ...EMPTY_SITE, blocks, sections })

export type SiteDemo = { id: string; title: string; site: Site; parameters: ScaffoldParameters; check: string }
const demo = (id: string, title: string, site: Site, check: string, parameters: Partial<ScaffoldParameters> = {}): SiteDemo =>
  ({ id, title, site, check, parameters: { ...DEFAULT_PARAMETERS, ...parameters } })

export const SITE_DEMOS = [
  demo('roof', '屋顶单跨手算', scene([roof], [section('S1', 'B1', 1, 1, 1, 2.8, 1)]),
    '首层 3.76 m、距顶面 0.26 m。立杆 4、底座 2、钢笆 2、十字扣 28；钢管 33.60 m。'),
  demo('aligned', '正面与花园齐顶', scene([house, garden], [
    section('S1', GROUND, 5, 1, -2, 7, -2), section('S2', 'B2', 4, -2, 1, -2, 5),
  ]), '两段顶层均为 9.40 m。立杆 18、底座 9、钢笆 64、十字扣 294；铺板面积 41.40 m²。'),
  demo('stack', '叠放体块改高', scene(stacked, [section('S1', 'B2', 4, 1.5, 1, 3.3, 1)]),
    '将 B1 高度由 3.00 改为 3.50 m：S1 落脚面变为 4.00 m、首层 5.64 m、顶层 11.28 m，仍为 4 层。'),
  demo('exact', '落脚恰好等于全局层', scene([{ ...roof, height: 3.76 }], [section('S1', 'B1', 3, 1, 1, 2.8, 1)]),
    '落脚 3.76 m 时，首层从全局第 3 层 5.64 m 开始；顶层 9.40 m。'),
  demo('narrow', '拦截：顶面宽度不足', scene([{ ...roof, depth: 0.8 }], [section('S1', 'B1', 1, 1, 0.2, 2.8, 0.2)]),
    '绘制线在顶面上，但另一排柱脚及底座在面外；材料导出应锁定。'),
  demo('step', '拦截：架段跨台阶', scene([roof], [section('S1', 'B1', 1, -1, 1, 2.8, 1)]),
    '一条架段横跨地面和体块顶面；提示调整位置或分段。'),
  demo('sweep', '拦截：扫地杆撞首层', scene([{ ...roof, height: 3.56 }], [section('S1', 'B1', 1, 1, 1, 2.8, 1)]),
    '扫地杆和首层均为 3.76 m；禁止出量，首层标高不跳到下一层。'),
  demo('penetration', '拦截：穿入房屋体块', scene([roof], [section('S1', GROUND, 1, 1, -0.91, 2.8, -0.91)]),
    '两排立杆轴线都在墙外，但管身或伸出段进入房屋；材料导出应锁定。'),
  demo('overlap', '拦截：独立柱脚重叠', scene([], [
    section('S1', GROUND, 1, 0, 0, 1.8, 0), section('S2', GROUND, 2, 1.8, 0, 3.6, 0),
  ]), '两段层数不同、共用柱脚。提示交界复核及实体重叠，不能导出重复计量。'),
  demo('legacy', '旧图：平地直线、转角与闭环', scene([], [
    section('S1', GROUND, 5, 0, 0, 3.6, 0), section('S2', GROUND, 5, 3.6, 0, 3.6, 3.6),
    section('S3', GROUND, 5, 3.6, 3.6, 0, 3.6), section('S4', GROUND, 5, 0, 3.6, 0, 0),
  ]), '以 1.3 同图为基准核对几何、周长与材料。'),
] as const
