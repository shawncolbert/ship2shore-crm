import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// System Controls panel (AdminOrgs.jsx) -- every reminder rule Shawn has
// set for one org (a pop-up condition + threshold + custom message that
// shows in that org's own CRM). See fetchActiveReminders() in supabase.js
// for how an org's own session evaluates which rules are currently firing.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId } = payload
  if (!orgId) return json(400, { error: 'Missing orgId' })

  const { data, error } = await admin
    .from('reminder_rules')
    .select('id, condition_type, threshold_days, message, enabled, created_at, updated_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
  if (error) return json(500, { error: error.message })

  return json(200, { rules: data || [] })
}
