import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchVessels, upsertVessel, deleteVessel, lookupVesselMmsi } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const input = 'rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'

// Mapbox Static Images API -- a plain <img>, no client-side map library.
// Consistent with how this app already talks to Mapbox everywhere else
// (geocoding/directions calls from server functions), and a flat pin map
// reads faster at a glance than a spinning globe would for 1-3 vessels.
function vesselsMapUrl(vessels) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  const pinned = vessels.filter((v) => v.last_lat != null && v.last_lon != null)
  if (!token || !pinned.length) return null
  const pins = pinned
    .map((v) => `pin-s+e8a317(${v.last_lon},${v.last_lat})`)
    .join(',')
  return `https://api.mapbox.com/styles/v1/mapbox/navigation-night-v1/static/${pins}/auto/900x320@2x?padding=60&access_token=${token}`
}

// AISStream (vessel-position-poll.js, every 30 min) can only report a
// position while a terrestrial AIS receiver is in range -- mid-ocean gaps
// are normal, same as the real MarineTraffic embed goes quiet there. So
// "stale" here means the feed hasn't heard from the ship in a while, not
// that anything's broken.
// AIS ETA is crew-entered on the ship's own transponder, same source real
// trackers (MarineTraffic, VesselFinder) show as "ETA" -- it's the best
// automatic docking estimate that exists without a paid terminal feed, but
// it's only as good as whoever on the ship last updated it.
function formatEta(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    + ' ' + new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

function positionAge(iso) {
  if (!iso) return null
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// The carrier's "FREE TIME EXP." field on a delivery order is almost always
// left blank -- the real deadline comes later, by phone or email from the
// terminal/carrier. Set it here once per vessel and every open job on that
// vessel (matched by vessel_name, see free-time-alerts.js) gets covered by
// the daily Telegram digest -- no need to type a date onto each job.
const daysLeft = (dateStr) => {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target - today) / 86400000)
}

function badge(d) {
  if (d == null) return null
  if (d < 0) return { text: `${Math.abs(d)}d past due`, cls: 'bg-red-100 text-port' }
  if (d === 0) return { text: 'Due today', cls: 'bg-red-100 text-port' }
  if (d <= 2) return { text: `${d}d left`, cls: 'bg-accent/20 text-ink' }
  return { text: `${d}d left`, cls: 'bg-canvas text-muted' }
}

