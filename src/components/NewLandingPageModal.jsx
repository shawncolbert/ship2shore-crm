import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LANDING_TEMPLATES, applyTemplate } from '../lib/landingTemplates'
import { createLandingPage } from '../lib/supabase'

const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted'
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'

// Apostrophes are dropped rather than turned into a separator, so
// "Sparky's Arc Welding" reads as sparkys-arc-welding, not sparky-s-arc-welding.
const slugify = (s) =>
  String(s || '').trim().toLowerCase()
    .replace(/['‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

// Two lines of the template's own copy, so the card shows what you're actually
// picking. Raw {{tokens}} would leak into the preview, so they read as the
// thing they'll become once the details form is filled in.
const PREVIEW_TOKENS = { business: 'Your business', city: 'your area', phone: 'your phone', email: 'your email' }
const humanize = (text) =>
  text.replace(/\{\{(\w+)\}\}/g, (m, k) => PREVIEW_TOKENS[k] ?? m)

function previewLines(template) {
  const hero = template.blocks.find((b) => b.type === 'hero')
  if (hero) return [hero.eyebrow, hero.subheading].filter(Boolean).map(humanize)
  return template.blocks
    .filter((b) => (b.type === 'heading' || b.type === 'paragraph') && b.text)
    .slice(0, 2)
    .map((b) => humanize(b.text.split('\n')[0]))
}

// The card shows the template's real hero photograph, so you're picking a look
// rather than a name.
function previewImage(template) {
  return template.blocks.find((b) => b.type === 'hero')?.image || ''
}

export default function NewLandingPageModal({ onClose, onCreated }) {
  const navigate = useNavigate()
  const [template, setTemplate] = useState(null)   // null = still choosing
  const [details, setDetails] = useState({ business: '', phone: '', city: '', email: '' })
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const choose = (t) => {
    setTemplate(t)
    setErr('')
    if (t) {
      const guess = t.name
      setTitle(guess)
      if (!slugTouched) setSlug(slugify(guess))
    } else {
      setTitle('Untitled page')
      if (!slugTouched) setSlug('')
    }
  }

  const setDetail = (key, value) => {
    setDetails((d) => ({ ...d, [key]: value }))
    // The business name is the natural page title -- keep them in sync until
    // the user overrides either one by hand.
    if (key === 'business' && template) {
      const next = value.trim() || template.name
      setTitle(next)
      if (!slugTouched) setSlug(slugify(next))
    }
  }

  const onTitleChange = (v) => {
    setTitle(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  const create = async () => {
    const base = slugify(slug) || slugify(title) || 'page'
    if (!title.trim()) { setErr('Give the page a title.'); return }
    setSaving(true); setErr('')
    const blocks = template ? applyTemplate(template, details) : []
    // Slugs are unique per org. Rather than bounce the user back with "taken",
    // walk to the next free suffix -- they can still rename it in the editor.
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`
      try {
        const created = await createLandingPage({ slug: candidate, title: title.trim(), published: false, blocks })
        onCreated?.()
        navigate(`/landing-pages/${created.id}`)
        return
      } catch (e) {
        const taken = /already taken/i.test(e.message || '')
        if (!taken) { setErr(e.message || String(e)); setSaving(false); return }
      }
    }
    setErr('Could not find a free URL for that name — try a different title.')
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8">
      <div className="w-full max-w-4xl rounded-2xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">
              {template === null ? 'Pick a template' : `Set up: ${template ? template.name : 'Blank page'}`}
            </h2>
            <p className="text-xs text-muted">
              {template === null
                ? 'Every template comes with the copy already written — you just drop in the customer\'s details.'
                : 'Fill these in and they get written straight into the page. You can edit anything afterwards.'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-xl leading-none text-muted hover:bg-canvas" aria-label="Close">×</button>
        </div>

        {err && <p className="mx-5 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

        {template === null ? (
          <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {LANDING_TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => choose(t)}
                className="group flex flex-col overflow-hidden rounded-xl border border-line bg-canvas text-left transition hover:border-accent hover:bg-surface hover:shadow-md"
              >
                <span className="relative block h-28 w-full overflow-hidden bg-ink">
                  {previewImage(t) && (
                    <img src={previewImage(t)} alt="" aria-hidden="true"
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                      className="h-full w-full object-cover opacity-70 transition group-hover:opacity-90" />
                  )}
                  <span className="absolute bottom-2 left-3 text-2xl drop-shadow" aria-hidden="true">{t.accent}</span>
                </span>
                <span className="flex flex-1 flex-col p-4">
                  <span className="font-semibold text-ink group-hover:text-accent">{t.name}</span>
                  <span className="text-xs text-muted">{t.tagline}</span>
                  <span className="mt-3 space-y-1 border-t border-line pt-3 text-[11px] leading-snug text-muted">
                    {previewLines(t).map((line, i) => (
                      <span key={i} className="line-clamp-2 block">{line}</span>
                    ))}
                  </span>
                </span>
              </button>
            ))}
            <button
              onClick={() => choose(false)}
              className="group flex min-h-[12rem] flex-col items-center justify-center rounded-xl border-2 border-dashed border-line p-4 text-center transition hover:border-accent"
            >
              <span className="text-2xl" aria-hidden="true">➕</span>
              <span className="mt-2 font-semibold text-ink group-hover:text-accent">Blank page</span>
              <span className="text-xs text-muted">Start empty and build it block by block</span>
            </button>
          </div>
        ) : (
          <div className="p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {template && (
                <>
                  <div>
                    <label className={label}>Business name</label>
                    <input className={input} value={details.business} autoFocus
                      onChange={(e) => setDetail('business', e.target.value)} placeholder="Sparky's Arc Welding" />
                  </div>
                  <div>
                    <label className={label}>Phone</label>
                    <input className={input} value={details.phone} inputMode="tel"
                      onChange={(e) => setDetail('phone', e.target.value)} placeholder="(910) 555-0142" />
                  </div>
                  <div>
                    <label className={label}>City / service area</label>
                    <input className={input} value={details.city}
                      onChange={(e) => setDetail('city', e.target.value)} placeholder="Wilmington, NC" />
                  </div>
                  <div>
                    <label className={label}>Email</label>
                    <input className={input} value={details.email} inputMode="email"
                      onChange={(e) => setDetail('email', e.target.value)} placeholder="hello@example.com" />
                  </div>
                </>
              )}
              <div>
                <label className={label}>Page title</label>
                <input className={input} value={title} autoFocus={!template}
                  onChange={(e) => onTitleChange(e.target.value)} placeholder="Untitled page" />
              </div>
              <div>
                <label className={label}>Public URL</label>
                <div className="flex items-center gap-1 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
                  <span className="shrink-0 text-muted">/pages/</span>
                  <input className="w-full bg-transparent text-ink outline-none" value={slug}
                    onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }} placeholder="page" />
                </div>
              </div>
            </div>

            {template && (
              <p className="mt-4 text-xs text-muted">
                Anything left blank shows up as a bracketed prompt like <code>[YOUR PHONE]</code> in the page,
                so it's obvious what still needs filling in before you publish.
              </p>
            )}

            <div className="mt-5 flex items-center justify-between gap-2">
              <button className={btn} onClick={() => { setTemplate(null); setErr('') }}>← Back to templates</button>
              <button className={btnAccent} disabled={saving} onClick={create}>
                {saving ? 'Creating…' : 'Create page'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
