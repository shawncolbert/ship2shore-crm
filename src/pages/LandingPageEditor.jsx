import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchLandingPage, createLandingPage, updateLandingPage } from '../lib/supabase'

const card = 'rounded-xl border border-line bg-surface p-5'
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted'

const slugify = (s) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const newBlock = (type) => {
  const id = crypto.randomUUID()
  switch (type) {
    case 'heading': return { id, type, text: '' }
    case 'paragraph': return { id, type, text: '' }
    case 'image': return { id, type, url: '', alt: '' }
    case 'cta': return { id, type, label: 'Book Now', target: 'booking' }
    default: return { id, type: 'paragraph', text: '' }
  }
}

const BLOCK_TYPES = [
  { value: 'heading', label: 'Heading' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'image', label: 'Image' },
  { value: 'cta', label: 'Call-to-action button' },
]

export default function LandingPageEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [loading, setLoading] = useState(!isNew)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [published, setPublished] = useState(false)
  const [blocks, setBlocks] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (isNew) return
    let cancelled = false
    fetchLandingPage(id).then((p) => {
      if (cancelled) return
      setTitle(p.title); setSlug(p.slug); setPublished(p.published)
      setBlocks((p.blocks || []).map((b) => ({ id: b.id || crypto.randomUUID(), ...b })))
      setLoading(false)
    }).catch((e) => { setErr(e.message); setLoading(false) })
    return () => { cancelled = true }
  }, [id, isNew])

  const onTitleChange = (v) => {
    setTitle(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  const addBlock = (type) => setBlocks((b) => [...b, newBlock(type)])
  const removeBlock = (blockId) => setBlocks((b) => b.filter((x) => x.id !== blockId))
  const updateBlock = (blockId, patch) => setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, ...patch } : x)))
  const moveBlock = (index, dir) => {
    setBlocks((b) => {
      const to = index + dir
      if (to < 0 || to >= b.length) return b
      const copy = [...b]
      ;[copy[index], copy[to]] = [copy[to], copy[index]]
      return copy
    })
  }

  const save = async () => {
    if (!title.trim() || !slug.trim()) { setErr('Title and slug are required.'); return }
    setSaving(true); setErr('')
    try {
      const payload = { title: title.trim(), slug: slugify(slug), published, blocks }
      if (isNew) {
        const created = await createLandingPage(payload)
        navigate(`/landing-pages/${created.id}`, { replace: true })
      } else {
        await updateLandingPage(id, payload)
      }
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-8 text-sm text-muted">Loading…</div>

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
            {isNew ? 'New landing page' : 'Edit landing page'}
          </h1>
          {!isNew && published && (
            <a href={`/pages/${slug}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
              View live: /pages/{slug} ↗
            </a>
          )}
        </div>
        <button className={btnAccent} disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      <div className={`${card} mb-4`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Title</label>
            <input className={input} value={title} onChange={(e) => onTitleChange(e.target.value)} placeholder="TWIC Escort — Long Beach" />
          </div>
          <div>
            <label className={label}>Slug (/pages/&lt;slug&gt;)</label>
            <input className={input} value={slug}
              onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
              placeholder="twic-escort-long-beach" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => setPublished((p) => !p)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${published ? 'bg-starboard/15 text-starboard' : 'bg-canvas text-muted ring-1 ring-inset ring-line'}`}>
            {published ? 'Published' : 'Draft'}
          </button>
          <span className="text-xs text-muted">
            {published ? 'Live at /pages/' + (slug || '…') : 'Not visible to the public until published'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        {blocks.length === 0 && (
          <div className={card}><p className="text-sm text-muted">No content blocks yet — add one below.</p></div>
        )}
        {blocks.map((block, i) => (
          <BlockEditor
            key={block.id}
            block={block}
            index={i}
            count={blocks.length}
            onChange={(patch) => updateBlock(block.id, patch)}
            onRemove={() => removeBlock(block.id)}
            onMove={(dir) => moveBlock(i, dir)}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {BLOCK_TYPES.map((t) => (
          <button key={t.value} className={btn} onClick={() => addBlock(t.value)}>+ {t.label}</button>
        ))}
      </div>
    </div>
  )
}

function BlockEditor({ block, index, count, onChange, onRemove, onMove }) {
  const typeLabel = BLOCK_TYPES.find((t) => t.value === block.type)?.label || block.type
  return (
    <div className={card}>
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-inset ring-line">
          {typeLabel}
        </span>
        <div className="flex items-center gap-1">
          <button className="rounded p-1 text-muted hover:bg-canvas hover:text-ink disabled:opacity-30" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">↑</button>
          <button className="rounded p-1 text-muted hover:bg-canvas hover:text-ink disabled:opacity-30" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down">↓</button>
          <button className="rounded p-1 text-port hover:bg-red-50" onClick={onRemove} title="Remove block">✕</button>
        </div>
      </div>

      {(block.type === 'heading' || block.type === 'paragraph') && (
        <div>
          <label className={label}>{block.type === 'heading' ? 'Heading text' : 'Paragraph text'}</label>
          {block.type === 'heading' ? (
            <input className={input} value={block.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="TWIC Vehicle Escort at Port of Long Beach" />
          ) : (
            <textarea className={input} rows={4} value={block.text} onChange={(e) => onChange({ text: e.target.value })} placeholder="We enter the secured port, locate your vehicle, and hand it off to you outside the gate." />
          )}
        </div>
      )}

      {block.type === 'image' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Image URL</label>
            <input className={input} value={block.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://.../photo.jpg" />
          </div>
          <div>
            <label className={label}>Alt text</label>
            <input className={input} value={block.alt || ''} onChange={(e) => onChange({ alt: e.target.value })} placeholder="Vehicle escort at the port" />
          </div>
        </div>
      )}

      {block.type === 'cta' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>Button label</label>
            <input className={input} value={block.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Book Now" />
          </div>
          <div>
            <label className={label}>Links to</label>
            <select className={input} value={block.target} onChange={(e) => onChange({ target: e.target.value })}>
              <option value="booking">Native booking page (/book)</option>
              <option value="lead_form">Inline lead-capture form</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
