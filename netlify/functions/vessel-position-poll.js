import { admin } from './_shared/supabaseAdmin.js'
import { fetchVesselData } from './_shared/aisStream.js'

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
    .select('id, mmsi')
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
  for (const vessel of vessels) {
    const d = data.get(vessel.mmsi)
    if (!d) continue

    const patch = {}
    if (d.lat != null) {
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
    if (updateErr) console.error(`❌ vessel-position-poll: update failed for ${vessel.mmsi}:`, updateErr)
    else updated++
  }

  return { statusCode: 200, body: JSON.stringify({ vesselsChecked: vessels.length, updated }) }
}
