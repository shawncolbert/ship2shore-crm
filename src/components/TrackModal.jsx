import { useEffect } from 'react'

// Single-pin version of the Static Images API map already used on the
// Dashboard's combined live map and Settings > Vessels -- zoomed to just
// one vessel or truck instead of everything at once, for when a
// dispatcher is looking at one specific job or ship and doesn't want to
// hunt for its pin among a dozen others on the combined view.
function pinMapUrl(lat, lon, color) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token || lat == null || lon == null) return null
  return `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/static/pin-s+${color}(${lon},${lat})/${lon},${lat},9/700x360@2x?access_token=${token}`
}

// icon: '🚢' or '🚚'; pinColor: hex without '#' (e8a317 vessel accent,
// 1fa97a truck/starboard, matching the combined Dashboard map's colors).
export default function TrackModal({ open, onClose, icon, pinColor, title, subtitle, lat, lon, detailLines }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const mapUrl = pinMapUrl(lat, lon, pinColor)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-xl sm:max-h-[80vh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-[family-name:var(--font-display)] text-lg font-bold text-ink">{icon} {title}</h2>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1 text-muted hover:bg-canvas hover:text-ink"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {mapUrl ? (
            <img src={mapUrl} alt={`${title} position`} className="block w-full" />
          ) : (
            <p className="p-5 text-sm text-muted">No position on file yet.</p>
          )}
          {detailLines?.length > 0 && (
            <div className="space-y-1 p-5 text-sm text-ink">
              {detailLines.map((line, i) => <p key={i}>{line}</p>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
