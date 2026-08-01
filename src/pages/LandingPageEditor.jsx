import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchLandingPage, createLandingPage, updateLandingPage } from '../lib/supabase'
import { BLOCK_TYPES, newBlock, toEmbedUrl, SPACER_SIZES } from '../lib/landingBlocks'

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
  const [blocks, setBlocks] = useState([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (isNew) { setSettingsOpen(true); return }
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
        </div>
      )}

      {/* Canvas — styled exactly like the public page, so this IS the live preview */}
      <div className="flex-1 overflow-auto bg-[#f3f4f6] px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="bg-[#1a1a1a] px-6 py-5 sm:px-10">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[#e8a317]">Ship2Shore</span>
          </div>
          <div className="px-6 py-8 sm:px-10 sm:py-12">
            <InsertPoint onInsert={(type) => insertBlockAt(0, type)} />
            {blocks.map((block, i) => (
              <div key={block.id}>
                <BlockCanvasItem
                  block={block}
                  index={i}
                  count={blocks.length}
                  dragging={draggedIndex === i}
                  dropTarget={dragOverIndex === i}
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

function Controls({ index, count, onRemove, onMove, onDragStart, onDragEnd, typeLabel }) {
  return (
    <div className="pointer-events-none absolute -top-3 right-0 flex items-center gap-1 opacity-0 transition-opacity group-hover/block:pointer-events-auto group-hover/block:opacity-100">
      <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{typeLabel}</span>
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="cursor-grab rounded-full bg-ink px-1.5 py-0.5 text-[11px] text-white active:cursor-grabbing"
        title="Drag to reorder"
      >
        ⠿
      </span>
      <button className="rounded-full bg-ink px-1.5 py-0.5 text-[11px] text-white disabled:opacity-40" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">↑</button>
      <button className="rounded-full bg-ink px-1.5 py-0.5 text-[11px] text-white disabled:opacity-40" disabled={index === count - 1} onClick={() => onMove(1)} title="Move down">↓</button>
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

function BlockCanvasItem({ block, index, count, dragging, dropTarget, onChange, onRemove, onMove, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const typeLabel = BLOCK_TYPES.find((t) => t.value === block.type)?.label || block.type
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`group/block relative rounded-lg outline-dashed outline-1 outline-transparent transition hover:outline-accent/40 ${
        dragging ? 'opacity-40' : ''
      } ${dropTarget ? 'outline-accent' : ''}`}
    >
      <Controls index={index} count={count} onRemove={onRemove} onMove={onMove} onDragStart={onDragStart} onDragEnd={onDragEnd} typeLabel={typeLabel} />

      {block.type === 'heading' && (
        <input
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Click to add a heading"
          className="mb-4 w-full bg-transparent text-2xl font-bold text-gray-900 outline-none placeholder:text-gray-300 sm:text-3xl"
        />
      )}

      {block.type === 'paragraph' && (
        <AutoTextarea
          value={block.text}
          onChange={(text) => onChange({ text })}
          placeholder="Click to add body text"
          className="mb-4 text-base leading-relaxed text-gray-700"
        />
      )}

      {block.type === 'image' && <ImageBlockEditor block={block} onChange={onChange} />}
      {block.type === 'video' && <VideoBlockEditor block={block} onChange={onChange} />}
      {block.type === 'cta' && <CtaBlockEditor block={block} onChange={onChange} />}

      {block.type === 'divider' && <hr className="my-4 border-gray-200" />}

      {block.type === 'spacer' && (
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

function CtaBlockEditor({ block, onChange }) {
  return (
    <div className="mb-4">
      <div className="inline-block rounded-xl bg-[#e8a317] px-8 py-4">
        <input
          value={block.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="bg-transparent text-center text-base font-bold text-[#1a1a1a] outline-none placeholder:text-[#1a1a1a]/50"
          style={{ width: `${Math.max(8, (block.label || '').length)}ch` }}
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
