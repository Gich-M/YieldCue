export const SEVERITY_LEVELS = ['critical', 'warning', 'info'] as const
export type Severity = (typeof SEVERITY_LEVELS)[number]
