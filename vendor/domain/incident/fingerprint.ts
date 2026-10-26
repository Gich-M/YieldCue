/**
 * Deterministic incident fingerprint.
 *
 * Produces SHA-256(tenant_id + workflow_id + check_id). A check's config pins the
 * failure locus (metric_key or field_path), so the same condition on the same
 * check always maps to the same fingerprint.
 */

export async function computeFingerprint(input: {
  tenantId: string
  workflowId?: string
  checkId?: string
}): Promise<string> {
  const parts = [input.tenantId, input.workflowId ?? '_', input.checkId ?? '_']
  const raw = parts.join('::')
  const data = new TextEncoder().encode(raw)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
