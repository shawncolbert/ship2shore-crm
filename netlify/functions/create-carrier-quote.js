import crypto from 'node:crypto'
import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { estimateLeadQuote } from './_shared/telegramDispatch.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

function siteOrigin() {
  return process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://dispatch.ship2shorebooking.com'
}

// Generates a one-time link (Pipeline's "Ask driver for quote" button) that
// shows any driver -- not just a saved contact -- a job's pickup/drop-off
// and asks what they'd charge. Snapshots the route and the system's own
// mileage estimate at creation time, same reasoning as
// dispatchAssignment.js's markAssigned: the request should reflect what was
// actually sent, even if the job's address gets edited afterward. The
// system_estimate is stored for comparison later but never sent to the
// driver -- carrier-quote.js's public "get" action deliberately omits it.
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
    const user = await userFromToken(token)
    if (!user) return json(401, { error: 'Unauthorized' })

    const orgId = await orgForUser(user.id)
    if (!orgId) return json(403, { error: 'No organization' })

    let body
    try { body = JSON.parse(event.body || '{}') } catch (e) { return json(400, { error: `Invalid JSON: ${e.message}` }) }
    const { opportunityId } = body
    if (!opportunityId) return json(400, { error: 'opportunityId is required' })

    const { data: opp, error: oppErr } = await admin
      .from('opportunities')
      .select('id, pickup_address, dropoff_address, scheduled_at')
      .eq('id', opportunityId).eq('org_id', orgId).maybeSingle()
    if (oppErr || !opp) return json(404, { error: 'Job not found' })
    if (!opp.pickup_address || !opp.dropoff_address) {
      return json(400, { error: 'This job needs both a pickup and drop-off address before requesting a driver quote.' })
    }

    let quote = null
    try {
      quote = await estimateLeadQuote({ pickupAddress: opp.pickup_address, dropoffAddress: opp.dropoff_address, scheduledAt: opp.scheduled_at })
    } catch { quote = null }

    const linkToken = crypto.randomBytes(12).toString('hex')
    const { error: insErr } = await admin.from('carrier_quote_requests').insert({
      org_id: orgId, opportunity_id: opportunityId, token: linkToken,
      pickup_address: opp.pickup_address, dropoff_address: opp.dropoff_address,
      miles: quote?.miles ?? null, system_estimate: quote?.amount ?? null,
    })
    if (insErr) return json(500, { error: insErr.message })

    return json(200, { token: linkToken, url: `${siteOrigin()}/carrier-quote/${linkToken}` })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
