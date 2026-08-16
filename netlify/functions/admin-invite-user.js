import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const ROLES = ['owner', 'admin', 'agent', 'viewer']

function siteOrigin(event) {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`
}

// Invites a person to a specific org with a role. If they already have an
// account (e.g. they're being added to a second org), skips the invite
// email and just adds the membership -- they can already log in.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { orgId, email, fullName, role } = payload
  if (!orgId || !email || !email.includes('@')) return json(400, { error: 'orgId and a valid email are required' })
  const memberRole = ROLES.includes(role) ? role : 'agent'

  const { data: org } = await admin.from('organizations').select('id').eq('id', orgId).maybeSingle()
  if (!org) return json(404, { error: 'Organization not found' })

  let userId
  let invited = false
  // Without redirectTo, Supabase falls back to its generic default instead
  // of this app's actual set-password page -- the same page Login.jsx's own
  // "Forgot password" flow already correctly points at.
  const { data: invite, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
    redirectTo: `${siteOrigin(event)}/reset-password`,
  })
  if (inviteErr) {
    // Most likely: this person already has an account. Fall back to
    // finding their existing profile rather than failing the whole request.
    const { data: existing } = await admin
      .from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle()
    if (!existing) return json(500, { error: inviteErr.message })
    userId = existing.id
  } else {
    userId = invite.user.id
    invited = true
  }

  await admin.from('profiles').upsert(
    { id: userId, email: email.trim().toLowerCase(), full_name: fullName?.trim() || null },
    { onConflict: 'id' },
  )

  const { error: memErr } = await admin.from('memberships')
    .upsert({ org_id: orgId, profile_id: userId, role: memberRole }, { onConflict: 'org_id,profile_id' })
  if (memErr) return json(500, { error: memErr.message })

  return json(200, { ok: true, invited, userId })
}
