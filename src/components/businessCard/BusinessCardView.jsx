import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { downloadVCard, paymentPayUrl, paymentTypeLabel } from '../../lib/businessCard'

const telHref = (n) => `tel:${String(n || '').replace(/[^\d+]/g, '')}`
const smsHref = (n) => `sms:${String(n || '').replace(/[^\d+]/g, '')}`
const mailHref = (e) => `mailto:${String(e || '').trim()}`

// Renders the actual card. Used both by the public /card/:slug page and by
// the admin builder's live preview -- same component, so what a tenant
// sees while editing is exactly what a visitor gets. `mode` only changes
// two things: the "DIGITAL CARD" preview pill, and whether the contact-
// exchange form actually submits anywhere (there's nowhere to submit to
// for an unsaved/unpublished card being edited).
export default function BusinessCardView({ card, mode = 'public', onSubmitLead }) {
  const [toast, setToast] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [leadOpen, setLeadOpen] = useState(false)

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(''), 2200) }

  const publicUrl = card.slug ? `${window.location.origin}/card/${card.slug}` : ''
  // The QR image itself carries ?src=qr so a scan is attributable -- a
  // normal link visit and a QR scan land on the exact same page otherwise.
  const qrTargetUrl = card.slug ? `${publicUrl}?src=qr` : ''

  // Only real visitor actions count -- never the admin builder's own preview.
  const logEvent = (kind) => {
    if (mode !== 'public' || !card.slug) return
    fetch('/.netlify/functions/public-business-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'log_event', slug: card.slug, kind }),
    }).catch(() => {})
  }

  useEffect(() => {
    if (!qrTargetUrl) { setQrDataUrl(''); return }
    let cancelled = false
    QRCode.toDataURL(qrTargetUrl, { margin: 1, width: 240, color: { dark: '#0c1a24', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [qrTargetUrl])

  const theme = {
    '--cb-bg': card.primary_bg || '#0c1a24',
    '--cb-panel': card.panel_bg || '#152633',
    '--cb-accent': card.accent_color || '#22d3ee',
    '--cb-cta': card.cta_color || '#e8a317',
  }

  const copyText = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); flash(msg) }
    catch { flash('Could not copy — long-press to copy manually.') }
  }

  const tapPay = (method) => {
    if (method.action !== 'pay') {
      copyText(method.handle, `${paymentTypeLabel(method.type)} handle copied.`)
      return
    }
    const url = paymentPayUrl(method)
    if (!url) { copyText(method.handle, `${paymentTypeLabel(method.type)} handle copied.`); return }

    if (method.type === 'venmo') {
      // App-scheme link with no automatic web fallback. Try the app; if the
      // tab is still visible after a beat (nothing intercepted it), the app
      // isn't installed, so fall back to the web profile.
      const fallback = paymentPayUrl({ ...method, type: 'venmo_web_fallback' })
      const timer = setTimeout(() => { window.location.href = fallback }, 1200)
      window.addEventListener('pagehide', () => clearTimeout(timer), { once: true })
      window.location.href = url
      return
    }
    window.location.href = url
  }

  const share = async () => {
    const shareData = { title: card.full_name || card.brand_name || 'Digital card', url: publicUrl }
    if (navigator.share) {
      try {
        await navigator.share(shareData)
        logEvent('share')
      } catch (err) {
        // AbortError just means the person closed the share sheet without
        // picking anything -- normal, and shouldn't silently dump a "Link
        // copied" toast on them. Any other failure still gets the fallback.
        if (err?.name !== 'AbortError') copyText(publicUrl, 'Link copied.')
      }
      return
    }
    copyText(publicUrl, 'Link copied.')
    logEvent('share')
  }

  return (
    <div style={theme} className="mx-auto w-full max-w-md">
      <style>{`
        .cb-root, .cb-root * { box-sizing: border-box; }
      `}</style>
      <div className="cb-root flex flex-col gap-5 rounded-2xl p-5" style={{ background: 'var(--cb-bg)' }}>
        {/* 1. Header strip */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg leading-none">{card.brand_icon || '⚓'}</span>
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
              {card.brand_name || 'Business Card'}
            </span>
          </div>
          {mode === 'preview' && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ borderColor: 'var(--cb-accent)', color: 'var(--cb-accent)' }}>
              Digital Card
            </span>
          )}
        </div>

        {/* 2-5. Logo, name, title, address */}
        <div className="flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 text-4xl"
            style={{ borderColor: 'var(--cb-accent)', background: 'var(--cb-panel)' }}
          >
            {card.brand_logo_url
              ? <img src={card.brand_logo_url} alt="" className="h-full w-full object-cover" />
              : <span>{card.brand_icon || '⚓'}</span>}
          </div>
          <h1 className="text-2xl font-bold text-white">{card.full_name || 'Your Name'}</h1>
          {(card.title || card.company_line) && (
            <p className="mt-1 text-sm text-white/60">
              {[card.title, card.company_line].filter(Boolean).join(' · ')}
            </p>
          )}
          {(card.address_line1 || card.address_line2) && (
            <p className="mt-2 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wide text-white/40">
              {[card.address_line1, card.address_line2].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* 6. Credential badge */}
          {card.credential_badge_enabled && card.credential_badge_text && (
            <div
              className="mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold"
              style={{ borderColor: 'var(--cb-accent)', color: 'var(--cb-accent)' }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--cb-accent)' }} />
              {card.credential_badge_text}
            </div>
          )}
        </div>

        {/* 7. Call / Text / Email */}
        {(card.phone || card.sms_number || card.email) && (
          <div className="grid grid-cols-3 gap-2">
            {card.phone && (
              <a href={telHref(card.phone)} className="rounded-xl border border-white/10 py-3 text-center text-xs font-semibold text-white/80 hover:border-white/30">
                📞<div className="mt-1">Call</div>
              </a>
            )}
            {card.sms_number && (
              <a href={smsHref(card.sms_number)} className="rounded-xl border border-white/10 py-3 text-center text-xs font-semibold text-white/80 hover:border-white/30">
                💬<div className="mt-1">Text</div>
              </a>
            )}
            {card.email && (
              <a href={mailHref(card.email)} className="rounded-xl border border-white/10 py-3 text-center text-xs font-semibold text-white/80 hover:border-white/30">
                ✉️<div className="mt-1">Email</div>
              </a>
            )}
          </div>
        )}

        {/* 8. Primary CTA */}
        <button
          onClick={() => { downloadVCard(card); logEvent('download') }}
          className="w-full rounded-xl py-3.5 text-sm font-bold"
          style={{ background: 'var(--cb-cta)', color: '#1a1a1a' }}
        >
          {card.primary_cta_label || 'Save to Contacts'}
        </button>

        {/* 9. Secondary CTA */}
        {card.secondary_cta_label && card.secondary_cta_url && (
          <a
            href={card.secondary_cta_url}
            target="_blank" rel="noreferrer"
            className="block w-full rounded-xl py-3.5 text-center text-sm font-bold"
            style={{ background: 'var(--cb-accent)', color: '#0c1a24' }}
          >
            {card.secondary_cta_label}
          </a>
        )}

        {/* 10. Tools & documents */}
        {Array.isArray(card.tools_list) && card.tools_list.length > 0 && (
          <Section label={card.tools_section_label || 'Documents & Tools'}>
            {card.tools_list.map((t, i) => (
              <a
                key={i} href={t.url || '#'} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 rounded-xl px-3 py-3 hover:brightness-110"
                style={{ background: 'var(--cb-panel)' }}
              >
                <span className="text-lg">{t.icon || '📄'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{t.label}</span>
                  {t.sublabel && <span className="block truncate text-xs text-white/50">{t.sublabel}</span>}
                </span>
                <span className="text-white/40">›</span>
              </a>
            ))}
          </Section>
        )}

        {/* 11. Locations */}
        {Array.isArray(card.locations_list) && card.locations_list.length > 0 && (
          <Section label={card.locations_section_label || 'Locations'}>
            {card.locations_list.map((l, i) => (
              <a
                key={i} href={l.maps_url || '#'} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 rounded-xl px-3 py-3 hover:brightness-110"
                style={{ background: 'var(--cb-panel)' }}
              >
                <span className="text-lg">📍</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{l.name}</span>
                  {(l.subtitle || l.address) && (
                    <span className="block truncate text-xs text-white/50">{[l.subtitle, l.address].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                <span className="text-white/40">›</span>
              </a>
            ))}
          </Section>
        )}

        {/* 12. Payments */}
        {Array.isArray(card.payment_methods) && card.payment_methods.length > 0 && (
          <Section label="Payments">
            <div className="grid grid-cols-2 gap-2">
              {card.payment_methods.map((m, i) => (
                <button
                  key={i} onClick={() => tapPay(m)}
                  className="rounded-xl px-3 py-3 text-left hover:brightness-110"
                  style={{ background: 'var(--cb-panel)' }}
                >
                  <span className="block text-sm font-semibold text-white">{paymentTypeLabel(m.type)}</span>
                  <span className="block truncate text-xs text-white/50">{m.handle}</span>
                  <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--cb-accent)' }}>
                    {m.action === 'pay' ? 'Tap to pay' : 'Tap to copy'}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* 13. Send info / lead exchange */}
        <div>
          {!leadOpen ? (
            <button
              onClick={() => setLeadOpen(true)}
              className="w-full rounded-xl border py-3 text-center text-sm font-semibold"
              style={{ borderColor: 'var(--cb-accent)', color: 'var(--cb-accent)' }}
            >
              {card.share_prompt_text || 'Send your info'}
            </button>
          ) : (
            <LeadForm
              collectTransportDetails={card.collect_transport_details}
              onCancel={() => setLeadOpen(false)}
              onSubmit={async (form) => {
                if (mode !== 'public' || !onSubmitLead) { flash('Preview only — publish the card to enable this.'); setLeadOpen(false); return }
                try { await onSubmitLead(form); flash('Sent — thanks!'); setLeadOpen(false) }
                catch (e) { flash(e.message || 'Could not send — try again.') }
              }}
            />
          )}
        </div>

        {/* 14. QR code */}
        {qrDataUrl && (
          <div className="flex flex-col items-center gap-2 rounded-xl p-4" style={{ background: 'var(--cb-panel)' }}>
            <img src={qrDataUrl} alt="QR code" className="h-32 w-32 rounded-lg bg-white p-1" />
            <div className="text-center text-[11px] font-bold uppercase tracking-wide text-white/70">
              Scan to save
              <div className="mt-0.5 font-normal normal-case text-white/40">Point a camera here → add my contact</div>
            </div>
          </div>
        )}

        {/* 15. Share */}
        <button
          onClick={share}
          className="w-full rounded-xl border border-white/15 py-3 text-center text-sm font-semibold text-white/80 hover:border-white/30"
        >
          Share {card.full_name ? card.full_name.split(/\s+/)[0] : 'this card'} with someone
        </button>

        {/* 16. Footer */}
        <div className="border-t border-white/10 pt-4 text-center text-[11px] text-white/40">
          {card.locations_list?.length > 0 && (
            <div>{card.locations_list.map((l) => l.name).filter(Boolean).join(' · ')}</div>
          )}
          {card.hours_line && <div className="mt-1">{card.hours_line}</div>}
          {card.footer_tagline && <div className="mt-2 italic">{card.footer_tagline}</div>}
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2 text-sm font-semibold shadow-lg"
          style={{ background: 'var(--cb-panel)', borderColor: 'var(--cb-accent)', color: 'var(--cb-accent)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}

function Section({ label, children }) {
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-white/40">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

// collectTransportDetails is per-card (business_cards.collect_transport_details)
// -- off by default, so every existing card keeps its plain "send your info"
// exchange. Ship2Shore's card is the first to turn it on: with it on, a
// pickup/dropoff/vehicle filled in here makes public-business-card.js also
// drop a pipeline card, same as a landing-page lead does, instead of just
// logging a contact with nowhere for staff to work it from.
function LeadForm({ onSubmit, onCancel, collectTransportDetails }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', pickup_address: '', dropoff_address: '', vehicle: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fieldClass = 'w-full rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/30'

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim() || (!form.phone.trim() && !form.email.trim())) return
    setBusy(true)
    await onSubmit(form)
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl p-3" style={{ background: 'var(--cb-panel)' }}>
      <input required placeholder="Your name" value={form.name} onChange={set('name')} className={fieldClass} />
      <input placeholder="Phone" value={form.phone} onChange={set('phone')} className={fieldClass} />
      <input placeholder="Email" type="email" value={form.email} onChange={set('email')} className={fieldClass} />
      {collectTransportDetails && (
        <>
          <input placeholder="Pickup location" value={form.pickup_address} onChange={set('pickup_address')} className={fieldClass} />
          <input placeholder="Drop-off location" value={form.dropoff_address} onChange={set('dropoff_address')} className={fieldClass} />
          <input placeholder="Vehicle (year / make / model)" value={form.vehicle} onChange={set('vehicle')} className={fieldClass} />
        </>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg py-2 text-xs font-semibold text-white/50">Cancel</button>
        <button type="submit" disabled={busy} className="flex-1 rounded-lg py-2 text-xs font-bold" style={{ background: 'var(--cb-cta)', color: '#1a1a1a' }}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}
