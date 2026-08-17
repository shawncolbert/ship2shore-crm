import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  searchFmcsaLeads, auditLead, saveLead, fetchSavedLeads, updateLeadStatus, deleteLead, verifyCarrier,
  discoverCompany, fetchCarrierCompliance,
} from '../lib/leadFinder'
import { checkWarmLeads } from '../lib/prospecting'
import { createContactWithBooking } from '../lib/supabase'

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

      <DotVerify />

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

// Loose match, not exact-string -- "ACME TRUCKING" should match a claim of
// "Acme Trucking LLC" or "Acme". Normalizes case/punctuation, then checks
// either name contains the other.
function namesLooselyMatch(claimed, actual) {
  const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
  const c = norm(claimed)
  const a = norm(actual)
  if (!c || !a) return false
  return a.includes(c) || c.includes(a)
}

// Whichever platforms discoverCompany() found, as a compact linked row --
// used under both the verify box and each search result.
function SocialLinksRow({ social }) {
  const items = [
    social?.facebook && { label: 'Facebook', url: social.facebook },
    social?.instagram && { label: 'Instagram', url: social.instagram },
    social?.tiktok && { label: 'TikTok', url: social.tiktok },
    social?.linkedin && { label: 'LinkedIn', url: social.linkedin },
  ].filter(Boolean)

  if (!items.length) return <p className="text-xs text-muted">No social media presence found.</p>
  return (
    <p className="text-xs">
      {items.map((it, i) => (
        <span key={it.label}>
          {i > 0 && ' · '}
          <a href={it.url} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{it.label} ↗</a>
        </span>
      ))}
    </p>
  )
}

