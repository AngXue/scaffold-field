import type { SiteIssue } from '../../site.ts'
export const ISSUE_ORIGIN = Symbol('scaffold.issueOrigin')
export type IssueOrigin = { rules: string[]; references: { kind: 'section' | 'block' | 'span'; id: string }[] }
export type SourcedIssue = SiteIssue & { [ISSUE_ORIGIN]: IssueOrigin }
export function sourcedIssue(rule: string, issue: SiteIssue): SourcedIssue {
  return { ...issue, [ISSUE_ORIGIN]: { rules: [rule], references: [
    ...issue.sectionIds.map(id => ({ kind: 'section' as const, id })), ...(issue.blockId ? [{ kind: 'block' as const, id: issue.blockId }] : []),
  ] } }
}
export function appendIssue(issues: SiteIssue[], issue: SiteIssue) {
  if (!issues.some(previous => previous.code === issue.code && previous.sectionIds.join('|') === issue.sectionIds.join('|'))) issues.push(issue)
}

/** Retain the physical span while mapping a diagnostic back to the editable stroke. */
export function mapIssueSources(issue: SiteIssue, sourceIds: ReadonlyMap<string, string>): SiteIssue {
  const origin = (issue as Partial<SourcedIssue>)[ISSUE_ORIGIN]
  const references = origin?.references.flatMap(reference => reference.kind === 'section' && sourceIds.has(reference.id)
    ? [{ kind: 'section' as const, id: sourceIds.get(reference.id)! }, { kind: 'span' as const, id: reference.id }] : [reference])
  return { ...issue, sectionIds: [...new Set(issue.sectionIds.map(id => sourceIds.get(id) ?? id))],
    ...(origin && { [ISSUE_ORIGIN]: { rules: [...origin.rules], references } }) }
}
