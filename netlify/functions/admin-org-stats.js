import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  // Get all organizations
  const { data: orgs, error: orgErr } = await admin
    .from('organizations')
    .select('id, created_at')
  if (orgErr) return json(500, { error: orgErr.message })

  // Get contact count per org
  const { data: contactCounts, error: contactErr } = await admin
    .from('contacts')
    .select('org_id')
  if (contactErr) return json(500, { error: contactErr.message })

  const countByOrg = {}
  for (const contact of contactCounts || []) {
    countByOrg[contact.org_id] = (countByOrg[contact.org_id] || 0) + 1
  }

  // Get open opportunity count per org (status not 'cancelled' and stage is not 'won' or 'lost')
  const { data: opps, error: oppErr } = await admin
    .from('opportunities')
    .select('org_id, stage_id')
  if (oppErr) return json(500, { error: oppErr.message })

  // Get stage info to identify won/lost stages
  const { data: stages } = await admin
    .from('stages')
    .select('id, is_won, is_lost')

  const stageMap = {}
  for (const stage of stages || []) {
    stageMap[stage.id] = { isWon: stage.is_won, isLost: stage.is_lost }
  }

  const openOppsByOrg = {}
  for (const opp of opps || []) {
    const stageInfo = stageMap[opp.stage_id]
    if (stageInfo && !stageInfo.isWon && !stageInfo.isLost) {
      openOppsByOrg[opp.org_id] = (openOppsByOrg[opp.org_id] || 0) + 1
    }
  }

  const stats = (orgs || []).map((org) => ({
    orgId: org.id,
    createdAt: org.created_at,
    contactCount: countByOrg[org.id] || 0,
    openOpportunitiesCount: openOppsByOrg[org.id] || 0,
  }))

  return json(200, { stats })
}