// A carrier or driver calls claiming to run under a given DOT # and/or MC #,
// or hands over paperwork with them printed on it -- this checks who FMCSA
// actually has those numbers registered to, so a mismatch (a classic
// double-brokering/identity-theft move in freight) gets caught before a
// load gets handed over to the wrong outfit. Entering both numbers checks
// the stricter thing: that they both point at the very same company, not
// just that each one independently exists somewhere. Deliberately separate
// from the search/save flow below -- this is a quick yes/no check, not lead
// generation.
function DotVerify() {
  const [dotNumber, setDotNumber] = useState('')
  const [mcNumber, setMcNumber] = useState('')
  const [claimedName, setClaimedName] = useState('')
  const [checking, setChecking] = useState(false)
  // undefined = not run yet, null = not found, { carrier, mcMatchesDot } = found
  const [outcome, setOutcome] = useState(undefined)
  const [err, setErr] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState(null)
  const [discoverErr, setDiscoverErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [complianceChecking, setComplianceChecking] = useState(false)
  const [compliance, setCompliance] = useState(null)
  const [complianceErr, setComplianceErr] = useState('')

  const verify = async () => {
    if (!dotNumber.trim() && !mcNumber.trim()) { setErr('Enter a DOT number or an MC number first.'); return }
    setErr(''); setChecking(true); setOutcome(undefined)
    setDiscovered(null); setDiscoverErr(''); setSaved(false)
    setCompliance(null); setComplianceErr('')
    try {
      const { carrier, mcMatchesDot } = await verifyCarrier({ dotNumber: dotNumber.trim() || undefined, mcNumber: mcNumber.trim() || undefined })
      setOutcome(carrier ? { carrier, mcMatchesDot } : null)
    } catch (e) {
      setErr(e.message || 'Could not look up that number.')
    } finally {
      setChecking(false)
    }
  }

  const carrier = outcome?.carrier

  const findOnline = async () => {
    if (!carrier) return
    setDiscoverErr(''); setDiscovering(true)
    try {
      const result = await discoverCompany({ companyName: carrier.legalName || carrier.dbaName, city: carrier.city, state: carrier.state })
      setDiscovered(result)
    } catch (e) {
      setDiscoverErr(e.message || 'Could not search for this company.')
    } finally {
      setDiscovering(false)
    }
  }

  const checkCompliance = async () => {
    if (!carrier?.dotNumber) return
    setComplianceErr(''); setComplianceChecking(true)
    try {
      const result = await fetchCarrierCompliance({ dotNumber: carrier.dotNumber })
      setCompliance(result.carrier)
    } catch (e) {
      setComplianceErr(e.message || 'Could not pull insurance/operating-authority info.')
    } finally {
      setComplianceChecking(false)
    }
  }

  const saveAsLead = async () => {
    if (!carrier) return
    try {
      await saveLead({
        dotNumber: carrier.dotNumber,
        mcNumber: carrier.mcNumbers?.[0] || null,
        legalName: carrier.legalName,
        dbaName: carrier.dbaName,
        phone: carrier.phone,
        city: carrier.city,
        state: carrier.state,
        powerUnits: carrier.powerUnits,
        drivers: carrier.drivers,
        websiteUrl: discovered?.website || null,
        socialLinks: discovered?.social || null,
      })
      setSaved(true)
    } catch (e) {
      alert(e.message || 'Could not save this lead.')
    }
  }
  const match = carrier && claimedName.trim()
    ? namesLooselyMatch(claimedName, carrier.legalName) || namesLooselyMatch(claimedName, carrier.dbaName)
    : null

  const searchedFor = [dotNumber.trim() && `DOT #${dotNumber.trim()}`, mcNumber.trim() && `MC #${mcNumber.trim()}`]
    .filter(Boolean).join(' and ')

  return (
    <div className={`${card} mb-6`}>
      <h2 className={h2}>Verify a DOT or MC number</h2>
      <p className="mb-3 text-sm text-muted">
        Someone claims they're running under a DOT and/or MC number — check who it's actually registered to,
        and whether their operating authority is active, before handing anything over. Pulls straight from
        FMCSA's own lookup system, not the state-search list below.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">DOT number</span>
          <input value={dotNumber} onChange={(e) => setDotNumber(e.target.value)} placeholder="1234567" className={`${input} w-32`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">MC number</span>
          <input value={mcNumber} onChange={(e) => setMcNumber(e.target.value)} placeholder="MC-123456" className={`${input} w-32`} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Name they gave you (optional — checks for a match)</span>
          <input value={claimedName} onChange={(e) => setClaimedName(e.target.value)} placeholder="Acme Trucking" className={`${input} w-64`} />
        </label>
        <button className={btnAccent} disabled={checking} onClick={verify}>
          {checking ? 'Checking…' : 'Verify'}
        </button>
      </div>
      {err && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {err}</p>}

      {outcome === null && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-port">
          ⚠️ No carrier or broker is registered under {searchedFor} — that number's either wrong, or made up.
          Don't take it at face value.
        </p>
      )}

      {carrier && (
        <div className="mt-3 rounded-lg border border-line bg-canvas/50 p-3">
          {match !== null && (
            <p className={`mb-2 text-sm font-semibold ${match ? 'text-emerald-700' : 'text-port'}`}>
              {match ? '✓ Matches the name they gave you' : '⚠️ Does NOT match the name they gave you'}
            </p>
          )}
          {outcome.mcMatchesDot !== null && (
            <p className={`mb-2 text-sm font-semibold ${outcome.mcMatchesDot ? 'text-emerald-700' : 'text-port'}`}>
              {outcome.mcMatchesDot ? '✓ MC number is registered to this DOT number' : "⚠️ That MC number is NOT registered to this DOT number"}
            </p>
          )}
          <p className="text-sm text-ink">
            <span className="font-medium">{carrier.legalName || 'Unnamed company'}</span>
            {carrier.dbaName && carrier.dbaName !== carrier.legalName && <span className="text-muted"> (dba {carrier.dbaName})</span>}
          </p>
          <p className="text-xs text-muted">
            DOT #{carrier.dotNumber}{carrier.mcNumbers?.length > 0 && ` · MC #${carrier.mcNumbers.join(', ')}`}
            {carrier.mcNumbers?.length === 0 && ' · no MC number on file (fine — only for-hire carriers need one)'}
            {' · '}{carrier.city}{carrier.city && carrier.state ? ', ' : ''}{carrier.state}
            {carrier.phone && <> · <a href={`tel:${carrier.phone}`} className="text-accent hover:underline">{carrier.phone}</a></>}
          </p>
          <p className="text-xs text-muted">
            {carrier.powerUnits != null && `${carrier.powerUnits} power units`}
            {carrier.powerUnits != null && carrier.drivers != null && ' · '}
            {carrier.drivers != null && `${carrier.drivers} drivers`}
          </p>
          <p className={`mt-1 text-xs font-medium ${carrier.allowedToOperate ? 'text-emerald-700' : 'text-port'}`}>
            {carrier.allowedToOperate ? '✓ Currently allowed to operate' : '⚠️ NOT currently allowed to operate'}
          </p>

          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <button className={btn} disabled={discovering} onClick={findOnline}>
              {discovering ? 'Searching…' : 'Find website & social media'}
            </button>
            <button className={btn} disabled={saved} onClick={saveAsLead}>{saved ? '✓ Saved as lead' : 'Save as lead'}</button>
            <button className={btn} disabled={complianceChecking} onClick={checkCompliance}>
              {complianceChecking ? 'Checking…' : 'Check insurance & operating authority'}
            </button>
          </div>
          {discoverErr && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {discoverErr}</p>}
          {discovered && (
            <div className="mt-2 space-y-1">
              <p className="text-sm text-ink">
                Website:{' '}
                {discovered.website ? (
                  <a href={discovered.website} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">{discovered.website} ↗</a>
                ) : (
                  <span className="text-muted">not found</span>
                )}
              </p>
              <SocialLinksRow social={discovered.social} />
            </div>
          )}
          {complianceErr && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {complianceErr}</p>}
          {compliance && <ComplianceDetail compliance={compliance} />}
        </div>
      )}
    </div>
  )
}

const money = (n) => n == null ? null : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

// Business info + operating-authority/insurance filings from FMCSA's Motus
// system (fmcsa-insurance.js) -- plain-English, not raw FMCSA field names.
function ComplianceDetail({ compliance }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-canvas/50 p-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Business info (FMCSA registration)</p>
      {compliance.officers?.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-xs text-ink">
          {compliance.officers.map((o, i) => (
            <li key={i}>
              {o.name}{o.title && ` — ${o.title}`}{o.phone && ` · ${o.phone}`}{o.email && ` · ${o.email}`}
            </li>
          ))}
        </ul>
      )}
      {compliance.address && (
        <p className="mb-1 text-xs text-muted">
          {compliance.address.line1}{compliance.address.line2 && `, ${compliance.address.line2}`}
          {compliance.address.city && `, ${compliance.address.city}`}{compliance.address.state && `, ${compliance.address.state}`}
          {compliance.address.zip && ` ${compliance.address.zip}`}
        </p>
      )}
      {compliance.phones?.length > 0 && <p className="mb-1 text-xs text-muted">Phone: {compliance.phones.join(', ')}</p>}
      {compliance.emails?.length > 0 && <p className="mb-1 text-xs text-muted">Email: {compliance.emails.join(', ')}</p>}
      {compliance.outOfService && <p className="mb-1 text-xs font-semibold text-port">⚠️ Marked out of service</p>}

      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Operating authority</p>
      {compliance.operatingAuthorities?.length > 0 ? (
        <ul className="mb-2 space-y-0.5 text-sm text-ink">
          {compliance.operatingAuthorities.map((a, i) => (
            <li key={i}>
              {a.docketNumber && <span className="font-medium">{a.docketNumber}</span>}
              {a.status && <span className={a.status.toLowerCase() === 'active' ? ' text-emerald-700' : ' text-port'}> — {a.status}</span>}
              {a.type && <span className="text-muted"> · {a.type}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-muted">No operating authority on file for this DOT number.</p>
      )}

      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Insurance on file</p>
      {compliance.insuranceFilings?.length > 0 ? (
        <ul className="space-y-1 text-sm text-ink">
          {compliance.insuranceFilings.map((f, i) => (
            <li key={i}>
              {f.insurerName ? <span className="font-medium">{f.insurerName}</span> : <span className="italic text-muted">Insurer name not on file</span>}
              {' — '}Policy <span className="font-medium">{f.policyNumber}</span>
              {f.coverageAmount != null && <> — {money(f.coverageAmount)} coverage</>}
              {f.receivedDate && <span className="text-muted"> · filed {f.receivedDate}</span>}
              {f.effectiveDate && <span className="text-muted">, effective {f.effectiveDate}</span>}
              {f.cancellationDate && <span className="font-medium text-port"> · CANCELLED {f.cancellationDate}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-xs text-muted">No insurance filings came back for this DOT number.</p>
      )}

      <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Process agent (BOC-3)</p>
      {compliance.processAgents?.length > 0 ? (
        <ul className="space-y-0.5 text-sm text-ink">
          {compliance.processAgents.map((a, i) => (
            <li key={i}>
              {a.name ? <span className="font-medium">{a.name}</span> : <span className="italic text-muted">Agent name not on file</span>}
              {a.receivedDate && <span className="text-muted"> · filed {a.receivedDate}</span>}
              {a.cancellationDate && <span className="font-medium text-port"> · CANCELLED {a.cancellationDate}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No process agent filing came back for this DOT number.</p>
      )}
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
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered] = useState(null)
  const [discoverErr, setDiscoverErr] = useState('')

  const findOnline = async () => {
    setDiscoverErr(''); setDiscovering(true)
    try {
      const result = await discoverCompany({ companyName: lead.legalName || lead.dbaName, city: lead.city, state: lead.state })
      setDiscovered(result)
      if (result.website && !websiteUrl.trim()) setWebsiteUrl(result.website)
    } catch (e) {
      setDiscoverErr(e.message || 'Could not search for this company.')
    } finally {
      setDiscovering(false)
    }
  }

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
        socialLinks: discovered?.social || null,
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
            DOT #{lead.dotNumber}{lead.mcNumber && ` · MC #${lead.mcNumber}`} · {lead.city}{lead.city && lead.state ? ', ' : ''}{lead.state}
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
        <button className={btn} disabled={discovering} onClick={findOnline}>
          {discovering ? 'Searching…' : 'Find website & social media'}
        </button>
      </div>
      {discoverErr && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {discoverErr}</p>}
      {discovered && <div className="mt-2"><SocialLinksRow social={discovered.social} /></div>}

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
  const [addingId, setAddingId] = useState(null)

  const setStatus = async (id, status) => {
    await updateLeadStatus(id, status)
    qc.invalidateQueries({ queryKey: ['fmcsaLeads'] })
  }

  const remove = async (l) => {
    if (!confirm(`Remove ${l.legal_name || l.dba_name || 'this lead'} from your saved list?`)) return
    await deleteLead(l.id)
    qc.invalidateQueries({ queryKey: ['fmcsaLeads'] })
  }

  // Separate from the "Added to Contacts" status label above -- that was
  // just a note to yourself; this actually creates the Contacts record,
  // pre-filled from what FMCSA/the audit already found (name, phone, email).
  // No booking/pipeline card -- just the contact, same as clicking "+ New
  // contact" and typing it in by hand.
  const addToContacts = async (l) => {
    setAddingId(l.id)
    try {
      await createContactWithBooking({
        contact: {
          full_name: l.legal_name || l.dba_name || 'Unnamed company',
          company: (l.dba_name && l.dba_name !== l.legal_name) ? l.dba_name : null,
          phone: l.phone || '',
          email: l.contact_email || '',
          segment: /broker/i.test(l.entity_type || '') ? 'broker' : 'transporter',
        },
        booking: null,
      })
      await setStatus(l.id, 'added_to_contacts')
    } catch (e) {
      const msg = /duplicate key/i.test(e.message || '')
        ? 'Looks like this is already in your Contacts (matching phone or email).'
        : (e.message || 'Could not add this lead to Contacts.')
      alert(msg)
    } finally {
      setAddingId(null)
    }
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
                  DOT #{l.dot_number}{l.mc_number && ` · MC #${l.mc_number}`} · {l.city}{l.city && l.state ? ', ' : ''}{l.state}
                  {l.website_url && <> · <a href={/^https?:\/\//i.test(l.website_url) ? l.website_url : `https://${l.website_url}`} target="_blank" rel="noreferrer" className="text-accent hover:underline">website ↗</a></>}
                  {l.contact_email && <> · <a href={`mailto:${l.contact_email}`} className="text-accent hover:underline">{l.contact_email}</a></>}
                </div>
                {l.social_links && Object.values(l.social_links).some(Boolean) && (
                  <div className="mt-0.5"><SocialLinksRow social={l.social_links} /></div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  value={l.status}
                  onChange={(e) => setStatus(l.id, e.target.value)}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                >
                  {Object.entries(STATUS_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
                <button
                  onClick={() => addToContacts(l)}
                  disabled={addingId === l.id}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-xs font-medium text-ink hover:bg-canvas disabled:opacity-50"
                >
                  {addingId === l.id ? 'Adding…' : l.status === 'added_to_contacts' ? '✓ In Contacts' : '+ Add to Contacts'}
                </button>
                <button onClick={() => remove(l)} title="Remove" className="rounded p-1 text-muted hover:bg-red-50 hover:text-red-500">🗑️</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
