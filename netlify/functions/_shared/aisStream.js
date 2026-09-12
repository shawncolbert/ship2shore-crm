import WebSocket from 'ws'

// AISStream.io is a WebSocket feed, not a request/response API -- there's
// no "GET current position" endpoint to poll. So this opens the socket,
// asks for messages about just the MMSIs we care about, listens for a
// short window, and closes. Good enough for ships: they move miles per
// hour, not miles per second, so a snapshot every VESSEL_POLL schedule
// interval (netlify.toml) is plenty current, and a short-lived connection
// fits Netlify's function time limit instead of needing a separate
// always-on process just to hold a socket open.
//
// ShipStaticData (destination/ETA) is broadcast far less often than
// PositionReport -- roughly every 6 minutes vs. every few seconds -- so a
// single 25s window may well miss it on any given poll. That's fine: it
// only changes when the crew updates it, and it'll get picked up on a
// later poll well before it's stale enough to matter.
const LISTEN_WINDOW_MS = 25_000

// Whole-earth box -- FiltersShipMMSI below is what actually narrows the
// feed to our vessels; the bounding box is only required by their API
// shape, not meant to do the filtering here.
const WORLD_BOUNDING_BOX = [[[-90, -180], [90, 180]]]

// AIS ETA has no year field (ITU standard -- just month/day/hour/minute),
// and month 0 means "not available" (crew never set it). Assumes the
// current year unless that lands the date more than 60 days in the past,
// in which case the voyage must span into next year -- a genuine guess,
// same one every AIS-based tracker has to make, not something more exact
// exists to read.
function buildEtaIso(eta) {
  if (!eta?.Month) return null
  const now = Date.now()
  const y = new Date().getUTCFullYear()
  let candidate = Date.UTC(y, eta.Month - 1, eta.Day || 1, eta.Hour ?? 0, eta.Minute ?? 0)
  if (candidate < now - 60 * 24 * 3600_000) candidate = Date.UTC(y + 1, eta.Month - 1, eta.Day || 1, eta.Hour ?? 0, eta.Minute ?? 0)
  return new Date(candidate).toISOString()
}

// AIS text fields are fixed-width and '@'-padded (e.g. "LONG BEACH@@@@@").
function cleanAisText(s) {
  const t = (s || '').replace(/@+$/, '').trim()
  return t || null
}

// Resolves to a Map<mmsi string, { lat?, lon?, speedKn?, courseDeg?,
// positionAtIso?, destination?, etaIso?, staticAtIso? }> -- one entry per
// MMSI that reported anything inside the listen window. A vessel mid-ocean
// with no terrestrial AIS receiver in range may simply not answer at all,
// same as the real MarineTraffic embed goes quiet there.
export function fetchVesselData(mmsiList) {
  return new Promise((resolve) => {
    const apiKey = process.env.AISSTREAM_API_KEY
    const results = new Map()
    if (!apiKey || !mmsiList?.length) { resolve(results); return }

    const merge = (mmsi, patch) => results.set(mmsi, { ...results.get(mmsi), ...patch })

    let ws
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      try { ws?.close() } catch { /* already closed */ }
      resolve(results)
    }
    const timer = setTimeout(finish, LISTEN_WINDOW_MS)

    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
    } catch (e) {
      clearTimeout(timer)
      console.error('❌ aisStream: could not open socket:', e)
      resolve(results)
      return
    }

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: WORLD_BOUNDING_BOX,
        FiltersShipMMSI: mmsiList,
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      }))
    })

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data)
        const atIso = msg.MetaData?.time_utc || new Date().toISOString()

        if (msg.MessageType === 'PositionReport') {
          const report = msg.Message?.PositionReport
          const mmsi = String(msg.MetaData?.MMSI ?? report?.UserID ?? '')
          if (!mmsi || !report) return
          merge(mmsi, { lat: report.Latitude, lon: report.Longitude, speedKn: report.Sog, courseDeg: report.Cog, positionAtIso: atIso })
        } else if (msg.MessageType === 'ShipStaticData') {
          const report = msg.Message?.ShipStaticData
          const mmsi = String(msg.MetaData?.MMSI ?? report?.UserID ?? '')
          if (!mmsi || !report) return
          merge(mmsi, { destination: cleanAisText(report.Destination), etaIso: buildEtaIso(report.Eta), staticAtIso: atIso })
        }
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
