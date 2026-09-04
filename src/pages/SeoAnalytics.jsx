import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, fetchSearchPerformance, fetchSiteAnalytics } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const field = 'mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

async function authedFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${session?.access_token || ''}` } })
}

// Rolls the daily rows google-marketing-sync.js writes up into "top N over
// the whole window" -- the raw per-day rows aren't what anyone wants to look
// at, they want "what are people searching, what pages get traffic."
function topQueries(rows, limit = 15) {
  const byQuery = new Map()
  for (const r of rows || []) {
    const cur = byQuery.get(r.query) || { query: r.query, clicks: 0, impressions: 0, positionSum: 0, days: 0 }
    cur.clicks += r.clicks
    cur.impressions += r.impressions
    cur.positionSum += r.position * (r.impressions || 1)
    cur.days += r.impressions || 1
    byQuery.set(r.query, cur)
  }
  return [...byQuery.values()]
    .map((q) => ({ ...q, avgPosition: q.days ? q.positionSum / q.days : null }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit)
}

function topPages(rows, limit = 15) {
  const byPage = new Map()
  for (const r of rows || []) {
    const cur = byPage.get(r.page_path) || { page_path: r.page_path, sessions: 0, pageviews: 0, active_users: 0 }
    cur.sessions += r.sessions
    cur.pageviews += r.pageviews
    cur.active_users += r.active_users
    byPage.set(r.page_path, cur)
  }
  return [...byPage.values()].sort((a, b) => b.sessions - a.sessions).slice(0, limit)
}

export default function SeoAnalytics() {
  const qc = useQueryClient()
  const [connecting, setConnecting] = useState(false)
  const [notice, setNotice] = useState(null)
  const [savingPicks, setSavingPicks] = useState(false)
  const [pickedSite, setPickedSite] = useState('')
  const [pickedProperty, setPickedProperty] = useState('')

  const { data: status } = useQuery({
    queryKey: ['googleMarketingStatus'],
    queryFn: async () => {
      const res = await authedFetch('/.netlify/functions/google-marketing-status')
      if (!res.ok) return { connected: false }
      return res.json()
    },
    staleTime: 60 * 1000,
  })

  const { data: props } = useQuery({
    queryKey: ['googleMarketingProperties'],
    queryFn: async () => {
      const res = await authedFetch('/.netlify/functions/google-marketing-properties')
      if (!res.ok) return { sites: [], properties: [] }
      return res.json()
    },
    enabled: !!status?.connected,
  })

  useEffect(() => {
    if (status?.gscSiteUrl) setPickedSite(status.gscSiteUrl)
    if (status?.ga4PropertyId) setPickedProperty(status.ga4PropertyId)
  }, [status?.gscSiteUrl, status?.ga4PropertyId])

  // Landed back here after Google's consent screen (see google-marketing-oauth-callback.js).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('google')
    if (!result) return
    if (result === 'connected') setNotice({ type: 'success', text: 'Google account connected -- now pick which site and property to pull data from below.' })
    else setNotice({ type: 'error', text: params.get('msg') || 'Could not connect.' })
    qc.invalidateQueries({ queryKey: ['googleMarketingStatus'] })
    window.history.replaceState({}, '', window.location.pathname)
  }, [qc])

  const hasPicks = !!(status?.gscSiteUrl || status?.ga4PropertyId)
  const { data: searchRows } = useQuery({
    queryKey: ['searchPerformance'],
    queryFn: () => fetchSearchPerformance(30),
    enabled: hasPicks,
  })
  const { data: trafficRows } = useQuery({
    queryKey: ['siteAnalytics'],
    queryFn: () => fetchSiteAnalytics(30),
    enabled: hasPicks,
  })

  const queries = useMemo(() => topQueries(searchRows), [searchRows])
  const pages = useMemo(() => topPages(trafficRows), [trafficRows])

  const handleConnect = async () => {
    setConnecting(true)
    try {
      const res = await authedFetch('/.netlify/functions/google-marketing-oauth-start')
      const data = await res.json()
      if (!res.ok) { setNotice({ type: 'error', text: data.error || 'Could not start connection.' }); return }
      window.location.href = data.authorize_url
    } finally {
      setConnecting(false)
    }
  }

  const savePicks = async () => {
    setSavingPicks(true)
    try {
      const res = await authedFetch('/.netlify/functions/google-marketing-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gscSiteUrl: pickedSite, ga4PropertyId: pickedProperty }),
      })
      const data = await res.json()
      if (!res.ok) { setNotice({ type: 'error', text: data.error || 'Could not save.' }); return }
      setNotice({ type: 'success', text: 'Saved -- the next sync (once a day) will start pulling this site\'s data.' })
      qc.invalidateQueries({ queryKey: ['googleMarketingStatus'] })
    } finally {
      setSavingPicks(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">SEO &amp; Traffic</h1>
        <p className="max-w-xl text-sm text-muted">
          Free — pulls straight from your own Google Search Console (what people search to find you) and
          Google Analytics (which pages actually get visited). No third-party SEO tool needed for this.
        </p>
      </header>

      {notice && (
        <div className={`${card} mb-4 text-sm ${notice.type === 'error' ? 'text-port' : 'text-ink'}`}>
          {notice.text}
        </div>
      )}

      {!status?.connected && (
        <div className={card}>
          <p className="mb-3 text-sm text-ink">
            Connect the Google account that already has your site set up in Search Console and Analytics.
          </p>
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {connecting ? 'Redirecting…' : status?.needsReconnect ? 'Reconnect Google' : 'Connect Google Search Console & Analytics'}
          </button>
          {status?.needsReconnect && (
            <p className="mt-2 text-xs text-port">
              The connection stopped working{status.email ? ` (${status.email})` : ''} -- Google likely revoked it. Reconnect to pick back up.
            </p>
          )}
        </div>
      )}

      {status?.connected && (
        <div className={`${card} mb-4`}>
          <p className="mb-3 text-sm text-ink">
            Connected as <strong>{status.email || 'your Google account'}</strong>. Pick which site and property to pull numbers from:
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-ink">Search Console site</span>
              <select value={pickedSite} onChange={(e) => setPickedSite(e.target.value)} className={field}>
                <option value="">— not set —</option>
                {(props?.sites || []).map((s) => (
                  <option key={s.siteUrl} value={s.siteUrl}>{s.siteUrl}</option>
                ))}
              </select>
              {props?.sitesError && <span className="mt-1 block text-xs text-port">{props.sitesError}</span>}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink">Analytics (GA4) property</span>
              <select value={pickedProperty} onChange={(e) => setPickedProperty(e.target.value)} className={field}>
                <option value="">— not set —</option>
                {(props?.properties || []).map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>{p.displayName}</option>
                ))}
              </select>
              {props?.propertiesError && <span className="mt-1 block text-xs text-port">{props.propertiesError}</span>}
            </label>
          </div>
          <button
            onClick={savePicks}
            disabled={savingPicks}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {savingPicks ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {hasPicks && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-ink">Top search queries (last 30 days)</h2>
            {!searchRows?.length ? (
              <p className="text-sm text-muted">No data synced yet -- the daily sync hasn't run, or Search Console hasn't processed data for this site yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2">Query</th>
                    <th className="pb-2 text-right">Clicks</th>
                    <th className="pb-2 text-right">Impressions</th>
                    <th className="pb-2 text-right">Avg. position</th>
                  </tr>
                </thead>
                <tbody>
                  {queries.map((q) => (
                    <tr key={q.query} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-ink">{q.query}</td>
                      <td className="py-1.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{q.clicks}</td>
                      <td className="py-1.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-muted">{q.impressions}</td>
                      <td className="py-1.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-muted">{q.avgPosition?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className={card}>
            <h2 className="mb-3 text-sm font-semibold text-ink">Top pages by traffic (last 30 days)</h2>
            {!trafficRows?.length ? (
              <p className="text-sm text-muted">No data synced yet -- the daily sync hasn't run, or Analytics hasn't processed data for this property yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-2">Page</th>
                    <th className="pb-2 text-right">Sessions</th>
                    <th className="pb-2 text-right">Visitors</th>
                    <th className="pb-2 text-right">Pageviews</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p) => (
                    <tr key={p.page_path} className="border-t border-line">
                      <td className="py-1.5 pr-2 text-ink">{p.page_path}</td>
                      <td className="py-1.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-ink">{p.sessions}</td>
                      <td className="py-1.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-muted">{p.active_users}</td>
                      <td className="py-1.5 text-right font-[family-name:var(--font-mono)] tabular-nums text-muted">{p.pageviews}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
