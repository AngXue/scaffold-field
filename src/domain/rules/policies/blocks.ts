import { SITE_EPS as EPS } from '../facts/precision.ts'
import { GROUND, roundSite, type Site, type ResolvedBlock, type SiteIssue } from '../../site.ts'
import { footprintContains, footprintFromOutline, footprintsOverlap } from '../../siteFootprints.ts'


export function resolveBlocks(site: Site): { blocks: ResolvedBlock[]; issues: SiteIssue[] } {
  const byId = new Map(site.blocks.map(block => [block.id, block]))
  const resolved = new Map<string, ResolvedBlock>()
  const issues: SiteIssue[] = []
  const failed = new Set<string>()
  const visiting = new Set<string>()
  const fail = (id: string, message: string) => {
    if (!failed.has(id)) issues.push({ code: 'block-placement', blocking: true, message, sectionIds: [], blockId: id })
    failed.add(id)
  }
  const visit = (id: string): ResolvedBlock | undefined => {
    if (resolved.has(id)) return resolved.get(id)
    if (failed.has(id)) return
    const block = byId.get(id)
    if (!block) return
    if (visiting.has(id)) { fail(id, '体块的叠放关系形成了循环。'); return }
    if (![block.width, block.depth, block.height].every(value => Number.isFinite(value) && value >= 0.001)) {
      fail(id, '体块的长、宽和高度必须大于 0。'); return
    }
    if (block.outline) {
      const shape = footprintFromOutline(block.outline)
      if (!shape || [shape.x - block.x, shape.z - block.z, shape.width - block.width, shape.depth - block.depth].some(n => Math.abs(n) > EPS)) {
        fail(id, '房屋轮廓须为闭合、无自交的水平垂直线。'); return
      }
    }
    visiting.add(id)
    const parent = block.parentId === GROUND ? undefined : visit(block.parentId)
    visiting.delete(id)
    if (block.parentId !== GROUND && (!parent || !footprintContains(parent, block))) {
      fail(id, '体块须完整落在父体块顶面。'); return
    }
    const base = parent?.top ?? 0
    const result = { ...block, base, top: roundSite(base + block.height) }
    resolved.set(id, result)
    return result
  }
  const blocks = site.blocks.flatMap(block => {
    const result = visit(block.id)
    return result ? [result] : []
  })
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const a = blocks[i], b = blocks[j]
    if (Math.min(a.top, b.top) - Math.max(a.base, b.base) > EPS &&
        footprintsOverlap(a, b)) {
      fail(b.id, '两个房屋体块在空间内重叠，请移开或叠放。')
    }
  }
  return { blocks, issues }
}

