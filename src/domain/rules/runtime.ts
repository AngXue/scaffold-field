/** Build-time verification only; project data cannot disable rule contracts. */
export const VERIFY_RULE_INPUTS = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV ?? false
