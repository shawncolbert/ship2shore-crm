import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import {
  fetchMyBusinessCards, createBusinessCard, deleteBusinessCard, saveBusinessCard, slugify, suggestSlugs, PAYMENT_TYPES,
} from '../lib/businessCard'
import { fetchMyOrgId } from '../lib/supabase'
import BusinessCardView from '../components/businessCard/BusinessCardView'

const card = 'rounded-xl border border-line bg-surface p-5 space-y-3'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const input = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-muted'
const sectionTitle = 'text-sm font-semibold text-ink'
const colorInput = 'h-9 w-14 cursor-pointer rounded-lg border border-line bg-canvas'

// One card per driver now (was one per org). This top level is just the
// driver picker + create/delete; the actual builder form below is
// unchanged, it just edits whichever card is selected.
export default function BusinessCardSettings() {
  const qc = useQueryClient()
  const { data: cards, isLoading } = useQuery({ queryKey: ['myBusinessCards'], queryFn: fetchMyBusinessCards })
  const { data: orgId } = useQuery({ queryKey: ['myOrgId'], queryFn: fetchMyOrgId })
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (cards?.length && !cards.some((c) => c.id === selectedId)) setSelectedId(cards[0].id)
  }, [cards, selectedId])

  if (isLoading || !cards) return <div className="p-8 text-sm text-muted">Loading…</div>

  const selectedCard = cards.find((c) => c.id === selectedId) || null

  const handleCreate = async () => {
    if (!orgId) return
    setCreating(true)
    try {
      const created = await createBusinessCard(orgId, { brand_name: cards[0]?.brand_name || '' })
      await qc.invalidateQueries({ queryKey: ['myBusinessCards'] })
      setSelectedId(created.id)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id) => {
    const target = cards.find((c) => c.id === id)
    if (!confirm(`Delete ${target?.full_name || 'this driver'}'s card? This can't be undone.`)) return
    await deleteBusinessCard(id)
    await qc.invalidateQueries({ queryKey: ['myBusinessCards'] })
    if (selectedId === id) setSelectedId(null)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Digital Business Cards</h1>
          <p className="max-w-xl text-sm text-muted">
            One shareable card per driver — no code needed. Shares, downloads, and QR scans are counted per card below.
          </p>
        </div>
        <button onClick={handleCreate} disabled={creating} className={btnAccent}>
          {creating ? 'Creating…' : '+ New driver card'}
        </button>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <DriverCardRow
            key={c.id}
            c={c}
            selected={c.id === selectedId}
            onSelect={() => setSelectedId(c.id)}
            onDelete={() => handleDelete(c.id)}
          />
        ))}
      </div>

      {selectedCard && (
        <BusinessCardEditor
          key={selectedCard.id}
          initialCard={selectedCard}
          onSaved={() => qc.invalidateQueries({ queryKey: ['myBusinessCards'] })}
        />
      )}
    </div>
  )
}

