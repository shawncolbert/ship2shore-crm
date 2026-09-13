import { admin } from './_shared/supabaseAdmin.js'
import { fetchVesselData } from './_shared/aisStream.js'
import { sendTelegramVesselInRangeAlert } from './_shared/telegramDispatch.js'

// A ship going quiet for less than this is just the normal gap between
// AIS receiver pickups (open ocean, a busy strait, etc.) -- longer than
// this and it's actually left range (or the vessel's story starts over
// after being newly added), so reappearing after this long is worth a
// fresh "just came into range" alert instead of staying silent forever
// after the first one.
const STALE_HOURS = 6

// Scheduled (see netlify.toml). Refreshes each vessel's position AND its
// crew-reported destination/ETA -- Settings > Vessels, mmsi set by hand --
// from the free AISStream feed. Same "set once per vessel by hand" pattern
// as last_free_day, except this field comes from AIS instead of a phone
// call to the carrier. Position and static data (destination/ETA) can
// arrive independently within a single poll -- only overwrite whichever
// half actually showed up, never null out the other on a partial read.
export const handler = async () => {
  const { data: vessels, error } = await admin
    .from('vessels')
    .select('id, org_id, name, mmsi, last_lat, position_updated_at, reported_destination, reported_eta')
    .not('mmsi', 'is', null)
  if (error) {
    console.error('❌ vessel-position-poll: could not read vessels:', error)
    return { statusCode: 500, body: error.message }
  }
  if (!vessels?.length) {
    return { statusCode: 200, body: JSON.stringify({ vesselsChecked: 0, updated: 0 }) }
  }

  const mmsiList = vessels.map((v) => v.mmsi)
  const data = await fetchVesselData(mmsiList)

  let updated = 0
  let inRangeAlerts = 0
  for (const vessel of vessels) {
    const d = data.get(vessel.mmsi)
    if (!d) continue

    const patch = {}
    let justCameIntoRange = false
    if (d.lat != null) {
      const wasStale = vessel.last_lat == null
        || !vessel.position_updated_at
        || (Date.now() - new Date(vessel.position_updated_at).getTime()) > STALE_HOURS * 3600_000
      if (wasStale) justCameIntoRange = true
      patch.last_lat = d.lat
      patch.last_lon = d.lon
      patch.last_speed_kn = d.speedKn
      patch.last_course_deg = d.courseDeg
      patch.position_updated_at = d.positionAtIso
    }
    if (d.destination !== undefined || d.etaIso !== undefined) {
      patch.reported_destination = d.destination ?? null
      patch.reported_eta = d.etaIso ?? null
      patch.static_data_updated_at = d.staticAtIso
    }
    if (!Object.keys(patch).length) continue

    const { error: updateErr } = await admin.from('vessels').update(patch).eq('id', vessel.id)
    if (updateErr) { console.error(`❌ vessel-position-poll: update failed for ${vessel.mmsi}:`, updateErr); continue }
    updated++

    if (justCameIntoRange) {
      try {
        const result = await sendTelegramVesselInRangeAlert({
          orgId: vessel.org_id,
          vesselName: vessel.name,
          destination: d.destination ?? vessel.reported_destination,
          etaIso: d.etaIso ?? vessel.reported_eta,
        })
        if (result.sent) inRangeAlerts++
      } catch (e) {
        console.error(`❌ vessel-position-poll: in-range alert failed for ${vessel.mmsi}:`, e)
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ vesselsChecked: vessels.length, updated, inRangeAlerts }) }
}
