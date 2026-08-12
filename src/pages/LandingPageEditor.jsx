import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchLandingPage, createLandingPage, updateLandingPage } from '../lib/supabase'
import { BLOCK_TYPES, newBlock, toEmbedUrl, SPACER_SIZES } from '../lib/landingBlocks'
import LandingBlockView from '../components/LandingBlockView'
import { PUBLIC_THEMES, getPublicTheme } from '../lib/publicThemes'

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent'
const label = 'mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted'

const slugify = (s) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export default function LandingPageEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [loading, setLoading] = useState(!isNew)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [published, setPublished] = useState(false)
  const [theme, setTheme] = useState('classic')
  const [blocks, setBlocks] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (isNew) { setSettingsOpen(true); return }
    let cancelled = false
    fetchLandingPage(id).then((p) => {
      if (cancelled) return
      setTitle(p.title); setSlug(p.slug); setPublished(p.published); setTheme(p.theme || 'classic')
      setBlocks((p.blocks || []).map((b) => ({ id: b.id || crypto.randomUUID(), ...b })))
      setLoading(false)
    }).catch((e) => { setErr(e.message); setLoading(false) })
    return () => { cancelled = true }
  }, [id, isNew])

  const onTitleChange = (v) => {
    setTitle(v)
    if (!slugTouched) setSlug(slugify(v))
  }

  const insertBlockAt = (index, type) => {
    setBlocks((b) => { const copy = [...b]; copy.splice(index, 0, newBlock(type)); return copy })
  }
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

  // Native HTML5 drag-and-drop reordering.
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const onDragStart = (index) => setDraggedIndex(index)
  const onDragOverBlock = (e, index) => { e.preventDefault(); setDragOverIndex(index) }
  const onDrop = (index) => {
    setBlocks((b) => {
      if (draggedIndex === null || draggedIndex === index) return b
      const copy = [...b]
      const [moved] = copy.splice(draggedIndex, 1)
      copy.splice(draggedIndex < index ? index - 1 : index, 0, moved)
      return copy
    })
    setDraggedIndex(null); setDragOverIndex(null)
  }
  const onDragEnd = () => { setDraggedIndex(null); setDragOverIndex(null) }

  const save = async () => {
    if (!title.trim() || !slug.trim()) { setErr('Title and slug are required.'); setSettingsOpen(true); return }
    setSaving(true); setErr('')
    try {
      const payload = { title: title.trim(), slug: slugify(slug), published, theme, blocks }
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
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-[family-name:var(--font-display)] text-lg font-bold text-ink">
              {title || 'Untitled page'}
            </h1>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              published ? 'bg-starboard/15 text-starboard' : 'bg-canvas text-muted ring-1 ring-inset ring-line'
            }`}>
              {published ? 'Published' : 'Draft'}
            </span>
          </div>
          {!isNew && published && (
            <a href={`/pages/${slug}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-accent hover:underline">
              /pages/{slug} ↗
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className={btn} onClick={() => setSettingsOpen((s) => !s)}>Page settings</button>
          <button className={btnAccent} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {err && <p className="mx-4 mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-port sm:mx-6">⚠️ {err}</p>}

      {settingsOpen && (
        <div className="border-b border-line bg-canvas px-4 py-4 sm:px-6">
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
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
              {published ? 'Live for anyone with the link' : 'Not visible to the public until published'}
            </span>
          </div>
          <div className="mt-4 max-w-2xl">
            <label className={label}>Accent color</label>
            <div className="flex flex-wrap gap-1.5">
              {PUBLIC_THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTheme(t.key)}
                  title={t.label}
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                    theme === t.key ? 'border-accent bg-accent/10 text-ink' : 'border-line bg-surface text-muted hover:text-ink'
                  }`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ background: t.accent }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Canvas — renders through the same component as the public page, so
          this IS the live preview rather than a lookalike that drifts. */}
      <div className="flex-1 overflow-auto bg-[#f3f4f6] px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl bg-white pb-8 shadow-sm">
          <InsertPoint onInsert={(type) => insertBlockAt(0, type)} />
          {blocks.map((block, i) => (
            <div key={block.id}>
              <BlockCanvasItem
                block={block}
                index={i}
                count={blocks.length}
                dragging={draggedIndex === i}
                dropTarget={dragOverIndex === i}
                theme={theme}
                onChange={(patch) => updateBlock(block.id, patch)}
                onRemove={() => removeBlock(block.id)}
                onMove={(dir) => moveBlock(i, dir)}
                onDragStart={() => onDragStart(i)}
                onDragOver={(e) => onDragOverBlock(e, i)}
                onDrop={() => onDrop(i)}
                onDragEnd={onDragEnd}
              />
              <InsertPoint onInsert={(type) => insertBlockAt(i + 1, type)} />
            </div>
          ))}
          {blocks.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Click + above to add your first block.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// A thin hover-to-reveal strip between blocks (and at the top/bottom) that
// opens the block-type palette to insert right at that spot -- not just at
// the end of the page.
function InsertPoint({ onInsert }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="group/insert relative flex h-3 items-center justify-center">
      <div className="h-px w-full bg-transparent group-hover/insert:bg-accent/30" />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="absolute z-10 flex h-5 w-5 items-center justify-center rounded-full bg-line text-[11px] font-bold text-muted opacity-0 transition-opacity hover:bg-accent hover:text-ink group-hover/insert:opacity-100"
        title="Add block here"
      >
        +
      </button>
      {open && (
        <div className="absolute top-4 z-20 flex flex-wrap justify-center gap-1 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          {BLOCK_TYPES.map((t) => (
            <button
              key={t.value}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink hover:bg-canvas"
              onClick={() => { onInsert(t.value); setOpen(false) }}
            >
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Controls({ index, count, onRemove, onMove, onDragStart, onDragEnd, typeLabel, onEdit }) {
  return (
    <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover/block:pointer-events-auto group-hover/block:opacity-100">
      <span className="rounded-full bg-brand px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{typeLabel}</span>
      {onEdit && (
        <button className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-ink" onClick={onEdit} title="Edit this section">
          Edit
        </button>
      )}
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="cursor-grab rounded-full bg-brand px-1.5 py-0.5 text-[11px] text-white active:cursor-grabbing"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <button className="rounded-full bg-brand px-1.5 py-0.5 text-[11px] text-white disabled:opacity-40" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">↑</button>
      <button className="rounded-full bg-brand px-1.5 py-0.5 text-[11px] text-white disabled:opacity-40" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down">↓</button>
      <button className="rounded-full bg-port px-1.5 py-0.5 text-[11px] text-white" onClick={onRemove} title="Remove block">✕</button>
    </div>
  )
}

function AutoTextarea({ value, onChange, placeholder, className }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current) { ref.current.style.height = 'auto'; ref.current.style.height = `${ref.current.scrollHeight}px` }
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-gray-300 ${className || ''}`}
    />
  )
}

