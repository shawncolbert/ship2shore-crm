import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  searchFmcsaLeads, auditLead, saveLead, fetchSavedLeads, updateLeadStatus, deleteLead,
} from '../lib/leadFinder'
import { checkWarmLeads } from '../lib/prospecting'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const btn = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas'
const btnAccent = 'inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const h2 = 'mb-3 text-xs font-semibold uppercase tracking-wide text-muted'
const input = 'rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent'

const STATUS_LABELS = { new: 'New', contacted: 'Contacted', added_to_contacts: 'Added to Contacts', dismissed: 'Dismissed' }
const PAGE_SIZE = 50

export default function LeadFinder() {
  const [state, setState] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [cargoKeyword, setCargoKeyword] = useState('')
  const [searching, setSearching] = useState(false)
  const [leads, setLeads] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')

  const runSearch = async (pageNum) => {
    if (!state.trim() && !companyName.trim()) { setErr('Enter a state or a company name first.'); return }
    setErr(''); setSearching(true)
    try {
      const { leads: results, hasMore: more } = await searchFmcsaLeads({
        state: state.trim() || undefined,
        companyName: companyName.trim() || undefined,
        cargoKeyword: cargoKeyword.trim() || undefined,
        limit: PAGE_SIZE,
        offset: pageNum * PAGE_SIZE,
      })
      setLeads(results)
      setHasMore(more)
      setPage(pageNum)
    } catch (e) {
      setErr(e.message || 'Could not search FMCSA.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Lead Finder</h1>
        <p className="text-sm text-muted">
          Pull carriers and brokers straight from FMCSA's public registry, then have Claude read their
          website and draft a personalized cold outreach email.
        </p>
      </header>

      <div className={`${card} mb-6`}>
        <h2 className={h2}>Search FMCSA</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">State</span>
            <input value={state} onChange={(e) => setState(e.target.value.toUpperCase())} placeholder="CA" maxLength={2} className={`${input} w-20 uppercase`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Company name — e.g. a carrier gave you their name and you want their DOT #</span>
            <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Trucking" className={`${input} w-64`} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Cargo keyword (optional — try "Motor Vehicles" for car haulers)</span>
            <input value={cargoKeyword} onChange={(e) => setCargoKeyword(e.target.value)} placeholder="Motor Vehicles" className={`${input} w-56`} />
          </label>
          <button className={btnAccent} disabled={searching} onClick={() => runSearch(0)}>
            {searching ? 'Searching…' : 'Search FMCSA'}
          </button>
        </div>
        {err && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}
        <p className="mt-2 text-xs text-muted">
          State and company name can be used together or on their own — enter just a company name to look
          up its DOT number without knowing the state. FMCSA doesn't publish websites or emails — add a
          website URL per result below to run an audit. If a search errors out, the field name it names is
          the one that needs fixing (see the comment at the top of{' '}
          <span className="font-[family-name:var(--font-mono)]">fmcsa-search.js</span>).
        </p>
      </div>

      {leads && (
        <div className={`${card} mb-6`}>
          <h2 className={h2}>Results {leads.length ? `(page ${page + 1})` : ''}</h2>
          {leads.length === 0 ? (
            <p className="text-sm text-muted">No results for that search{page > 0 ? ' — try a previous page.' : '.'}</p>
          ) : (
            <div className="space-y-3">
              {leads.map((l) => (
                <LeadRow key={l.dotNumber} lead={l} />
              ))}
            </div>
          )}
          {(page > 0 || hasMore) && (
            <div className="mt-4 flex items-center justify-between">
              <button className={btn} disabled={page === 0 || searching} onClick={() => runSearch(page - 1)}>
                ← Previous
              </button>
              <span className="text-xs text-muted">Page {page + 1}</span>
              <button className={btn} disabled={!hasMore || searching} onClick={() => runSearch(page + 1)}>
                Next →
              </button>
            </div>
          )}
        </div>
      )}

      <SavedLeads />
    </div>
  )
}

function LeadRow({ lead }) {
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [auditing, setAuditing] = useState(false)
  const [audit, setAudit] = useState(null)
  const [auditErr, setAuditErr] = useState('')
  const [checking, setChecking] = useState(false)
  const [warmMatch, setWarmMatch] = useState(null)
  const [saved, setSaved] = useState(false)

  const runAudit = async () => {
    if (!websiteUrl.trim()) { setAuditErr('Enter a website URL first.'); return }
    setAuditErr(''); setAuditing(true)
    try {
      const result = await auditLead({ websiteUrl: websiteUrl.trim(), companyName: lead.legalName || lead.dbaName })
      setAudit(result)
    } catch (e) {
      setAuditErr(e.message || 'Could not audit that site.')
    } finally {
      setAuditing(false)
    }
  }

  const checkContacts = async () => {
    setChecking(true)
    try {
      const [result] = await checkWarmLeads([{ name: lead.legalName || lead.dbaName, phone: lead.phone, email: '' }])
      setWarmMatch(result?.matches?.[0] || null)
    } finally {
      setChecking(false)
    }
  }

  const save = async () => {
    try {
      await saveLead({
        ...lead,
        websiteUrl: websiteUrl.trim() || null,
        siteNotes: audit?.bottlenecks?.join('; ') || null,
        pitchEmail: audit?.pitchEmail || null,
        contactEmail: audit?.emails?.[0] || null,
      })
      setSaved(true)
    } catch (e) {
      alert(e.message || 'Could not save this lead.')
    }
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-ink">{lead.legalName || lead.dbaName || 'Unnamed company'}</div>
          <div className="text-xs text-muted">
            DOT #{lead.dotNumber} · {lead.city}{lead.city && lead.state ? ', ' : ''}{lead.state}
            {lead.phone && <> · <a href={`tel:${lead.phone}`} className="text-accent hover:underline">{lead.phone}</a></>}
          </div>
          <div className="text-xs text-muted">
            {lead.powerUnits != null && `${lead.powerUnits} power units`}
            {lead.powerUnits != null && lead.drivers != null && ' · '}
            {lead.drivers != null && `${lead.drivers} drivers`}
            {lead.cargoClassification && ` · ${lead.cargoClassification}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="text-xs font-semibold text-accent hover:underline" disabled={checking} onClick={checkContacts}>
            {checking ? 'Checking…' : 'Check against my contacts'}
          </button>
          <button className={btn} disabled={saved} onClick={save}>{saved ? '✓ Saved' : 'Save'}</button>
        </div>
      </div>

      {warmMatch && (
        <p className="mt-2 rounded-md bg-accent/10 px-3 py-2 text-xs text-ink">
          🔥 Already in your contacts ({warmMatch.match_reason}) —{' '}
          <Link to={`/contacts/${warmMatch.contact_id}`} className="font-semibold text-accent hover:underline">
            {warmMatch.contact_name}
          </Link>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="company-website.com"
          className={`${input} w-64`}
        />
        <button className={btn} disabled={auditing} onClick={runAudit}>
          {auditing ? 'Auditing…' : 'Audit & draft pitch'}
        </button>
      </div>
      {auditErr && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {auditErr}</p>}

      {audit && (
        <div className="mt-3 rounded-lg border border-line bg-canvas/50 p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Email found on site</p>
          {audit.emails?.length > 0 ? (
            <p className="mb-3 text-sm text-ink">
              {audit.emails.map((e, i) => (
                <span key={e}>
                  {i > 0 && ', '}
                  <a href={`mailto:${e}`} className="text-accent hover:underline">{e}</a>
                </span>
              ))}
            </p>
          ) : (
            <p className="mb-3 text-sm text-muted">None found on the homepage or an obvious contact page — try the pitch email as a starting point and hunt manually, or check a different page on their site.</p>
          )}
          {audit.bottlenecks.length > 0 && (
            <>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">What Claude noticed</p>
              <ul className="mb-3 list-disc space-y-0.5 pl-4 text-sm text-ink">
                {audit.bottlenecks.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </>
          )}
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Draft pitch email</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{audit.pitchEmail}</p>
        </div>
      )}
    </div>
  )
}

function SavedLeads() {
  const qc = useQueryClient()
  const { data: saved, isLoading } = useQuery({ queryKey: ['fmcsaLeads'], queryFn: fetchSavedLeads })

  const setStatus = async (id, status) => {
    await updateLeadStatus(id, status)
    qc.invalidateQueries({ queryKey: ['fmcsaLeads'] })
  }

  const remove = async (l) => {
    if (!confirm(`Remove ${l.legal_name || l.dba_name || 'this lead'} from your saved list?`)) return
    await deleteLead(l.id)
    qc.invalidateQueries({ queryKey: ['fmcsaLeads'] })
  }

  return (
    <div className={card}>
      <h2 className={h2}>Saved leads{saved ? ` (${saved.length})` : ''}</h2>
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !saved?.length ? (
        <p className="text-sm text-muted">Nothing saved yet — search FMCSA above and click "Save" on any lead worth tracking.</p>
      ) : (
        <ul className="divide-y divide-line">
          {saved.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-ink">{l.legal_name || l.dba_name || 'Unnamed company'}</div>
                <div className="text-xs text-muted">
                  DOT #{l.dot_number} · {l.city}{l.city && l.state ? ', ' : ''}{l.state}
                  {l.website_url && <> · <a href={/^https?:\/\//i.test(l.website_url) ? l.website_url : `https://${l.website_url}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">website ↗</a></>}
                  {l.contact_email && <> · <a href={`mailto:${l.contact_email}`} className="text-accent hover:underline">{l.contact_email}</a></>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={l.status}
                  onChange={(e) => setStatus(l.id, e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                >
                  {Object.entries(STATUS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <button onClick={() => remove(l)} title="Remove" className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500">🗑️</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
