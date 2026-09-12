import { admin } from './_shared/supabaseAdmin.js'
import { fetchVesselPositions } from './_shared/aisStream.js'

// Scheduled (see netlify.toml). Refreshes last_lat/last_lon/etc. on every
// vessel that has an MMSI set (Settings > Vessels) from the free AISStream
// feed -- same "set once per vessel by hand" pattern as last_free_day,
// except this field comes from AIS instead of a phone call to the carrier.
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
  const positions = await fetchVesselPositions(mmsiList)

  let updated = 0
  for (const vessel of vessels) {
    const pos = positions.get(vessel.mmsi)
    if (!pos) continue
    const { error: updateErr } = await admin
      .from('vessels')
      .update({
        last_lat: pos.lat,
        last_lon: pos.lon,
        last_speed_kn: pos.speedKn,
        last_course_deg: pos.courseDeg,
        position_updated_at: pos.atIso,
      })
      .eq('id', vessel.id)
    if (updateErr) console.error(`❌ vessel-position-poll: update failed for ${vessel.mmsi}:`, updateErr)
    else updated++
  }

  return { statusCode: 200, body: JSON.stringify({ vesselsChecked: vessels.length, updated }) }
}