function DriverCardRow({ c, selected, onSelect, onDelete }) {
  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-xl border p-4 transition-colors ${selected ? 'border-accent bg-accent/5' : 'border-line bg-surface hover:border-accent/50'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{c.full_name || 'Unnamed driver'}</div>
          <div className="truncate text-xs text-muted">/card/{c.slug}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            c.is_published ? 'bg-starboard/15 text-starboard' : 'bg-canvas text-muted ring-1 ring-inset ring-line'
          }`}>
            {c.is_published ? 'Live' : 'Draft'}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="rounded p-0.5 text-muted hover:bg-red-50 hover:text-red-500"
            title="Delete this card"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3 text-xs text-muted">
        <span title="Times shared">🔗 {c.share_count ?? 0}</span>
        <span title="Times saved to contacts">⬇️ {c.download_count ?? 0}</span>
        <span title="QR code scans">📷 {c.scan_count ?? 0}</span>
      </div>
    </div>
  )
}

function BusinessCardEditor({ initialCard, onSaved }) {
  const [form, setForm] = useState(initialCard)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [slugSuggestions, setSlugSuggestions] = useState([])
  const [mobileTab, setMobileTab] = useState('edit') // 'edit' | 'preview'
  const [qrPngUrl, setQrPngUrl] = useState('')
  const [copyFlag, setCopyFlag] = useState('')

  useEffect(() => {
    if (!form?.slug) { setQrPngUrl(''); return }
    QRCode.toDataURL(`${window.location.origin}/card/${form.slug}?src=qr`, { margin: 1, width: 480 })
      .then(setQrPngUrl).catch(() => {})
  }, [form?.slug])

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); setSlugSuggestions([]) }
  const setBool = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.checked })); setSaved(false) }
  const setList = (k) => (list) => { setForm((f) => ({ ...f, [k]: list })); setSaved(false) }

  const save = async () => {
    setSaving(true); setErr(''); setSaved(false); setSlugSuggestions([])
    try {
      const patch = { ...form, slug: slugify(form.slug) }
      delete patch.id; delete patch.org_id; delete patch.created_at; delete patch.updated_at
      delete patch.share_count; delete patch.download_count; delete patch.scan_count
      const updated = await saveBusinessCard(form.id, patch)
      setForm(updated)
      onSaved()
      setSaved(true)
    } catch (e) {
      setErr(e.message || String(e))
      if (/already taken/i.test(e.message || '')) setSlugSuggestions(suggestSlugs(form.slug))
    } finally {
      setSaving(false)
    }
  }

  const publicUrl = `${window.location.origin}/card/${form.slug}`

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(publicUrl); setSaved(false); flashCopy('link') } catch { /* noop */ }
  }
  const copyQr = async () => {
    if (!qrPngUrl) return
    try {
      const blob = await (await fetch(qrPngUrl)).blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      flashCopy('qr')
    } catch {
      // Clipboard image write isn't supported everywhere -- fall back to opening it.
      window.open(qrPngUrl, '_blank')
    }
  }
  function flashCopy(which) { setCopyFlag(which); setTimeout(() => setCopyFlag(''), 1800) }

  return (
    <div>
      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
      {saved && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">✓ Saved.</p>}

      <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
          form.is_published ? 'bg-starboard/15 text-starboard' : 'bg-canvas text-muted ring-1 ring-inset ring-line'
        }`}>
          {form.is_published ? 'Published' : 'Draft'}
        </span>
        <button onClick={() => setForm((f) => ({ ...f, is_published: !f.is_published }))} className={btn}>
          {form.is_published ? 'Unpublish' : 'Publish'}
        </button>
        <button onClick={save} disabled={saving} className={btnAccent}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {form.is_published && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3">
          <a href={publicUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-accent hover:underline">
            {publicUrl}
          </a>
          <div className="ml-auto flex gap-2">
            <button onClick={copyLink} className={btn}>{copyFlag === 'link' ? '✓ Copied' : 'Copy my public link'}</button>
            <button onClick={copyQr} className={btn}>{copyFlag === 'qr' ? '✓ Copied' : 'Copy QR image'}</button>
          </div>
        </div>
      )}

      {/* Mobile tab toggle */}
      <div className="mb-4 flex gap-2 lg:hidden">
        <button onClick={() => setMobileTab('edit')} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mobileTab === 'edit' ? 'bg-accent text-ink' : 'border border-line text-muted'}`}>Edit</button>
        <button onClick={() => setMobileTab('preview')} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mobileTab === 'preview' ? 'bg-accent text-ink' : 'border border-line text-muted'}`}>Preview</button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        {/* Form */}
        <div className={`space-y-4 ${mobileTab === 'preview' ? 'hidden lg:block' : ''}`}>
          <section className={card}>
            <h2 className={sectionTitle}>Public link</h2>
            <div>
              <span className={label}>Slug (yoursite.com/card/…)</span>
              <input value={form.slug} onChange={set('slug')} className={input} />
              {slugSuggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="text-xs text-muted">Try:</span>
                  {slugSuggestions.map((s) => (
                    <button key={s} onClick={() => setForm((f) => ({ ...f, slug: s }))} className="rounded-full border border-line px-2 py-0.5 text-xs text-ink hover:border-accent">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Branding</h2>
            <Field label="Brand name"><input value={form.brand_name || ''} onChange={set('brand_name')} className={input} /></Field>
            <Field label="Logo URL (optional — falls back to the icon)">
              <input value={form.brand_logo_url || ''} onChange={set('brand_logo_url')} className={input} placeholder="https://…" />
            </Field>
            <Field label="Icon (emoji)"><input value={form.brand_icon || ''} onChange={set('brand_icon')} className={input} maxLength={4} /></Field>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ColorField label="Background" value={form.primary_bg} onChange={set('primary_bg')} />
              <ColorField label="Panel" value={form.panel_bg} onChange={set('panel_bg')} />
              <ColorField label="Accent" value={form.accent_color} onChange={set('accent_color')} />
              <ColorField label="CTA" value={form.cta_color} onChange={set('cta_color')} />
            </div>
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Identity</h2>
            <Field label="Full name"><input value={form.full_name || ''} onChange={set('full_name')} className={input} /></Field>
            <Field label="Title"><input value={form.title || ''} onChange={set('title')} className={input} /></Field>
            <Field label="Company line"><input value={form.company_line || ''} onChange={set('company_line')} className={input} placeholder="Ship2Shore Booking · WHALEY Inc." /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Address line 1"><input value={form.address_line1 || ''} onChange={set('address_line1')} className={input} /></Field>
              <Field label="Address line 2"><input value={form.address_line2 || ''} onChange={set('address_line2')} className={input} /></Field>
            </div>
          </section>

          <section className={card}>
            <div className="flex items-center justify-between">
              <h2 className={sectionTitle}>Credential badge</h2>
              <label className="flex items-center gap-2 text-xs font-medium text-muted">
                <input type="checkbox" checked={!!form.credential_badge_enabled} onChange={setBool('credential_badge_enabled')} />
                Show badge
              </label>
            </div>
            <Field label="Badge text"><input value={form.credential_badge_text || ''} onChange={set('credential_badge_text')} className={input} placeholder="TWIC Credentialed · Verified" /></Field>
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Contact buttons</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Phone (call)"><input value={form.phone || ''} onChange={set('phone')} className={input} /></Field>
              <Field label="SMS number (text)"><input value={form.sms_number || ''} onChange={set('sms_number')} className={input} /></Field>
              <Field label="Email"><input value={form.email || ''} onChange={set('email')} className={input} /></Field>
            </div>
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Call to action buttons</h2>
            <Field label="Primary button label"><input value={form.primary_cta_label || ''} onChange={set('primary_cta_label')} className={input} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Secondary button label"><input value={form.secondary_cta_label || ''} onChange={set('secondary_cta_label')} className={input} placeholder="Book an Escort" /></Field>
              <Field label="Secondary button link"><input value={form.secondary_cta_url || ''} onChange={set('secondary_cta_url')} className={input} placeholder="https://…" /></Field>
            </div>
          </section>

          <section className={card}>
            <div className="flex items-center justify-between">
              <h2 className={sectionTitle}>Tools & documents</h2>
              <input value={form.tools_section_label || ''} onChange={set('tools_section_label')} className={`${input} w-40`} placeholder="Section title" />
            </div>
            <ToolsEditor items={form.tools_list || []} onChange={setList('tools_list')} />
          </section>

          <section className={card}>
            <div className="flex items-center justify-between">
              <h2 className={sectionTitle}>Locations</h2>
              <input value={form.locations_section_label || ''} onChange={set('locations_section_label')} className={`${input} w-40`} placeholder="Section title" />
            </div>
            <LocationsEditor items={form.locations_list || []} onChange={setList('locations_list')} />
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Payment methods</h2>
            <PaymentMethodsEditor items={form.payment_methods || []} onChange={setList('payment_methods')} />
          </section>

          <section className={card}>
            <h2 className={sectionTitle}>Footer & sharing</h2>
            <Field label="Hours line"><input value={form.hours_line || ''} onChange={set('hours_line')} className={input} placeholder="Mon–Fri, 8am–5pm Pacific" /></Field>
            <Field label="Footer tagline"><input value={form.footer_tagline || ''} onChange={set('footer_tagline')} className={input} /></Field>
            <Field label='"Send your info" button label'><input value={form.share_prompt_text || ''} onChange={set('share_prompt_text')} className={input} /></Field>
          </section>

          <button onClick={save} disabled={saving} className={`${btnAccent} w-full justify-center py-3`}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Live preview */}
        <div className={mobileTab === 'edit' ? 'hidden lg:block' : ''}>
          <div className="lg:sticky lg:top-6">
            <BusinessCardView card={form} mode="preview" />
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label: l, children }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      {children}
    </label>
  )
}

