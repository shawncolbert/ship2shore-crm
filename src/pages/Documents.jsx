import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchReviewDocuments, fetchLinkableJobs, linkDocumentToJob,
  signedAttachmentUrl, deleteAttachment, fetchSignedUrls,
} from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'

const fmtDate = (d) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '')
const kindLabel = (k) =>
  k === 'gate_pass' ? 'Gate pass' : k === 'delivery_order' ? 'Delivery Order' : 'Shipping doc'
const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '')
// Auto-pulled email attachments are stored with URL-encoded names
// ("Delivery%20Order%20...pdf"); show them readable.
const prettyName = (s) => { try { return decodeURIComponent(s) } catch { return s } }
// One-time pdf.js load, same vendor bundle DeliveryOrderFix.jsx already
// ships for the DO editor -- shared script tag if both happen to be on
// screen, one in-flight load if several thumbnails mount at once.
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(s)
  })
}
let pdfjsReady = null
function ensurePdfJs() {
  if (!pdfjsReady) {
    pdfjsReady = loadScript('/vendor/pdf.min.js').then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js'
    })
  }
  return pdfjsReady
}

// Renders a PDF's first page to a PNG data URL for the hover preview --
// cached by signed URL so re-rendering the same document (a re-render of
// this list, hovering twice) doesn't re-run pdf.js each time.
const pdfThumbCache = new Map()
async function renderPdfThumb(url) {
  if (pdfThumbCache.has(url)) return pdfThumbCache.get(url)
  await ensurePdfJs()
  const pdf = await window.pdfjsLib.getDocument({ url }).promise
  const page = await pdf.getPage(1)
  const unscaled = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: 500 / unscaled.width })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  const dataUrl = canvas.toDataURL('image/png')
  pdfThumbCache.set(url, dataUrl)
  return dataUrl
}

const isImageFile = (f) => /^image\//.test(f.mime_type || '') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.file_name || '')
const isPdfFile = (f) => f.mime_type === 'application/pdf' || /\.pdf$/i.test(f.file_name || '')

// Small thumbnail so a dispatcher can tell what a document IS at a glance
// instead of guessing from a filename like "18009386800.pdf" -- hover it
// for a bigger read of the page without leaving this list. Renders a PDF's
// first page client-side (pdf.js); an image attachment just shows itself.
function DocThumb({ f, url }) {
  const isImage = isImageFile(f)
  const isPdf = !isImage && isPdfFile(f)
  const [thumb, setThumb] = useState(isImage ? url : null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (isImage) { setThumb(url); return }
    if (!isPdf || !url) return
    let cancelled = false
    renderPdfThumb(url).then((dataUrl) => { if (!cancelled) setThumb(dataUrl) }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [url, isImage, isPdf])

  const box = 'flex h-14 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-canvas'

  if (!url || failed || (!thumb && !isImage && !isPdf)) {
    return <span className={box + ' text-lg'}>📄</span>
  }

  return (
    <div className="group/thumb relative shrink-0">
      <div className={box}>
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="text-lg">📄</span>}
      </div>
      {thumb && (
        <div className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-56 overflow-hidden rounded-lg border border-line bg-surface shadow-xl group-hover/thumb:block">
          <img src={thumb} alt="" className="w-full" />
        </div>
      )}
    </div>
  )
}

const jobLabel = (j) => {
  const who = j.contacts?.full_name || j.title || 'Job'
  const num = j.billing_number || j.bl_number
  return num ? `${who} — #${num}` : who
}

// --- smart matching: find the job whose number best matches a document ------

const digits = (s) => (s || '').replace(/\D/g, '')

// Longest run of digits shared by two number strings.
function longestCommonRun(a, b) {
  if (!a || !b) return 0
  let best = 0
  const dp = new Array(b.length + 1).fill(0)
  for (let i = 1; i <= a.length; i++) {
    let prev = 0
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      if (a[i - 1] === b[j - 1]) { dp[j] = prev + 1; if (dp[j] > best) best = dp[j] }
      else dp[j] = 0
      prev = tmp
    }
  }
  return best
}

// The number to match a document on: the BL# digits, else the longest digit
// run in the (decoded) file name.
function docNumber(f) {
  const bl = digits(f.bl_number)
  if (bl.length >= 5) return bl
  const runs = (prettyName(f.file_name).match(/\d{5,}/g) || []).sort((a, b) => b.length - a.length)
  return runs[0] || bl
}
const jobNumber = (j) => {
  const a = digits(j.billing_number)
  const b = digits(j.bl_number)
  return a.length >= b.length ? a : b
}

