import { admin } from './_shared/supabaseAdmin.js'
import { sendTelegramArrivalAlert } from './_shared/telegramDispatch.js'

// Public, unauthenticated endpoint for the /track/:token driver page
// (src/pages/DriverTracking.jsx). No app install, no login -- a driver
// opens a plain link in their own phone's browser. Everything here is
// looked up by the random token, never by anything requiring auth, which
// is why this goes through the service-role client instead of RLS.
//
// Location pings only happen while the driver's tab is open and in the
// foreground -- there is no background tracking, and the page says so.
// This is checkpoint tracking (pickup/drop-off confirmed by the driver's
// own tap), not a continuous live map.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

async function getJob(token) {
  const { data: jt, error } = await admin
    .from('job_tracking')
    .select('opportunity_id, org_id, pickup_arrived_at, dropoff_arrived_at')
    .eq('token', token).maybeSingle()
  if (error || !jt) return null

  const { data: opp } = await admin
    .from('opportunities')
    .select('title, vehicle, vehicle_year, vehicle_make, vehicle_model, pickup_address, dropoff_address')
    .eq('id', jt.opportunity_id).maybeSingle()

  const vehicleDesc = [opp?.vehicle_year, opp?.vehicle_make, opp?.vehicle_model].filter(Boolean).join(' ') || opp?.vehicle || opp?.title || 'Job'
  return {
    jobLabel: vehicleDesc,
    pickupAddress: opp?.pickup_address || null,
    dropoffAddress: opp?.dropoff_address || null,
    pickupArrivedAt: jt.pickup_arrived_at,
    dropoffArrivedAt: jt.dropoff_arrived_at,
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { action, token } = payload
  if (!token) return json(400, { error: 'Missing token' })

  try {
    if (action === 'get') {
      const job = await getJob(token)
      return job ? json(200, job) : json(404, { error: 'Tracking link not found' })
    }

    if (action === 'ping') {
      const { lat, lng } = payload
      if (typeof lat !== 'number' || typeof lng !== 'number') return json(400, { error: 'Missing lat/lng' })
      const { error } = await admin
        .from('job_tracking')
        .update({ last_lat: lat, last_lng: lng, last_ping_at: new Date().toISOString() })
        .eq('token', token)
      if (error) return json(500, { error: error.message })
      return json(200, { ok: true })
    }

    if (action === 'arrive') {
      const { stage } = payload
      if (stage !== 'pickup' && stage !== 'dropoff') return json(400, { error: 'stage must be pickup or dropoff' })

      const { data: jt, error: selectError } = await admin
        .from('job_tracking').select('opportunity_id, org_id').eq('token', token).maybeSingle()
      if (selectError || !jt) return json(404, { error: 'Tracking link not found' })

      const column = stage === 'pickup' ? 'pickup_arrived_at' : 'dropoff_arrived_at'
      const { error: updateError } = await admin
        .from('job_tracking').update({ [column]: new Date().toISOString() }).eq('token', token)
      if (updateError) return json(500, { error: updateError.message })

      // Best-effort -- a failed Telegram post shouldn't stop the driver's
      // tap from being recorded, which is the part that actually matters.
      try {
        await sendTelegramArrivalAlert({ orgId: jt.org_id, opportunityId: jt.opportunity_id, stage })
      } catch {
        // ignore
      }

      return json(200, { ok: true })
    }

    return json(400, { error: 'Unknown action' })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