function ColorField({ label: l, value, onChange }) {
  return (
    <label className="block">
      <span className={label}>{l}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value || '#000000'} onChange={onChange} className={colorInput} />
        <span className="font-[family-name:var(--font-mono)] text-xs text-muted">{value}</span>
      </div>
    </label>
  )
}

/* -------------------------------------------------------------------- */
/* Repeatable row editors                                                */
/* -------------------------------------------------------------------- */

function RowShell({ children, onRemove, onUp, onDown }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas/60 p-3">
      <div className="flex-1 grid gap-2 sm:grid-cols-2">{children}</div>
      <div className="flex shrink-0 flex-col gap-1">
        <button onClick={onUp} className="rounded border border-line px-1.5 text-xs text-muted hover:border-accent" title="Move up">↑</button>
        <button onClick={onDown} className="rounded border border-line px-1.5 text-xs text-muted hover:border-accent" title="Move down">↓</button>
        <button onClick={onRemove} className="rounded border border-line px-1.5 text-xs text-port hover:border-port" title="Remove">✕</button>
      </div>
    </div>
  )
}

function useRowOps(items, onChange) {
  const update = (i, patch) => onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const remove = (i) => onChange(items.filter((_, idx) => idx !== i))
  const move = (i, dir) => {
    const to = i + dir
    if (to < 0 || to >= items.length) return
    const copy = [...items]
    ;[copy[i], copy[to]] = [copy[to], copy[i]]
    onChange(copy)
  }
  return { update, remove, move }
}