// Best job for a document, with how many digits line up.
function bestJobMatch(f, jobs) {
  const dn = docNumber(f)
  if (!dn || dn.length < 5) return null
  let best = null
  for (const j of jobs) {
    const jn = jobNumber(j)
    if (jn.length < 5) continue
    const score = longestCommonRun(dn, jn)
    if (!best || score > best.score) best = { job: j, score, jn }
  }
  if (!best || best.score < 5) return null
  const exact = best.score >= Math.min(dn.length, best.jn.length)
  return { job: best.job, score: best.score, total: dn.length, exact }
}

export default function Documents() {
  const qc = useQueryClient()
  const { data: docs, isLoading } = useQuery({ queryKey: ['reviewDocs'], queryFn: fetchReviewDocuments })
  const { data: jobs } = useQuery({ queryKey: ['linkableJobs'], queryFn: fetchLinkableJobs })

  // Batched, longer-lived signed URLs (1hr) since these sit in thumbnails for
  // as long as the page is open -- same helper/reasoning as the Photos grid
  // on a contact's own page.
  const docPaths = useMemo(() => (docs || []).map((f) => f.file_path), [docs])
  const { data: thumbUrls } = useQuery({
    queryKey: ['reviewDocThumbs', docPaths.join('|')],
    queryFn: () => fetchSignedUrls(docPaths),
    enabled: docPaths.length > 0,
  })
  const [err, setErr] = useState('')
  const [clearing, setClearing] = useState(false)
  const [query, setQuery] = useState('')
  // Deliberately no "select all" / "delete all" -- Shawn wants deletes picked
  // one by one via checkbox, just several at once instead of one-at-a-time,
  // never the whole list in one shot.
  const [selected, setSelected] = useState(() => new Set())

  // Search by billing/BL number (either the plain 1800... number or the
  // full MOLU... one -- letters are ignored either way) instead of having
  // to scroll the whole list looking for one document.
  const queryDigits = digits(query)
  const filteredDocs = useMemo(() => {
    if (!query.trim()) return docs || []
    const q = query.trim().toLowerCase()
    return (docs || []).filter((f) => {
      if (queryDigits.length >= 3) {
        const haystack = `${digits(f.bl_number)} ${digits(prettyName(f.file_name))}`
        if (haystack.includes(queryDigits)) return true
      }
      return prettyName(f.file_name).toLowerCase().includes(q)
    })
  }, [docs, query, queryDigits])

  const refresh = () => qc.invalidateQueries({ queryKey: ['reviewDocs'] })

  async function download(f) {
    try { window.open(await signedAttachmentUrl(f.file_path), '_blank', 'noopener') }
    catch (e) { setErr(e.message) }
  }

  async function del(f) {
    if (!confirm(`Delete ${prettyName(f.file_name)}? This removes the file.`)) return
    try {
      await deleteAttachment({ id: f.id, filePath: f.file_path })
      setSelected((prev) => { if (!prev.has(f.id)) return prev; const next = new Set(prev); next.delete(f.id); return next })
      refresh()
    } catch (e) { setErr(e.message || String(e)) }
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function deleteSelected() {
    const targets = (docs || []).filter((f) => selected.has(f.id))
    if (!targets.length) return
    if (!confirm(`Delete ${targets.length} selected document${targets.length === 1 ? '' : 's'}? This removes the files.`)) return
    setClearing(true); setErr('')
    try {
      for (const f of targets) {
        await deleteAttachment({ id: f.id, filePath: f.file_path })
      }
      setSelected(new Set())
      refresh()
    } catch (e) {
      setErr(e.message || String(e)); refresh()
    } finally { setClearing(false) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Documents to review</h1>
          <p className="text-sm text-muted">
            Delivery Orders and gate passes pulled from email that didn’t auto-match a job.
            The closest job is suggested by BL#; confirm it with Link, pick another, or delete.
          </p>
        </div>
        {selected.size > 0 && (
          <button
            onClick={deleteSelected}
            disabled={clearing}
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm font-medium text-port hover:bg-red-50 disabled:opacity-50"
          >
            {clearing ? 'Deleting…' : `🗑️ Delete selected (${selected.size})`}
          </button>
        )}
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {docs?.length > 0 && (
        <div className="mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔎 Find by billing # / BL # (e.g. 18009386055 or MOLU18009386055)…"
            className="w-full max-w-md rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {query.trim() && (
            <p className="mt-1 text-xs text-muted">Showing {filteredDocs.length} of {docs.length}</p>
          )}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !docs || docs.length === 0 ? (
        <div className={card}>
          <p className="text-sm text-muted">Nothing to review. New Delivery Orders and gate passes that can’t be matched automatically will show up here.</p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className={card}>
          <p className="text-sm text-muted">No documents match "{query}".</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredDocs.map((f) => (
            <DocRow key={f.id} f={f} jobs={jobs || []} thumbUrl={thumbUrls?.[f.file_path]}
              checked={selected.has(f.id)} onToggleSelect={() => toggleSelect(f.id)}
              onDownload={download} onDelete={del} onLinked={refresh} onError={setErr} />
          ))}
        </div>
      )}
    </div>
  )
}

