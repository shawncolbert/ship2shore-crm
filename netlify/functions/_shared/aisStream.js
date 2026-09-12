import WebSocket from 'ws'

// AISStream.io is a WebSocket feed, not a request/response API -- there's
// no "GET current position" endpoint to poll. So this opens the socket,
// asks for PositionReport messages for just the MMSIs we care about,
// listens for a short window, and closes. Good enough for ships: they
// move miles per hour, not miles per second, so a snapshot every
// VESSEL_POLL schedule interval (netlify.toml) is plenty current, and a
// short-lived connection fits Netlify's function time limit instead of
// needing a separate always-on process just to hold a socket open.
const LISTEN_WINDOW_MS = 20_000

// Whole-earth box -- FiltersShipMMSI below is what actually narrows the
// feed to our vessels; the bounding box is only required by their API
// shape, not meant to do the filtering here.
const WORLD_BOUNDING_BOX = [[[-90, -180], [90, 180]]]

// Resolves to a Map<mmsi string, { lat, lon, speedKn, courseDeg, atIso }>
// with one entry per MMSI that actually reported a position inside the
// listen window -- a vessel mid-ocean with no terrestrial AIS receiver in
// range may simply not answer, same as the real MarineTraffic embed goes
// quiet there (see the mockup's note about that).
export function fetchVesselPositions(mmsiList) {
  return new Promise((resolve) => {
    const apiKey = process.env.AISSTREAM_API_KEY
    const positions = new Map()
    if (!apiKey || !mmsiList?.length) { resolve(positions); return }

    let ws
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      try { ws?.close() } catch { /* already closed */ }
      resolve(positions)
    }
    const timer = setTimeout(finish, LISTEN_WINDOW_MS)

    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
    } catch (e) {
      clearTimeout(timer)
      console.error('❌ aisStream: could not open socket:', e)
      resolve(positions)
      return
    }

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: WORLD_BOUNDING_BOX,
        FiltersShipMMSI: mmsiList,
        FilterMessageTypes: ['PositionReport'],
      }))
    })

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.MessageType !== 'PositionReport') return
        const report = msg.Message?.PositionReport
        const mmsi = String(msg.MetaData?.MMSI ?? report?.UserID ?? '')
        if (!mmsi || !report) return
        positions.set(mmsi, {
          lat: report.Latitude,
          lon: report.Longitude,
          speedKn: report.Sog,
          courseDeg: report.Cog,
          atIso: msg.MetaData?.time_utc || new Date().toISOString(),
        })
      } catch (e) {
        console.error('❌ aisStream: bad message:', e)
      }
    })

    ws.addEventListener('error', (e) => {
      console.error('❌ aisStream: socket error:', e?.message || e)
      clearTimeout(timer)
      finish()
    })

    ws.addEventListener('close', () => {
      clearTimeout(timer)
      finish()
    })
  })
}
