import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchTrackedVessels, fetchTrackedTrucks } from '../lib/supabase'

// Long Beach/Wilmington port complex -- the default view when nothing has
// reported a position yet, since that's where this business's trucks and
// (eventually) its ships are actually headed.
const DEFAULT_CENTER = [-118.21, 33.75]

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

function vesselPopupHtml(v) {
  const eta = v.reported_eta
    ? `${v.reported_destination ? `→ ${v.reported_destination} · ` : ''}ETA ${formatEta(v.reported_eta)}`
    : 'No ETA reported yet'
  return `<div style="font:12px system-ui;min-width:160px">
    <div style="font-weight:700;margin-bottom:2px">🚢 ${v.name}</div>
    <div>${eta}</div>
    <div style="color:#6b7f8c;margin-top:2px">${v.last_speed_kn ?? '?'} kn · updated ${ago(v.position_updated_at)}</div>
  </div>`
}

function truckPopupHtml(t) {
  return `<div style="font:12px system-ui;min-width:160px">
    <div style="font-weight:700;margin-bottom:2px">🚚 ${t.customerName}</div>
    <div>${t.vehicleDesc}</div>
    <div style="color:#6b7f8c;margin-top:2px">updated ${ago(t.lastPingAt)}</div>
  </div>`
}

// Combines the two things this business actually ships on: vessels
// (Settings > Vessels, positioned via AISStream) and trucks (the
// driver-tracking link texted out from Pipeline, positioned via GPS pings
// from the driver's own phone). Polls rather than using Supabase realtime,
// matching the rest of the app's React Query pattern (see
// PaymentClaimToast.jsx) -- simpler to reason about, and neither position
// source updates faster than this poll interval makes visible anyway.
export default function LiveMap() {
  const mapDiv = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ vessels: new Map(), trucks: new Map() })
  const [mapReady, setMapReady] = useState(false)

  const { data: vessels } = useQuery({ queryKey: ['trackedVessels'], queryFn: fetchTrackedVessels, refetchInterval: 30_000 })
  const { data: trucks } = useQuery({ queryKey: ['trackedTrucks'], queryFn: fetchTrackedTrucks, refetchInterval: 30_000 })

  const token = import.meta.env.VITE_MAPBOX_TOKEN
  const hasAnything = (vessels?.length || 0) + (trucks?.length || 0) > 0

  // Mounts the actual GL map (a billed "map load" on Mapbox's free tier)
  // only once there's something worth showing -- no point spending one on
  // an empty ocean every time the Dashboard loads.
  useEffect(() => {
    if (!token || !hasAnything || mapRef.current || !mapDiv.current) return
    mapboxgl.accessToken = token
    const map = new mapboxgl.Map({
      container: mapDiv.current,
      style: 'mapbox://styles/mapbox/navigation-night-v1',
      center: DEFAULT_CENTER,
      zoom: 4,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => setMapReady(true))
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; setMapReady(false) }
  }, [token, hasAnything])

  // Reconciles markers on every poll instead of tearing the map down and
  // rebuilding it -- keeps existing popups open and avoids a visible flash
  // every 30 seconds.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return
    const map = mapRef.current
    const bounds = new mapboxgl.LngLatBounds()
    let any = false

    const seenVesselIds = new Set()
    for (const v of vessels || []) {
      seenVesselIds.add(v.id)
      const lngLat = [v.last_lon, v.last_lat]
      bounds.extend(lngLat); any = true
      let marker = markersRef.current.vessels.get(v.id)
      if (!marker) {
        const el = document.createElement('div')
        el.textContent = '🚢'
        el.style.fontSize = '20px'
        marker = new mapboxgl.Marker({ element: el })
          .setPopup(new mapboxgl.Popup({ offset: 16 }))
          .addTo(map)
        markersRef.current.vessels.set(v.id, marker)
      }
      marker.setLngLat(lngLat)
      marker.getPopup().setHTML(vesselPopupHtml(v))
    }
    for (const [id, marker] of markersRef.current.vessels) {
      if (!seenVesselIds.has(id)) { marker.remove(); markersRef.current.vessels.delete(id) }
    }

    const seenTruckIds = new Set()
    for (const t of trucks || []) {
      seenTruckIds.add(t.opportunityId)
      const lngLat = [t.lon, t.lat]
      bounds.extend(lngLat); any = true
      let marker = markersRef.current.trucks.get(t.opportunityId)
      if (!marker) {
        const el = document.createElement('div')
        el.textContent = '🚚'
        el.style.fontSize = '20px'
        marker = new mapboxgl.Marker({ element: el })
          .setPopup(new mapboxgl.Popup({ offset: 16 }))
          .addTo(map)
        markersRef.current.trucks.set(t.opportunityId, marker)
      }
      marker.setLngLat(lngLat)
      marker.getPopup().setHTML(truckPopupHtml(t))
    }
    for (const [id, marker] of markersRef.current.trucks) {
      if (!seenTruckIds.has(id)) { marker.remove(); markersRef.current.trucks.delete(id) }
    }

    if (any && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 500 })
  }, [vessels, trucks, mapReady])

  if (!token) return null // VITE_MAPBOX_TOKEN not set -- rest of the app already depends on it existing

  return (
    <div className="mt-6 overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between p-5 pb-0">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">Live tracking</h2>
        <span className="text-xs text-muted">{vessels?.length || 0} vessel{vessels?.length === 1 ? '' : 's'} · {trucks?.length || 0} truck{trucks?.length === 1 ? '' : 's'} in transit</span>
      </div>
      {hasAnything ? (
        <div ref={mapDiv} className="mt-4 h-[420px] w-full" />
      ) : (
        <p className="p-5 text-sm text-muted">
          Nothing to show yet — add an MMSI to a vessel (Settings &gt; Vessels) or text a driver their tracking link from Pipeline.
        </p>
      )}
    </div>
  )
}