function DocRow({ f, jobs, thumbUrl, checked, onToggleSelect, onDownload, onDelete, onLinked, onError }) {
  const [jobId, setJobId] = useState('')
  const [busy, setBusy] = useState(false)
  const touched = useRef(false)

  const suggestion = useMemo(() => bestJobMatch(f, jobs), [f, jobs])

  // Pre-select the suggested job once jobs load, unless the user has chosen.
  useEffect(() => {
    if (!touched.current && suggestion?.job) setJobId(suggestion.job.id)
  }, [suggestion])

  const onPick = (e) => { touched.current = true; setJobId(e.target.value) }

  async function link() {
    if (!jobId) return
    const job = jobs.find((j) => j.id === jobId)
    setBusy(true)
    try {
      await linkDocumentToJob({ attachmentId: f.id, opportunityId: jobId, contactId: job?.contact_id || f.contact_id || null })
      onLinked()
    } catch (e) {
      onError(e.message || String(e))
    } finally { setBusy(false) }
  }

  return (
    <div className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <DocThumb f={f} url={thumbUrl} />
          <div className="min-w-0">
          <button onClick={() => onDownload(f)} className="block max-w-full truncate text-left text-sm font-medium text-ink hover:text-accent">
            {prettyName(f.file_name)}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {f.bl_number ? (
              <span className="rounded bg-accent/15 px-2 py-0.5 font-[family-name:var(--font-mono)] font-semibold text-ink ring-1 ring-inset ring-accent/40">
                BL# {f.bl_number}
              </span>
            ) : (
              <span className="rounded bg-canvas px-2 py-0.5 text-muted">No BL# found — open the file to read it</span>
            )}
            <span className="rounded bg-canvas px-2 py-0.5 text-ink">{kindLabel(f.kind)}</span>
            {kb(f.size_bytes) && <span className="text-muted">{kb(f.size_bytes)}</span>}
            {f.created_at && <span className="text-muted">{fmtDate(f.created_at)}</span>}
          </div>
          {suggestion?.job && (
            <p className="mt-1.5 text-xs text-muted">
              {suggestion.exact ? '✅ Number match' : '💡 Closest job'}:{' '}
              <span className="font-medium text-ink">{jobLabel(suggestion.job)}</span>
              {!suggestion.exact && <span> ({suggestion.score} of {suggestion.total} digits) — please confirm</span>}
            </p>
          )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-muted" title="Select for deletion">
            <input
              type="checkbox"
              checked={!!checked}
              onChange={onToggleSelect}
              className="h-4 w-4 rounded border-line accent-port"
            />
            Select
          </label>
          <select value={jobId} onChange={onPick}
            className="max-w-[18rem] rounded-lg border border-line px-2 py-2 text-sm outline-none focus:border-accent">
            <option value="">Choose the customer / job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {suggestion?.job?.id === j.id ? '⭐ ' : ''}{jobLabel(j)}
              </option>
            ))}
          </select>
          <button className={btnAccent} disabled={busy || !jobId} onClick={link}>{busy ? 'Linking…' : 'Link'}</button>
          <button className={btn} disabled={busy} onClick={() => onDownload(f)}>Download</button>
          <button className={btn + ' text-port'} disabled={busy} onClick={() => onDelete(f)}>Delete</button>
        </div>
      </div>
    </div>
  )
}
