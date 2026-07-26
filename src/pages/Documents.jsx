import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchReviewDocuments, fetchLinkableJobs, linkDocumentToJob,
  signedAttachmentUrl, deleteAttachment,
} from '../lib/supabase'

const card = 'rounded-xl border border-line bg-surface p-5'
const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'

const kindLabel = (k) =>
  k === 'gate_pass' ? 'Gate pass' : k === 'delivery_order' ? 'Delivery Order' : 'Shipping doc'
const kb = (n) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : '')
// Auto-pulled email attachments are stored with URL-encoded names
// ("Delivery%20Order%20...pdf"); show them readable.
const prettyName = (s) => { try { return decodeURIComponent(s) } catch { return s } }
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
  const [err, setErr] = useState('')

  const refresh = () => qc.invalidateQueries({ queryKey: ['reviewDocs'] })

  async function download(f) {
    try { window.open(await signedAttachmentUrl(f.file_path), '_blank', 'noopener') }
    catch (e) { setErr(e.message) }
  }

  async function dismiss(f) {
    if (!confirm(`Delete ${prettyName(f.file_name)}? This removes the file.`)) return
    try { await deleteAttachment({ id: f.id, filePath: f.file_path }); refresh() }
    catch (e) { setErr(e.message || String(e)) }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Documents to review</h1>
        <p className="text-sm text-muted">
          Delivery Orders and gate passes pulled from email that didn’t auto-match a job.
          The closest job is suggested by BL#; confirm it with Link, pick another, or dismiss.
        </p>
      </header>

      {err && <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !docs || docs.length === 0 ? (
        <div className={card}>
          <p className="text-sm text-muted">Nothing to review. New Delivery Orders and gate passes that can’t be matched automatically will show up here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {docs.map((f) => (
            <DocRow key={f.id} f={f} jobs={jobs || []} onDownload={download} onDismiss={dismiss}
              onLinked={refresh} onError={setErr} />
          ))}
        </div>
      )}
    </div>
  )
}

function DocRow({ f, jobs, onDownload, onDismiss, onLinked, onError }) {
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
        <div className="min-w-0">
          <button onClick={() => onDownload(f)} className="block max-w-full truncate text-left text-sm font-medium text-ink hover:text-accent">
            📄 {prettyName(f.file_name)}
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
          </div>
          {suggestion?.job && (
            <p className="mt-1.5 text-xs text-muted">
              {suggestion.exact ? '✅ Number match' : '💡 Closest job'}:{' '}
              <span className="font-medium text-ink">{jobLabel(suggestion.job)}</span>
              {!suggestion.exact && <span> ({suggestion.score} of {suggestion.total} digits) — please confirm</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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
          <button className={btn} disabled={busy} onClick={() => onDismiss(f)}>Dismiss</button>
        </div>
      </div>
    </div>
  )
}
