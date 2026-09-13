import { useQuery } from '@tanstack/react-query'
import { fetchTrackedVessels, fetchTrackedTrucks } from '../lib/supabase'

// Mapbox Static Images API -- a plain <img>, same approach already proven
// out on Settings > Vessels. Tried an interactive mapbox-gl (WebGL) map
// here first; it crashed the whole Dashboard on a phone, and after three
// rounds of hardening it still failed outright (silently, then visibly)
// on a completely ordinary desktop Chrome -- WebGL support turned out to
// be too unreliable across this business's actual devices to build on.
// A static image can't crash: worst case is a broken image icon, and
// every browser can render an <img> tag.
function combinedMapUrl(vessels, trucks) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  const vesselPins = vessels.filter((v) => v.last_lat != null && v.last_lon != null)
  const truckPins = trucks.filter((t) => t.lat != null && t.lon != null)
  if (!token || vesselPins.length + truckPins.length === 0) return null
  const pins = [
    ...vesselPins.map((v) => `pin-s+e8a317(${v.last_lon},${v.last_lat})`),
    ...truckPins.map((t) => `pin-s+1fa97a(${t.lon},${t.lat})`),
  ].join(',')
  return `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/static/${pins}/auto/1000x360@2x?padding=60&access_token=${token}`
}

function ago(iso) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatEta(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    + ' ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

// Combines the two things this business actually ships on: vessels
// (Settings > Vessels, positioned via AISStream) and trucks (the
// driver-tracking link texted out from Pipeline, positioned via GPS pings
// from the driver's own phone). Polls rather than using Supabase realtime,
// matching the rest of the app's React Query pattern (see
// PaymentClaimToast.jsx).
export default function LiveMap() {
  const { data: vessels } = useQuery({ queryKey: ['trackedVessels'], queryFn: fetchTrackedVessels, refetchInterval: 30_000 })
  const { data: trucks } = useQuery({ queryKey: ['trackedTrucks'], queryFn: fetchTrackedTrucks, refetchInterval: 30_000 })

  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return null // rest of the app already depends on this existing

  const vesselList = vessels || []
  const truckList = trucks || []
  const mapUrl = combinedMapUrl(vesselList, truckList)

  return (
    <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between p-5 pb-0">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Live tracking</h2>
        <span className="text-xs text-muted">{vesselList.length} vessel{vesselList.length === 1 ? '' : 's'} · {truckList.length} truck{truckList.length === 1 ? '' : 's'} in transit</span>
      </div>

      {!mapUrl ? (
        <p className="p-5 text-sm text-muted">
          Nothing to show yet — add an MMSI to a vessel (Settings &gt; Vessels) or text a driver their tracking link from Pipeline.
        </p>
      ) : (
        <>
          <img src={mapUrl} alt="Live vessel and truck positions" className="mt-4 block w-full" />
          <div className="grid gap-3 p-5 sm:grid-cols-2">
            {vesselList.filter((v) => v.last_lat != null).map((v) => (
              <div key={v.id} className="rounded-md border border-line bg-canvas p-3 text-xs">
                <div className="font-semibold text-ink">🚢 {v.name}</div>
                <div className="mt-1 text-muted">
                  {v.reported_eta
                    ? `${v.reported_destination ? `→ ${v.reported_destination} · ` : ''}ETA ${formatEta(v.reported_eta)}`
                    : 'No ETA reported yet'}
                </div>
                <div className="mt-1 text-muted">{v.last_speed_kn ?? '?'} kn · updated {ago(v.position_updated_at)}</div>
              </div>
            ))}
            {truckList.filter((t) => t.lat != null).map((t) => (
              <div key={t.opportunityId} className="rounded-md border border-line bg-canvas p-3 text-xs">
                <div className="font-semibold text-ink">🚚 {t.customerName}</div>
                <div className="mt-1 text-muted">{t.vehicleDesc}</div>
                <div className="mt-1 text-muted">updated {ago(t.lastPingAt)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
