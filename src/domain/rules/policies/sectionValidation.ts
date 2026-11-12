import { surfaceElevation, siteLength, type SiteSection, type ResolvedBlock, type SectionSummary, type SiteIssue } from '../../site.ts'
import type { ScaffoldParameters } from '../../scaffold.ts'
import { getSectionLevels } from './levels.ts'
import { mm } from '../facts/precision.ts'
import { sourcedIssue } from '../facts/issues.ts'
export type SectionFact = { index: number; id: string; summary?: SectionSummary }
export type OrderedIssue = { order: number; issue: SiteIssue }
export function sectionFacts(sections: readonly SiteSection[], blocks: ResolvedBlock[], parameters: ScaffoldParameters): SectionFact[] {
  return sections.map((section, index) => {
    const base = surfaceElevation(blocks, section.surfaceId)
    return { index, id: section.id, summary: base === undefined ? undefined : {
      ...getSectionLevels(base, parameters.liftHeight, section.layers), id: section.id, base, length: siteLength(section),
    } }
  })
}
export function sectionInputIssues(sections: readonly SectionFact[], minimumLength: number): OrderedIssue[] {
  return sections.flatMap(section => {
    const message = !section.summary ? `第 ${section.index + 1} 段的落脚面不可用，请重新选面。`
      : section.summary.length < minimumLength ? `第 ${section.index + 1} 段太短，请调整端点。` : undefined
    return message ? [{ order: section.index * 2, issue: sourcedIssue('V01', { code: section.summary ? 'short-section' : 'missing-surface',
      sectionIds: [section.id], message, blocking: true }) }] : []
  })
}
export function sweepIssues(sections: readonly SectionFact[], parameters: ScaffoldParameters): OrderedIssue[] {
  const sweep = parameters.sweepBarHeight
  return sections.flatMap(section => section.summary && sweep > 0 && (sweep >= parameters.liftHeight || mm(section.summary.firstClearance) - mm(sweep) < mm(parameters.pipeDiameter))
    ? [{ order: section.index * 2 + 1, issue: sourcedIssue('V02', { code: 'sweep-conflict', sectionIds: [section.id], blocking: true,
      message: `第 ${section.index + 1} 段的扫地杆与首层冲突，请调整扫地杆高度或落脚标高。` }) }] : [])
}
export function splitLengthIssues(lengths: readonly number[], owners: readonly string[], labels: Record<string, string>, minimumLength: number): SiteIssue[] {
  return [...new Set(lengths.flatMap((length, index) => length < minimumLength ? [owners[index]] : []))].map(id => sourcedIssue('V01', {
    code: 'short-section', sectionIds: [id], blocking: true, message: `${labels[id]}在交点处分出不足 0.10 m 的短段，请调整端点。`,
  }))
}
