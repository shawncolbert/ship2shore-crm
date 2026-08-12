import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyExternalCards, createExternalCard, updateExternalCard, deleteExternalCard, setExternalCardActive } from '../lib/externalCards'
import { createDriverCard } from '../lib/driverOnboarding'
import { fetchMyOrgId, fetchServices } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'
const help = 'mt-1 text-xs text-muted'

// Click-tracking for digital business cards you already built and host
// elsewhere -- NOT the in-app card builder (that's Settings -> Business
// Card). Each row here is just a name + the real URL; the trackable /go/
// link counts a click, then bounces straight there.
// null | 'choose' | 'driver' | 'external'
export default function ExternalCardLinks() {
  const qc = useQueryClient()
  const { data: cards, isLoading } = useQuery({ queryKey: ['externalCards'], queryFn: fetchMyExternalCards })
  const { data: orgId } = useQuery({ queryKey: ['myOrgId'], queryFn: fetchMyOrgId })
  const [mode, setMode] = useState(null)
  const [justCreated, setJustCreated] = useState(null)

  const totalClicks = (cards || []).reduce((sum, c) => sum + (c.click_count || 0), 0)
  const close = () => { setMode(null); setJustCreated(null) }
  const refresh = () => qc.invalidateQueries({ queryKey: ['externalCards'] })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Digital Business Cards</h1>
          <p className="max-w-xl text-sm text-muted">
            Set up a new driver's card entirely here — Call/Text/Email, a Book Now link that routes leads to
            them automatically, and an on/off switch if you ever need to cut them off.
          </p>
        </div>
        <button onClick={() => setMode('choose')} className={btnAccent}>+ Add a card</button>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted">{cards?.length || 0} card{cards?.length === 1 ? '' : 's'} on file · {totalClicks} click{totalClicks === 1 ? '' : 's'} total</p>

          {mode === 'choose' && (
            <div className={`${card} mb-4`}>
              <h2 className="mb-1 text-sm font-semibold text-ink">What are you setting up?</h2>
              <p className="mb-4 text-xs text-muted">Pick one — you can always add the other kind later.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button onClick={() => setMode('driver')} className="rounded-xl border-2 border-accent bg-canvas p-4 text-left hover:bg-accent/5">
                  <div className="text-sm font-bold text-ink">Set up a new card here (recommended)</div>
                  <p className="mt-1 text-xs text-muted">
                    I build the whole card for you — contact buttons, a Book Now link that routes leads to
                    the right person, and a real on/off switch you fully control.
                  </p>
                </button>
                <button onClick={() => setMode('external')} className="rounded-xl border border-line bg-canvas p-4 text-left hover:bg-canvas/70">
                  <div className="text-sm font-bold text-ink">Just track clicks on a card I already built</div>
                  <p className="mt-1 text-xs text-muted">
                    For a card hosted somewhere else entirely (e.g. Netlify). This only counts clicks — no
                    booking routing, and the on/off switch can't reach it.
                  </p>
                </button>
              </div>
              <button onClick={close} className="mt-3 text-xs font-medium text-muted hover:text-ink">Cancel</button>
            </div>
          )}

          {mode === 'driver' && !justCreated && (
            <NewDriverCardForm
              orgId={orgId}
              onClose={close}
              onCreated={(result) => { setJustCreated(result); refresh() }}
            />
          )}

          {justCreated && (
            <DriverCardCreatedSummary result={justCreated} onDone={close} />
          )}

          {mode === 'external' && (
            <NewCardForm
              onClose={close}
              onSave={async (form) => {
                await createExternalCard({ orgId, ...form })
                refresh()
                close()
              }}
            />
          )}

          <div className="space-y-3">
            {cards?.length === 0 && !mode && (
              <p className="text-sm text-muted">No cards yet. Add one to get started.</p>
            )}
            {cards?.map((c) => (
              <CardRow
                key={c.id}
                c={c}
                onUpdated={refresh}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function CardRow({ c, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [copyFlag, setCopyFlag] = useState(false)
  const [toggling, setToggling] = useState(false)
  const trackedUrl = `${window.location.origin}/go/${c.slug}`
  const active = c.active !== false

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(trackedUrl); setCopyFlag(true); setTimeout(() => setCopyFlag(false), 1800) }
    catch { /* noop */ }
  }

  const remove = async () => {
    if (!confirm(`Remove ${c.name}? This only removes the tracking link — it does not touch the actual card.`)) return
    await deleteExternalCard(c.id)
    onUpdated()
  }

  const toggleActive = async () => {
    if (active) {
      const warning = c.business_card_id
        ? `Turn off ${c.name}'s card? Their whole card stops working -- booking link, tracked link, and every button (Call/Text/Email/Save/Share) on their card page -- until you turn it back on.`
        : `Turn off ${c.name}'s card? This stops their booking link and tracked /go/ link -- but this card has no matching in-app card, so I have no way to disable Call/Text/Email/Save/Share on the actual external site. Those will keep working regardless.`
      if (!confirm(warning)) return
    }
    setToggling(true)
    try { await setExternalCardActive(c, !active); onUpdated() }
    finally { setToggling(false) }
  }

  if (editing) {
    return (
      <NewCardForm
        initial={c}
        onClose={() => setEditing(false)}
        onSave={async (form) => { await updateExternalCard(c.id, form); onUpdated(); setEditing(false) }}
      />
    )
  }

  return (
    <div className={`${card} flex flex-wrap items-center justify-between gap-3 ${active ? '' : 'opacity-60'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{c.name}</span>
          {!active && (
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-port">Off</span>
          )}
          {!c.business_card_id && (
            <span title="No in-app card linked -- Call/Text/Email/Save/Share on the external site can't be switched off from here"
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
              External only
            </span>
          )}
        </div>
        <a href={c.target_url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted hover:underline">
          {c.target_url}
        </a>
        <div className="mt-1 flex items-center gap-2 text-xs">
          <span className="font-[family-name:var(--font-mono)] text-muted">{trackedUrl}</span>
          <button onClick={copyLink} className="font-semibold text-accent hover:underline">
            {copyFlag ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-center">
          <div className="text-xl font-bold text-ink">{c.click_count ?? 0}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Clicks</div>
        </div>
        <button
          onClick={toggleActive}
          disabled={toggling}
          title={active ? "Turn off this card's booking link and click redirect" : 'Turn this card back on'}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${active ? 'bg-starboard' : 'bg-line'}`}
        >
          <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${active ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
        <button onClick={() => setEditing(true)} className={btn}>Edit</button>
        <button onClick={remove} className="rounded-lg p-2 text-muted hover:bg-red-50 hover:text-red-500">🗑️</button>
      </div>
    </div>
  )
}

function NewDriverCardForm({ orgId, onClose, onCreated }) {
  const { data: services, isLoading: loadingServices } = useQuery({ queryKey: ['services'], queryFn: fetchServices })
  const [fullName, setFullName] = useState('')
  const [title, setTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [serviceCodes, setServiceCodes] = useState([])
  const [roundTheClock, setRoundTheClock] = useState(false)
  const [bookingLabel, setBookingLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const toggleService = (code) => {
    setServiceCodes((codes) => (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]))
  }

  const save = async () => {
    if (!fullName.trim()) { setErr('Name is required.'); return }
    if (!phone.trim() && !email.trim()) { setErr("Enter at least a phone or email — that's how leads reach them."); return }
    setSaving(true); setErr('')
    try {
      const result = await createDriverCard(orgId, {
        fullName: fullName.trim(), title: title.trim() || null, phone: phone.trim() || null, email: email.trim() || null,
        serviceCodes, roundTheClock, bookingLabel: bookingLabel.trim() || null,
      })
      onCreated(result)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} mb-4 space-y-4`}>
      <div>
        <h2 className="text-sm font-semibold text-ink">Set up a new card</h2>
        <p className="text-xs text-muted">Fill this in once — the card, contact buttons, booking link, and lead routing all get created together.</p>
      </div>
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-port">⚠️ {err}</p>}

      <div>
        <label className={label}>Name or business name</label>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={input} placeholder="e.g. Tilly's Classics" />
        <p className={help}>Shows as the big name on their card and in your Digital Business Cards list.</p>
      </div>

      <div>
        <label className={label}>Title / role (optional)</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} placeholder="e.g. Vehicle Dispatch" />
        <p className={help}>A short line under their name on the card, like a job title.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={input} placeholder="(555) 555-5555" />
          <p className={help}>Their Call/Text buttons, and the number shown to customers if they need to call to confirm a booking.</p>
        </div>
        <div>
          <label className={label}>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} className={input} placeholder="name@email.com" />
          <p className={help}>Where "you've got a new lead" alerts go the moment someone books through their card.</p>
        </div>
      </div>

      <div>
        <label className={label}>Services they're allowed to offer</label>
        {loadingServices ? (
          <p className="text-xs text-muted">Loading your service list…</p>
        ) : !services?.length ? (
          <p className="text-xs text-muted">You haven't added any services yet (Settings → Services). Leave this blank to allow everything for now.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {services.map((s) => (
              <button
                key={s.code} type="button" onClick={() => toggleService(s.code)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  serviceCodes.includes(s.code) ? 'border-accent bg-accent text-ink' : 'border-line bg-canvas text-ink hover:bg-canvas/70'
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <p className={help}>Leave none selected to let their card offer every service you sell. Customers never see prices on this kind of card.</p>
      </div>

      <div>
        <label className={label}>Booking page header (optional)</label>
        <input value={bookingLabel} onChange={(e) => setBookingLabel(e.target.value)} className={input} placeholder={fullName ? `e.g. ${fullName} Dispatch` : 'e.g. Tilly\'s Dispatch'} />
        <p className={help}>What shows at the top of the booking page when a customer clicks their Book Now button (e.g. "Book with ___"). Defaults to their name if left blank.</p>
      </div>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={roundTheClock} onChange={(e) => setRoundTheClock(e.target.checked)} className="h-4 w-4 rounded border-line" />
        Available 24/7 (unchecked = standard Mon–Fri business hours)
      </label>

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Cancel</button>
        <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Creating…' : 'Create card'}</button>
      </div>
    </div>
  )
}

function DriverCardCreatedSummary({ result, onDone }) {
  const { card: bizCard, link } = result
  const cardUrl = `${window.location.origin}/card/${bizCard.slug}`
  const [copyFlag, setCopyFlag] = useState('')

  const copy = async (text, which) => {
    try { await navigator.clipboard.writeText(text); setCopyFlag(which); setTimeout(() => setCopyFlag(''), 1800) }
    catch { /* noop */ }
  }

  return (
    <div className={`${card} mb-4 space-y-4 border-2 border-starboard`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">✅</span>
        <h2 className="text-sm font-bold text-ink">{bizCard.full_name}'s card is live</h2>
      </div>
      <p className="text-sm text-muted">
        This is the one link to actually give them — it's their whole card. It already includes their
        Book Now button, so you don't need to send anything else.
      </p>
      <div>
        <label className={label}>Their card link</label>
        <div className="flex items-center gap-2">
          <input readOnly value={cardUrl} className={`${input} font-[family-name:var(--font-mono)] text-xs`} />
          <button onClick={() => copy(cardUrl, 'card')} className={btn}>{copyFlag === 'card' ? '✓ Copied' : 'Copy'}</button>
        </div>
        <p className={help}>Text or email them this. It works on any phone — no app needed.</p>
      </div>
      <p className="text-xs text-muted">
        You can edit anything about this card later in Settings → Business Card Builder, and switch it on/off
        anytime right below in this list.
      </p>
      <div className="flex justify-end border-t border-line pt-3">
        <button onClick={onDone} className={btnAccent}>Done</button>
      </div>
    </div>
  )
}

function NewCardForm({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '')
  const [targetUrl, setTargetUrl] = useState(initial?.target_url || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const save = async () => {
    if (!name.trim()) { setErr('Name is required'); return }
    if (!/^https?:\/\//i.test(targetUrl.trim())) { setErr('Enter the full URL, including https://'); return }
    setSaving(true); setErr('')
    try {
      await onSave({ name: name.trim(), target_url: targetUrl.trim() })
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} mb-4 space-y-3`}>
      <h2 className="text-sm font-semibold text-ink">{initial ? 'Edit card' : 'Add a card'}</h2>
      {err && <p className="text-xs text-port">{err}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Name (whose card is this)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="Tilly's Classics" />
        </label>
        <label className="block">
          <span className={label}>Real card URL</span>
          <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} className={input} placeholder="https://tillysclassics.netlify.app" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:bg-canvas hover:text-ink">Cancel</button>
        <button onClick={save} disabled={saving} className={btnAccent}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
