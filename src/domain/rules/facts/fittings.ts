import type { Vector3Tuple } from '../../scaffold.ts'
/** Connection intent is not a counted fitting. Display hints preserve the compatibility view only. */
export type CrossContactIntent = {
  displayId: string
  memberId: string
  connectedMemberId: string
  contact: Vector3Tuple
  displayPosition: Vector3Tuple
  axis: Vector3Tuple
  secondaryAxis: Vector3Tuple
}
export type SpliceIntent = { memberId: string; displayPrefix: string; axis: Vector3Tuple }
export type FittingPlan = { memberIds: string[]; contacts: CrossContactIntent[]; splices: SpliceIntent[] }
export function transformFittingPlans(plans: readonly FittingPlan[], point: (point: Vector3Tuple) => Vector3Tuple, prefix = ''): FittingPlan[] {
  return plans.map(plan => ({ memberIds: plan.memberIds.map(id => prefix + id), contacts: plan.contacts.map(contact => ({ ...contact, displayId: prefix + contact.displayId,
    memberId: prefix + contact.memberId, connectedMemberId: prefix + contact.connectedMemberId,
    contact: point(contact.contact), displayPosition: point(contact.displayPosition), axis: contact.axis, secondaryAxis: contact.secondaryAxis })),
    splices: plan.splices.map(splice => ({ ...splice, memberId: prefix + splice.memberId, displayPrefix: prefix + splice.displayPrefix, axis: splice.axis })) }))
}
export function selectFittingPlans(plans: readonly FittingPlan[], selected: (memberId: string) => boolean, requireBoth = false): FittingPlan[] {
  return plans.map(plan => ({ memberIds: plan.memberIds.filter(selected), contacts: plan.contacts.filter(contact => selected(contact.memberId) && (!requireBoth || selected(contact.connectedMemberId))),
    splices: plan.splices.filter(splice => selected(splice.memberId)) })).filter(plan => plan.memberIds.length)
}