const rowInput = 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent'

function ToolsEditor({ items, onChange }) {
  const { update, remove, move } = useRowOps(items, onChange)
  return (
    <div className="space-y-2">
      {items.map((t, i) => (
        <RowShell key={i} onRemove={() => remove(i)} onUp={() => move(i, -1)} onDown={() => move(i, 1)}>
          <input value={t.icon || ''} onChange={(e) => update(i, { icon: e.target.value })} placeholder="Icon (emoji)" className={rowInput} />
          <input value={t.label || ''} onChange={(e) => update(i, { label: e.target.value })} placeholder="Label" className={rowInput} />
          <input value={t.sublabel || ''} onChange={(e) => update(i, { sublabel: e.target.value })} placeholder="Sublabel (optional)" className={rowInput} />
          <input value={t.url || ''} onChange={(e) => update(i, { url: e.target.value })} placeholder="https://…" className={rowInput} />
        </RowShell>
      ))}
      <button onClick={() => onChange([...items, { icon: '📄', label: '', sublabel: '', url: '' }])} className="text-xs font-semibold text-accent hover:underline">
        + Add tool
      </button>
    </div>
  )
}

function LocationsEditor({ items, onChange }) {
  const { update, remove, move } = useRowOps(items, onChange)
  return (
    <div className="space-y-2">
      {items.map((l, i) => (
        <RowShell key={i} onRemove={() => remove(i)} onUp={() => move(i, -1)} onDown={() => move(i, 1)}>
          <input value={l.name || ''} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" className={rowInput} />
          <input value={l.subtitle || ''} onChange={(e) => update(i, { subtitle: e.target.value })} placeholder="Subtitle (optional)" className={rowInput} />
          <input value={l.address || ''} onChange={(e) => update(i, { address: e.target.value })} placeholder="Address" className={`${rowInput} sm:col-span-2`} />
          <input value={l.maps_url || ''} onChange={(e) => update(i, { maps_url: e.target.value })} placeholder="Maps link" className={`${rowInput} sm:col-span-2`} />
        </RowShell>
      ))}
      <button onClick={() => onChange([...items, { name: '', subtitle: '', address: '', maps_url: '' }])} className="text-xs font-semibold text-accent hover:underline">
        + Add location
      </button>
    </div>
  )
}

function PaymentMethodsEditor({ items, onChange }) {
  const { update, remove, move } = useRowOps(items, onChange)
  return (
    <div className="space-y-2">
      {items.map((m, i) => {
        const meta = PAYMENT_TYPES.find((t) => t.value === m.type) || PAYMENT_TYPES[0]
        return (
          <RowShell key={i} onRemove={() => remove(i)} onUp={() => move(i, -1)} onDown={() => move(i, 1)}>
            <select
              value={m.type} onChange={(e) => {
                const nextMeta = PAYMENT_TYPES.find((t) => t.value === e.target.value)
                update(i, { type: e.target.value, action: nextMeta.defaultAction })
              }}
              className={rowInput}
            >
              {PAYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input value={m.handle || ''} onChange={(e) => update(i, { handle: e.target.value })} placeholder={meta.handleHint} className={rowInput} />
            <select value={m.action || meta.defaultAction} onChange={(e) => update(i, { action: e.target.value })} className={`${rowInput} sm:col-span-2`}>
              <option value="pay">Tap to pay (opens app/link)</option>
              <option value="copy">Tap to copy handle</option>
            </select>
          </RowShell>
        )
      })}
      <button
        onClick={() => onChange([...items, { type: 'cashapp', handle: '', action: 'pay' }])}
        className="text-xs font-semibold text-accent hover:underline"
      >
        + Add payment method
      </button>
    </div>
  )
}
