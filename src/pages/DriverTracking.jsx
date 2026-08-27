import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

// Public, no-login driver page for a single job's tracking link (see
// fetchOrCreateTrackingLink in lib/supabase.js and the "Text route" /
// "Text to another driver" buttons on Pipeline). No app to install --
// this just asks the browser for location once, then pings it
// periodically while THIS TAB stays open and in the foreground. Locking
// the phone or switching apps stops the pings completely; this is
// checkpoint tracking (two tap-confirmed timestamps), not a live map.
const PING_INTERVAL_MS = 90_000

function post(token, body) {
  return fetch('/.netlify/functions/driver-tracking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, ...body }),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`)
    return j
  })
}

function mapsLink(address) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

export default function DriverTracking() {
  const { token } = useParams()
  const [job, setJob] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [geoState, setGeoState] = useState('idle') // idle | on | denied | unsupported
  const [arriving, setArriving] = useState(null) // 'pickup' | 'dropoff' | null

  useEffect(() => {
    post(token, { action: 'get' }).then(setJob).catch((e) => setLoadError(e.message))
  }, [token])

  useEffect(() => {
    if (!job || !navigator.geolocation) { if (job) setGeoState('unsupported'); return }

    const ping = () => {
      if (document.visibilityState !== 'visible') return
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGeoState('on')
          post(token, { action: 'ping', lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(() => {})
        },
        () => setGeoState('denied'),
        { enableHighAccuracy: false, timeout: 15_000 },
      )
    }

    ping()
    const id = setInterval(ping, PING_INTERVAL_MS)
    return () => clearInterval(id)
  }, [job, token])

  async function markArrived(stage) {
    setArriving(stage)
    try {
      await post(token, { action: 'arrive', stage })
      setJob((j) => ({ ...j, [stage === 'pickup' ? 'pickupArrivedAt' : 'dropoffArrivedAt']: new Date().toISOString() }))
    } catch (e) {
      setLoadError(e.message)
    } finally {
      setArriving(null)
    }
  }

  if (loadError && !job) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
          <p className="text-sm text-muted">{loadError === 'Tracking link not found' ? 'This tracking link is no longer valid.' : loadError}</p>
        </div>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">{job.jobLabel}</h1>
        <p className="mt-1 text-sm text-muted">
          {geoState === 'on' && 'Sharing location while this page is open.'}
          {geoState === 'denied' && 'Location is off — arrival buttons below still work fine without it.'}
          {geoState === 'unsupported' && "This browser can't share location — arrival buttons below still work."}
          {geoState === 'idle' && 'Requesting location…'}
        </p>

        <div className="mt-6 space-y-3">
          <ArrivalRow
            label="Pickup" address={job.pickupAddress} arrivedAt={job.pickupArrivedAt}
            busy={arriving === 'pickup'} onArrive={() => markArrived('pickup')}
          />
          <ArrivalRow
            label="Drop-off" address={job.dropoffAddress} arrivedAt={job.dropoffArrivedAt}
            busy={arriving === 'dropoff'} onArrive={() => markArrived('dropoff')}
          />
        </div>

        {loadError && <p className="mt-4 text-xs text-red-600">{loadError}</p>}

        <p className="mt-6 text-xs text-muted">
          Locking your phone or leaving this tab pauses location sharing — reopen this link any time to resume.
        </p>
      </div>
    </div>
  )
}

function ArrivalRow({ label, address, arrivedAt, busy, onArrive }) {
  return (
    <div className="rounded-lg border border-line bg-canvas/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{label}</p>
          {address && (
            <a href={mapsLink(address)} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-xs text-accent hover:underline">
              {address}
            </a>
          )}
        </div>
        {arrivedAt ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            Arrived {new Date(arrivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        ) : (
          <button
            type="button" onClick={onArrive} disabled={busy}
            className="shrink-0 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-xs font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {busy ? 'Saving…' : `I've arrived`}
          </button>
        )}
      </div>
    </div>
  )
}
