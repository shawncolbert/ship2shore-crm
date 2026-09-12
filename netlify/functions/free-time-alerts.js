import { admin } from './_shared/supabaseAdmin.js'
import { sendTelegramFreeTimeAlert } from './_shared/telegramDispatch.js'

// Scheduled (see netlify.toml), once a day. Each vessel's "last free day"
// (Settings > Vessels -- set by hand from whatever the carrier/terminal
// tells the dispatcher, since the "FREE TIME EXP." field on a delivery
// order itself is almost always left blank) is checked against every open
// job riding that vessel. Anything within ALERT_WINDOW_DAYS of that
// deadline -- or already past it -- that hasn't had its gate pass received
// yet gets one digest Telegram message per vessel, not one per vehicle.
//
// free_time_alert_sent_at is a one-time flag, same shape as
// review_request_sent_at elsewhere on this table: once a job's been
// mentioned, it's not mentioned again even if it keeps sliding further
// past due -- a dispatcher who's seen the first ping doesn't need a repeat
// every single day, and the badge on the Pipeline card (Pipeline.jsx)
// stays visible regardless for as long as it's actually true.
const ALERT_WINDOW_DAYS = 2

// Substring match, both sides normalized -- a job's vessel_name is often
// the carrier's full string ("MOLU ADRIA ACE 159A") while the vessel is
// registered under just its name ("ADRIA ACE"), same reasoning as the
// BL#/billing_number substring match gmail-sync already uses.
const normalize = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target - today) / 86400000)
}

export const handler = async () => {
  const { data: vessels, error: vesselErr } = await admin
    .from('vessels')
    .select('id, org_id, name, last_free_day')
    .not('last_free_day', 'is', null)
  if (vesselErr) {
    console.error('❌ free-time-alerts: could not read vessels:', vesselErr)
    return { statusCode: 500, body: vesselErr.message }
  }

  let alertsSent = 0
  const errors = []

  for (const vessel of vessels || []) {
    const daysLeft = daysUntil(vessel.last_free_day)
    if (daysLeft > ALERT_WINDOW_DAYS) continue // not due for a mention yet

    const { data: opps, error: oppErr } = await admin
      .from('opportunities')
      .select('id, vehicle, vehicle_year, vehicle_make, vehicle_model, bl_number, title, vessel_name, contacts!opportunities_contact_id_fkey(full_name)')
      .eq('org_id', vessel.org_id)
      .eq('status', 'open')
      .is('gate_pass_received_at', null)
      .is('free_time_alert_sent_at', null)
      .not('vessel_name', 'is', null)
    if (oppErr) { errors.push({ vessel: vessel.name, detail: oppErr.message }); continue }

    const normVessel = normalize(vessel.name)
    const matched = (opps || []).filter((o) => normalize(o.vessel_name).includes(normVessel))
    if (!matched.length) continue

    const jobs = matched.map((o) => ({
      customerName: o.contacts?.full_name || 'Unknown',
      vehicleDesc: [o.vehicle_year, o.vehicle_make, o.vehicle_model].filter(Boolean).join(' ') || o.vehicle || o.title || 'Vehicle',
      blNumber: o.bl_number,
      daysLeft,
    }))

    try {
      const result = await sendTelegramFreeTimeAlert({
        orgId: vessel.org_id, vesselName: vessel.name, lastFreeDay: vessel.last_free_day, jobs,
      })
      if (result.sent) {
        alertsSent++
        await admin.from('opportunities').update({ free_time_alert_sent_at: new Date().toISOString() })
          .in('id', matched.map((o) => o.id))
      } else {
        errors.push({ vessel: vessel.name, detail: result.reason })
      }
    } catch (e) {
      errors.push({ vessel: vessel.name, detail: String(e) })
    }
  }

  return { statusCode: 200, body: JSON.stringify({ vesselsChecked: (vessels || []).length, alertsSent, errors }) }
}