// Blocks whose layout is too structural to edit in place (a hero's type sits
// over a photograph; a service grid is three cards). They render exactly as
// they will ship, with a panel underneath for the copy -- so what you tune is
// always shown against the real design.
const PANEL_EDITED = new Set(['hero', 'features', 'stats', 'testimonial', 'contact'])

// Inline-edited blocks live in the prose column, so they need the same gutter
// the public renderer gives them.
const Gutter = ({ children }) => <div className="mx-auto max-w-3xl px-6 sm:px-8">{children}</div>

function BlockCanvasItem({ block, index, count, dragging, dropTarget, theme, onChange, onRemove, onMove, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const typeLabel = BLOCK_TYPES.find((t) => t.value === block.type)?.label || block.type
  const [panelOpen, setPanelOpen] = useState(false)

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group/block relative outline-dashed outline-1 outline-transparent transition hover:outline-accent/40 ${
        dragging ? 'opacity-40' : ''
      } ${dropTarget ? 'outline-accent' : ''}`}
    >
      <Controls index={index} count={count} onRemove={onRemove} onMove={onMove} onDragStart={onDragStart} onDragEnd={onDragEnd} typeLabel={typeLabel}
        onEdit={PANEL_EDITED.has(block.type) ? () => setPanelOpen((o) => !o) : null} />

      {PANEL_EDITED.has(block.type) && (
        <>
          <LandingBlockView block={block} theme={theme} />
          {panelOpen && <BlockPanel block={block} onChange={onChange} onClose={() => setPanelOpen(false)} />}
        </>
      )}

      {block.type === 'heading' && (
        <Gutter>
          <input
            value={block.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Click to add a heading"
            className="mb-4 mt-2 w-full bg-transparent text-2xl font-bold text-gray-900 outline-none placeholder:text-gray-300 sm:text-3xl"
          />
        </Gutter>
      )}

      {block.type === 'paragraph' && (
        <Gutter>
          <AutoTextarea
            value={block.text}
            onChange={(text) => onChange({ text })}
            placeholder="Click to add body text"
            className="mb-4 text-base leading-relaxed text-gray-700"
          />
        </Gutter>
      )}

      {block.type === 'image' && <Gutter><ImageBlockEditor block={block} onChange={onChange} /></Gutter>}
      {block.type === 'video' && <Gutter><VideoBlockEditor block={block} onChange={onChange} /></Gutter>}
      {block.type === 'cta' && <Gutter><CtaBlockEditor block={block} onChange={onChange} theme={theme} /></Gutter>}

      {block.type === 'divider' && <Gutter><hr className="my-4 border-gray-200" /></Gutter>}

      {block.type === 'spacer' && (
        <Gutter>
          <div className="mb-2 flex items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 bg-gray-50 text-[11px] text-gray-400"
            style={{ height: SPACER_SIZES[block.size] || SPACER_SIZES.md }}>
            Spacer
            <span className="flex gap-1">
              {Object.keys(SPACER_SIZES).map((s) => (
                <button key={s} onClick={() => onChange({ size: s })}
                  className={`rounded px-1.5 py-0.5 uppercase ${block.size === s ? 'bg-accent text-ink' : 'bg-white text-gray-400 ring-1 ring-inset ring-gray-200'}`}>
                  {s}
                </button>
              ))}
            </span>
          </div>
        </Gutter>
      )}
    </div>
  )
}

// Module-scope, not nested inside BlockPanel: a component defined inside
// another component's render body gets a brand-new function identity on
// every render, which makes React treat it as a different component type
// at that position and remount it -- destroying focus after every single
// keystroke. Takes block/onChange explicitly instead of closing over them.
function Field({ block, onChange, name, k, ph, area }) {
  return (
    <div>
      <label className={label}>{name}</label>
      {area ? (
        <textarea rows={2} className={input} value={block[k] || ''} onChange={(e) => onChange({ [k]: e.target.value })} placeholder={ph} />
      ) : (
        <input className={input} value={block[k] || ''} onChange={(e) => onChange({ [k]: e.target.value })} placeholder={ph} />
      )}
    </div>
  )
}

/* Field panel for the structural blocks. Sits directly under the block it
   edits so the effect of a change is visible without scrolling. */
function BlockPanel({ block, onChange, onClose }) {
  const setItem = (i, patch) => {
    const items = (block.items || []).map((it, j) => (j === i ? { ...it, ...patch } : it))
    onChange({ items })
  }
  const addItem = (blank) => onChange({ items: [...(block.items || []), blank] })
  const removeItem = (i) => onChange({ items: (block.items || []).filter((_, j) => j !== i) })

  return (
    <div className="border-y-2 border-accent bg-canvas p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">Edit this section</span>
        <button onClick={onClose} className="text-xs font-medium text-ink hover:text-accent">Done</button>
      </div>

      {block.type === 'hero' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field block={block} onChange={onChange} name="Eyebrow (small line above)" k="eyebrow" ph="Mobile & Shop Welding" />
          <Field block={block} onChange={onChange} name="Headline" k="heading" ph="Sparky's Arc Welding" />
          <div className="sm:col-span-2"><Field block={block} onChange={onChange} name="Subheading" k="subheading" ph="What you do, where, and why you're worth calling." area /></div>
          <Field block={block} onChange={onChange} name="Button label" k="ctaLabel" ph="Get a Free Quote" />
          <div>
            <label className={label}>Button goes to</label>
            <select className={input} value={block.ctaTarget || 'lead_form'} onChange={(e) => onChange({ ctaTarget: e.target.value })}>
              <option value="lead_form">Lead-capture form</option>
              <option value="booking">Booking page (/book)</option>
            </select>
          </div>
          <div className="sm:col-span-2"><Field block={block} onChange={onChange} name="Background image URL" k="image" ph="https://.../photo.jpg" /></div>
          <p className="text-xs text-muted sm:col-span-2">
            Leave the image blank for a clean dark hero. A photo of the customer's own work will always beat stock.
          </p>
        </div>
      )}

      {block.type === 'features' && (
        <div className="space-y-3">
          <Field block={block} onChange={onChange} name="Section title" k="title" ph="What We Do" />
          {(block.items || []).map((item, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-[4rem_1fr]">
              <div>
                <label className={label}>Icon</label>
                <input className={input} value={item.icon || ''} onChange={(e) => setItem(i, { icon: e.target.value })} placeholder="🔧" />
              </div>
              <div className="space-y-2">
                <input className={input} value={item.title || ''} onChange={(e) => setItem(i, { title: e.target.value })} placeholder="Service name" />
                <textarea rows={2} className={input} value={item.text || ''} onChange={(e) => setItem(i, { text: e.target.value })} placeholder="One or two lines about it." />
                <button onClick={() => removeItem(i)} className="text-xs font-medium text-port hover:underline">Remove</button>
              </div>
            </div>
          ))}
          <button onClick={() => addItem({ icon: '✅', title: '', text: '' })} className={btn}>+ Add service</button>
        </div>
      )}

      {block.type === 'stats' && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            These are claims about a real business — fill them in with the customer's actual numbers rather than leaving the brackets.
          </p>
          {(block.items || []).map((item, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <input className={input} value={item.value || ''} onChange={(e) => setItem(i, { value: e.target.value })} placeholder="12" />
              <div className="flex gap-2">
                <input className={input} value={item.label || ''} onChange={(e) => setItem(i, { label: e.target.value })} placeholder="Years in business" />
                <button onClick={() => removeItem(i)} className="shrink-0 text-xs font-medium text-port hover:underline">Remove</button>
              </div>
            </div>
          ))}
          <button onClick={() => addItem({ value: '', label: '' })} className={btn}>+ Add stat</button>
        </div>
      )}

      {block.type === 'testimonial' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field block={block} onChange={onChange} name="Quote" k="quote" ph="Paste a real review from a customer." area /></div>
          <Field block={block} onChange={onChange} name="Who said it" k="author" ph="Dana R." />
          <Field block={block} onChange={onChange} name="Their role / context" k="role" ph="Homeowner" />
          <p className="text-xs text-muted sm:col-span-2">
            Use a review the customer actually received. A made-up testimonial is a fake review.
          </p>
        </div>
      )}

      {block.type === 'contact' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field block={block} onChange={onChange} name="Business name" k="business" ph="Sparky's Arc Welding" />
          <Field block={block} onChange={onChange} name="Phone" k="phone" ph="(910) 555-0142" />
          <Field block={block} onChange={onChange} name="Email" k="email" ph="shop@example.com" />
          <Field block={block} onChange={onChange} name="Service area" k="area" ph="Serving Wilmington and surrounding areas" />
        </div>
      )}
    </div>
  )
}

function ImageBlockEditor({ block, onChange }) {
  const [editing, setEditing] = useState(!block.url)
  return (
    <div className="mb-4">
      {block.url ? (
        <div className="group/img relative">
          <img src={block.url} alt={block.alt || ''} className="w-full rounded-xl object-cover" />
          <button onClick={() => setEditing((e) => !e)}
            className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover/img:opacity-100">
            Edit
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)}
          className="flex w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-10 text-sm text-gray-400 hover:border-accent hover:text-accent">
          + Add image
        </button>
      )}
      {editing && (
        <div className="mt-2 grid gap-2 rounded-lg border border-line bg-canvas p-3 sm:grid-cols-2">
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
    </div>
  )
}

function VideoBlockEditor({ block, onChange }) {
  const [editing, setEditing] = useState(!block.url)
  const embedUrl = toEmbedUrl(block.url)
  return (
    <div className="mb-4">
      {embedUrl ? (
        <div className="group/vid relative overflow-hidden rounded-xl" style={{ aspectRatio: '16 / 9' }}>
          <iframe src={embedUrl} className="h-full w-full" allowFullScreen title="Video" />
          <button onClick={() => setEditing((e) => !e)}
            className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs font-medium text-white opacity-0 group-hover/vid:opacity-100">
            Edit
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)}
          className="flex w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 py-10 text-sm text-gray-400 hover:border-accent hover:text-accent">
          + Add video (YouTube or Vimeo link)
        </button>
      )}
      {editing && (
        <div className="mt-2 rounded-lg border border-line bg-canvas p-3">
          <label className={label}>YouTube or Vimeo URL</label>
          <input className={input} value={block.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://youtube.com/watch?v=..." />
          {block.url && !embedUrl && <p className="mt-1 text-xs text-port">Couldn't recognize that as a YouTube or Vimeo link.</p>}
        </div>
      )}
    </div>
  )
}

function CtaBlockEditor({ block, onChange, theme }) {
  const { accent, accentText } = getPublicTheme(theme)
  return (
    <div className="mb-4">
      <div className="inline-block rounded-xl px-8 py-4" style={{ background: accent }}>
        <input
          value={block.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="bg-transparent text-center text-base font-bold outline-none"
          style={{ width: `${Math.max(8, (block.label || '').length)}ch`, color: accentText }}
          placeholder="Button label"
        />
      </div>
      <div className="mt-2">
        <select className={input + ' w-auto'} value={block.target} onChange={(e) => onChange({ target: e.target.value })}>
          <option value="booking">Links to native booking page (/book)</option>
          <option value="lead_form">Links to inline lead-capture form</option>
        </select>
      </div>
    </div>
  )
}
