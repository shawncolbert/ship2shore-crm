import { useCallback, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import LandingBlockView, { Prose } from '../components/LandingBlockView'
import { getPublicTheme, accentTint, PUBLIC_INK } from '../lib/publicThemes'
import { useGtag } from '../lib/gtag'

async function callLandingPageApi(payload) {
  const res = await fetch('/.netlify/functions/public-landing-page', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export default function LandingPagePublic() {
  const { slug } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['landingPagePublic', slug],
    queryFn: () => callLandingPageApi({ action: 'get', slug }),
    retry: false,
  })

  useGtag(data?.ga4MeasurementId)

  const formRef = useRef(null)
  const [leadOpen, setLeadOpen] = useState(false)

  const openLead = useCallback(() => {
    setLeadOpen(true)
    // Let the form mount before scrolling to it, or we scroll to the button's
    // old position and the visitor lands above the fields.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }, [])
  const closeLead = useCallback(() => setLeadOpen(false), [])

  const bookingHref = data?.bookingOrgSlug ? `/book/${data.bookingOrgSlug}` : '/book'

  const handleCta = useCallback((target) => {
    if (target === 'booking') { window.location.href = bookingHref; return }
    openLead()
  }, [openLead, bookingHref])

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#f3f4f6] text-sm text-gray-500">Loading…</div>
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#f3f4f6] px-6 text-center">
        <h1 className="text-xl font-bold text-gray-900">Page not found</h1>
        <p className="text-sm text-gray-500">This page doesn't exist or isn't published yet.</p>
      </div>
    )
  }

  const blocks = data.blocks || []
  const { accent, accentText } = getPublicTheme(data.theme)
  // The lead form is a single instance anchored at the last CTA. A hero button
  // near the top and a closing button further down are the same request, so
  // both open the one form and scroll it into view rather than sprouting a
  // second copy the visitor has to notice.
  const leadIndex = blocks.reduce((last, b, i) => (b.type === 'cta' && b.target !== 'booking' ? i : last), -1)

  return (
    <div className="min-h-screen bg-white">
      <title>{data.title}</title>
      {blocks.map((block, i) => (
        <div key={block.id || i}>
          {block.type === 'cta'
            ? (i === leadIndex
                ? <LeadAnchor block={block} slug={slug} bookingHref={bookingHref} formRef={formRef} open={leadOpen} onOpen={openLead} onClose={closeLead} accent={accent} accentText={accentText} />
                : <LandingBlockView block={block} onCta={handleCta} theme={data.theme} slug={slug} />)
            : <LandingBlockView block={block} onCta={handleCta} theme={data.theme} slug={slug} />}
        </div>
      ))}
    </div>
  )
}

// The one CTA that actually hosts the form. Others just scroll here.
function LeadAnchor({ block, slug, bookingHref, formRef, open, onOpen, onClose, accent, accentText }) {
  if (block.target === 'booking') {
    return (
      <Prose>
        <a href={bookingHref}
          style={{ background: accent, color: accentText }}
          className="mb-4 mt-2 inline-block rounded-xl px-8 py-4 text-center text-base font-bold hover:brightness-95">
          {block.label || 'Book Now'}
        </a>
      </Prose>
    )
  }
  return (
    <Prose>
      <div ref={formRef} className="mb-4 mt-2 scroll-mt-8">
        {!open ? (
          <button onClick={onOpen}
            style={{ background: accent, color: accentText }}
            className="rounded-xl px-8 py-4 text-base font-bold shadow-sm hover:brightness-95">
            {block.label || 'Contact us'}
          </button>
        ) : (
          <LeadForm slug={slug} accent={accent} accentText={accentText} onCancel={onClose} />
        )}
      </div>
    </Prose>
  )
}

// Same dark-panel language as the digital business card's lead form
// (transparent, white-bordered inputs on a navy panel) so a visitor who's
// seen both feels the same product -- themed with this page's own accent
// color instead of the card's fixed teal, and with a cancel affordance
// since this form pops open over page content rather than living in a
// scrollable card body.
function LeadForm({ slug, accent, accentText, onCancel }) {
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', notes: '' })
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.full_name.trim() || !form.email.trim()) { setErr('Name and email are required.'); return }
    setSending(true); setErr('')
    try {
      await callLandingPageApi({ action: 'submit_lead', slug, ...form })
      setDone(true)
    } catch (e2) {
      setErr(e2.message || 'Something went wrong. Please try again.')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border-2 p-6 text-center" style={{ borderColor: accent, background: accentTint(accent) }}>
        <p className="font-semibold text-gray-900">Thanks — we'll be in touch shortly.</p>
      </div>
    )
  }

  const focusStyle = { '--tw-ring-color': accent }
  const inputClass = 'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-white/30 focus:ring-2'

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl p-5" style={{ background: PUBLIC_INK }}>
      {err && <p className="text-sm font-medium text-red-400">{err}</p>}
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/40">Name</label>
        <input className={inputClass} style={focusStyle} placeholder="Your name"
          value={form.full_name} onChange={(e) => set('full_name', e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/40">Email</label>
        <input type="email" className={inputClass} style={focusStyle} placeholder="you@example.com"
          value={form.email} onChange={(e) => set('email', e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/40">Phone (optional)</label>
        <input className={inputClass} style={focusStyle} placeholder="Phone"
          value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/40">Message (optional)</label>
        <textarea rows={3} className={inputClass} style={focusStyle} placeholder="Anything we should know?"
          value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div className="flex gap-2 pt-1">
        {onCancel && (
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg py-2.5 text-xs font-semibold text-white/50 hover:text-white/70">
            Cancel
          </button>
        )}
        <button type="submit" disabled={sending}
          style={{ background: accent, color: accentText }}
          className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold hover:brightness-95 disabled:opacity-50">
          {sending ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
