import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MAPBOX_TOKEN } from '../lib/mapbox'
import { fetchMyProfile, fetchDropoffNotes, addDropoffNote } from '../lib/supabase'

async function geocodeOne(address) {
  if (!MAPBOX_TOKEN || !address?.trim()) return null
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=false&country=us&types=address,place&limit=1`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const [lng, lat] = data.features?.[0]?.center || []
  return typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null
}

// A photo of the drop-off, plus whatever your own drivers/dispatchers have
// actually reported about it before -- never an automated "risk score".
// A street name can't tell you a truck got stuck backing out of a driveway
// last month; only someone who was actually there can, so that's the only
// signal this shows. onCoordsReady lets the parent grab the same lat/lng
// (and whatever notes are on file) to fold into "Text route to driver"
// without a second geocode of its own.
export default function DropoffPreview({ pickup, dropoff, orgId, opportunityId, onCoordsReady }) {
  const [coords, setCoords] = useState(null)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteKind, setNoteKind] = useState('warn')
  const [saving, setSaving] = useState(false)
  const stop = (e) => e.stopPropagation()

  const { data: profile } = useQuery({ queryKey: ['myProfile'], queryFn: fetchMyProfile })

  useEffect(() => {
    if (!dropoff?.trim()) { setCoords(null); return }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      const c = await geocodeOne(dropoff)
      if (!cancelled) { setCoords(c); setLoading(false) }
    }, 700)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [dropoff])

  const { data: notes, refetch } = useQuery({
    queryKey: ['dropoffNotes', orgId, coords?.lat, coords?.lng],
    queryFn: () => fetchDropoffNotes(orgId, coords.lat, coords.lng),
    enabled: !!(orgId && coords),
  })

  useEffect(() => {
    if (coords) onCoordsReady?.({ ...coords, notes: notes || [] })
  }, [coords, notes]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveNote = async () => {
    if (!noteText.trim() || !coords || saving) return
    setSaving(true)
    try {
      await addDropoffNote({
        orgId, opportunityId, address: dropoff, lat: coords.lat, lng: coords.lng,
        note: noteText, kind: noteKind, createdByName: profile?.full_name || null,
      })
      setNoteText(''); setAdding(false)
      refetch()
    } catch {
      // best-effort -- the field stays filled so they can retry
    } finally {
      setSaving(false)
    }
  }

  if (!dropoff?.trim()) return null

  const staticMapUrl = coords && MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/pin-s+ff453a(${coords.lng},${coords.lat})/${coords.lng},${coords.lat},17,0/168x120@2x?access_token=${MAPBOX_TOKEN}`
    : null
  // Same Google Maps directions link format already used when texting a
  // driver the job (see shareBooking.js) -- clicking the thumbnail opens
  // the real driving route, pickup to this drop-off, not just a static pin.
  const directionsUrl = pickup?.trim() && dropoff?.trim()
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(pickup)}&destination=${encodeURIComponent(dropoff)}`
    : null

  return (
    <div onClick={stop} className="space-y-1.5 rounded border border-line bg-canvas/50 p-2">
      <h4 className="text-[10px] font-semibold uppercase tracking-wide text-muted">Drop-off preview</h4>
      <p className="rounded bg-ink/5 px-2 py-1.5 text-[11px] leading-snug text-muted">
        Review the photo before dispatching — nothing here is auto-verified.
      </p>

      <div className="grid grid-cols-[1fr_auto] gap-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">Known access notes</span>
            {coords && (
              <button type="button" onClick={() => setAdding((v) => !v)} className="text-[10px] font-semibold text-accent-600 hover:underline">
                {adding ? 'Cancel' : '+ Add a note'}
              </button>
            )}
          </div>

          {adding && (
            <div className="mb-2 space-y-1.5 rounded border border-line bg-surface p-1.5">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                placeholder="e.g. Dirt driveway, no turnaround — small car only"
                className="w-full resize-none rounded border border-line bg-canvas px-1.5 py-1 text-[11px] text-ink outline-none focus:border-accent"
              />
              <div className="flex items-center gap-1.5">
                <select value={noteKind} onChange={(e) => setNoteKind(e.target.value)} className="rounded border border-line bg-canvas px-1 py-0.5 text-[10px] text-ink">
                  <option value="warn">⚠ Access issue</option>
                  <option value="info">ℹ Helpful info</option>
                </select>
                <button
                  type="button"
                  onClick={saveNote}
                  disabled={!noteText.trim() || saving}
                  className="ml-auto rounded bg-accent px-2 py-0.5 text-[10px] font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save note'}
                </button>
              </div>
            </div>
          )}

          {!coords ? (
            <p className="text-[11px] text-muted">{loading ? 'Locating…' : 'Could not locate this address.'}</p>
          ) : notes?.length ? (
            <div className="space-y-1">
              {notes.map((n) => (
                <div key={n.id} className={`flex gap-1.5 rounded border border-line bg-surface p-1.5 ${n.kind === 'warn' ? 'border-l-2 border-l-port' : 'border-l-2 border-l-accent'}`}>
                  <p className="text-[11px] leading-snug text-ink">
                    {n.note}
                    <span className="mt-0.5 block font-[family-name:var(--font-mono)] text-[9px] text-muted">
                      {n.created_by_name || 'Staff'} · {new Date(n.created_at).toLocaleDateString()}
                    </span>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] italic text-muted">No notes on file for this address yet.</p>
          )}
        </div>

        <div className="w-[84px] shrink-0 sm:w-[168px]">
          <div className="group relative h-[60px] overflow-hidden rounded border border-line bg-ink/10 sm:h-[120px]">
            {staticMapUrl ? (
              directionsUrl ? (
                <a href={directionsUrl} target="_blank" rel="noreferrer" title="Open driving directions, pickup to drop-off">
                  <img src={staticMapUrl} alt="Satellite view of drop-off — click for driving directions" className="h-full w-full object-cover" />
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/50 text-center text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                    Open directions →
                  </span>
                </a>
              ) : (
                <img src={staticMapUrl} alt="Satellite view of drop-off" className="h-full w-full object-cover" />
              )
            ) : (
              <div className="flex h-full items-center justify-center text-center text-[9px] text-muted">
                {loading ? 'Locating…' : 'Awaiting address'}
              </div>
            )}
          </div>
          <p className="mt-0.5 text-center font-[family-name:var(--font-mono)] text-[9px] text-muted">
            {directionsUrl ? 'tap for directions' : 'satellite · Mapbox'}
          </p>
        </div>
      </div>
    </div>
  )
}