export default function Vessels() {
  const qc = useQueryClient()
  const { data: vessels, isLoading } = useQuery({ queryKey: ['vessels'], queryFn: fetchVessels })
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [mmsi, setMmsi] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [lookupState, setLookupState] = useState('idle') // idle | loading | multiple | none | done
  const [candidates, setCandidates] = useState([])

  const refresh = () => qc.invalidateQueries({ queryKey: ['vessels'] })

  // Fires the moment a dispatcher tabs off the name field with no MMSI
  // typed yet -- this is what makes it "automatic" instead of them having
  // to ask for the MMSI by hand every time a new vessel comes up. A common
  // name can match more than one real ship worldwide, so multiple results
  // get shown as picks rather than silently taking the first one.
  async function lookupMmsiForName() {
    if (!name.trim() || mmsi.trim()) return
    setLookupState('loading'); setCandidates([])
    try {
      const { matches, configured } = await lookupVesselMmsi(name.trim())
      if (!configured) { setLookupState('idle'); return } // VESSELAPI_KEY not set -- fail quiet, manual entry still works
      if (matches.length === 1) { setMmsi(matches[0].mmsi); setLookupState('done') }
      else if (matches.length > 1) { setCandidates(matches); setLookupState('multiple') }
      else setLookupState('none')
    } catch {
      setLookupState('idle') // best-effort -- never blocks manually typing an MMSI
    }
  }

  function pickCandidate(c) {
    setMmsi(c.mmsi)
    setCandidates([])
    setLookupState('done')
  }

  async function addVessel(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setErr('')
    try {
      await upsertVessel({ name, lastFreeDay: date || null, mmsi: mmsi || null })
      setName(''); setDate(''); setMmsi(''); setLookupState('idle'); setCandidates([])
      refresh()
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setSaving(false)
    }
  }

  // Always carries every field forward -- upsertVessel writes exactly what
  // it's given, so a bare { lastFreeDay } call here would silently null
  // out that vessel's mmsi (and vice versa).
  async function updateDate(v, newDate) {
    try { await upsertVessel({ name: v.name, lastFreeDay: newDate || null, mmsi: v.mmsi }); refresh() }
    catch (e) { setErr(e.message || String(e)) }
  }

  async function updateMmsi(v, newMmsi) {
    try { await upsertVessel({ name: v.name, lastFreeDay: v.last_free_day, mmsi: newMmsi || null }); refresh() }
    catch (e) { setErr(e.message || String(e)) }
  }

  async function remove(v) {
    if (!confirm(`Remove ${v.name}? Jobs riding this vessel will stop being covered by the free-time alert.`)) return
    try { await deleteVessel(v.id); refresh() }
    catch (e) { setErr(e.message || String(e)) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Vessels</h1>
        <p className="max-w-2xl text-sm text-muted">
          Set each vessel's last free day once here — the carrier/terminal rarely fills it in on the
          delivery order itself. Every open job whose vessel matches gets covered by a daily Telegram
          alert starting 2 days out, until its gate pass comes back. Type the vessel name and its MMSI
          looks itself up automatically — the ship's reported destination/ETA and live position (from
          the free AISStream feed) then show up below, refreshed every 30 minutes. The ETA is whatever
          the crew last entered on their end, not an official terminal berth time, so treat it as an
          estimate.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      <form onSubmit={addVessel} className={card + ' mb-6 flex flex-wrap items-end gap-3'}>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Vessel name</label>
          <input
            value={name}
            onChange={(e) => { setName(e.target.value); setLookupState('idle'); setCandidates([]) }}
            onBlur={lookupMmsiForName}
            placeholder="e.g. ADRIA ACE"
            className={input + ' w-48'}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Last free day</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">MMSI</label>
          <input
            value={mmsi}
            onChange={(e) => { setMmsi(e.target.value); setLookupState('idle'); setCandidates([]) }}
            placeholder={lookupState === 'loading' ? 'Looking up…' : 'e.g. 368207620'}
            className={input + ' w-36'}
          />
        </div>
        <button type="submit" disabled={saving || !name.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50">
          {saving ? 'Saving…' : '+ Add / update'}
        </button>
      </form>

      {lookupState === 'done' && mmsi && (
        <p className="-mt-4 mb-4 text-xs text-starboard">✓ MMSI {mmsi} found automatically for "{name}" — double-check it's the right ship before saving.</p>
      )}
      {lookupState === 'none' && (
        <p className="-mt-4 mb-4 text-xs text-muted">No MMSI match found for "{name}" — enter it by hand if you have it (often printed on the carrier's paperwork).</p>
      )}
      {lookupState === 'multiple' && (
        <div className={card + ' -mt-2 mb-4'}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Multiple ships named "{name}" — pick the right one:</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button
                key={c.mmsi}
                onClick={() => pickCandidate(c)}
                className="rounded-md border border-line bg-canvas px-3 py-2 text-left text-xs hover:border-accent"
              >
                <div className="font-semibold text-ink">{c.name}{c.flag ? ` (${c.flag})` : ''}</div>
                <div className="font-[family-name:var(--font-mono)] text-muted">MMSI {c.mmsi}{c.imo ? ` · IMO ${c.imo}` : ''}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {(() => {
        const mapUrl = vesselsMapUrl(vessels || [])
        if (!mapUrl) return null
        return (
          <div className={card + ' mb-6 overflow-hidden p-0'}>
            <img src={mapUrl} alt="Tracked vessel positions" className="block w-full" />
          </div>
        )
      })()}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !vessels?.length ? (
        <div className={card}><p className="text-sm text-muted">No vessels tracked yet — add one above.</p></div>
      ) : (
        <div className="space-y-2">
          {vessels.map((v) => {
            const d = daysLeft(v.last_free_day)
            const b = badge(d)
            const age = positionAge(v.position_updated_at)
            return (
              <div key={v.id} className={card + ' flex flex-wrap items-center justify-between gap-3'}>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-ink">{v.name}</span>
                    {b && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.text}</span>}
                  </div>
                  {v.mmsi && (
                    <>
                      {v.reported_eta ? (
                        <span className="text-sm font-medium text-ink">
                          🚢 {v.reported_destination ? `→ ${v.reported_destination} · ` : ''}ETA {formatEta(v.reported_eta)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">No ETA reported by the ship yet</span>
                      )}
                      <span className="text-xs text-muted">
                        {v.last_lat != null
                          ? `${v.last_lat.toFixed(3)}°, ${v.last_lon.toFixed(3)}° · ${v.last_speed_kn ?? '?'} kn · updated ${age}`
                          : 'No position yet — checked every 30 min'}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={v.mmsi || ''}
                    placeholder="MMSI"
                    onBlur={(e) => { if (e.target.value !== (v.mmsi || '')) updateMmsi(v, e.target.value) }}
                    className={input + ' w-28'}
                  />
                  <input
                    type="date"
                    defaultValue={v.last_free_day || ''}
                    onBlur={(e) => { if (e.target.value !== (v.last_free_day || '')) updateDate(v, e.target.value) }}
                    className={input}
                  />
                  <button onClick={() => remove(v)} className="rounded-md px-2 py-2 text-xs font-medium text-muted hover:text-port">Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
