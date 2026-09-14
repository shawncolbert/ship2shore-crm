import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// $32 per 1,000 requests is Places API (New) Text Search's per-call price
// as of when this was built -- a request-count estimate, not pulled from
// Google's own billing API, so treat it as "roughly this much," not exact.
const COST_PER_SEARCH = 0.032

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  const startOfMonth = new Date()
  startOfMonth.setUTCDate(1)
  startOfMonth.setUTCHours(0, 0, 0, 0)

  const [{ count: allTimeCount }, { data: monthRows, error }] = await Promise.all([
    admin.from('place_search_log').select('id', { count: 'exact', head: true }),
    admin.from('place_search_log').select('org_id').gte('created_at', startOfMonth.toISOString()),
  ])
  if (error) return json(500, { error: error.message })

  const monthCount = monthRows?.length || 0
  const byOrg = new Map()
  for (const row of monthRows || []) byOrg.set(row.org_id, (byOrg.get(row.org_id) || 0) + 1)

  const orgIds = [...byOrg.keys()]
  let orgNames = {}
  if (orgIds.length) {
    const { data: orgs } = await admin.from('organizations').select('id, name').in('id', orgIds)
    orgNames = Object.fromEntries((orgs || []).map((o) => [o.id, o.name]))
  }

  return json(200, {
    monthCount,
    monthCostUsd: Math.round(monthCount * COST_PER_SEARCH * 100) / 100,
    allTimeCount: allTimeCount || 0,
    allTimeCostUsd: Math.round((allTimeCount || 0) * COST_PER_SEARCH * 100) / 100,
    byOrg: [...byOrg.entries()].map(([orgId, count]) => ({ orgId, orgName: orgNames[orgId] || 'Unknown org', count })),
  })
}
