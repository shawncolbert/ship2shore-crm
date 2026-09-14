import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const CONDITION_TYPES = ['lead_not_followed_up', 'invoice_unpaid']

// Creates a new reminder rule (no id passed) or updates an existing one
// (id passed) for one org. System Controls panel (AdminOrgs.jsx) is the
// only caller.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { id, orgId, conditionType, thresholdDays, message, enabled } = payload
  if (!orgId) return json(400, { error: 'Missing orgId' })
  if (!CONDITION_TYPES.includes(conditionType)) return json(400, { error: 'Invalid conditionType' })
  const days = Number(thresholdDays)
  if (!Number.isInteger(days) || days <= 0) return json(400, { error: 'thresholdDays must be a positive integer' })
  if (!message || !message.trim()) return json(400, { error: 'Missing message' })

  const row = {
    org_id: orgId,
    condition_type: conditionType,
    threshold_days: days,
    message: message.trim(),
    enabled: enabled !== false,
    updated_at: new Date().toISOString(),
  }

  const query = id
    ? admin.from('reminder_rules').update(row).eq('id', id)
    : admin.from('reminder_rules').insert(row)

  const { data, error } = await query
    .select('id, condition_type, threshold_days, message, enabled, created_at, updated_at')
    .single()
  if (error) return json(500, { error: error.message })

  return json(200, { rule: data })
}
