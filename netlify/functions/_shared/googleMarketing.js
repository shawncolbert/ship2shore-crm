// Google Search Console + Analytics helpers -- same refresh-and-cache shape
// as orgGoogleAccessToken() in _shared/google.js, but a separate OAuth
// connection (google_marketing_tokens, not gmail_oauth_tokens) and separate
// scopes (webmasters.readonly + analytics.readonly, not gmail.send). Kept
// apart deliberately: an org connecting "SEO & Traffic" shouldn't have to
// also hand over Gmail access, and vice versa.

export async function orgGoogleMarketingToken(orgId, admin) {
  const { data: row, error } = await admin.from('google_marketing_tokens').select('*').eq('org_id', orgId).maybeSingle()
  if (error || !row) throw new Error('No Google Search Console/Analytics connection for this org -- go to Settings > SEO & Traffic and click Connect.')

  const expired = !row.token_expiry || new Date(row.token_expiry) <= new Date()
  if (!expired) return { accessToken: row.access_token, row }

  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: row.refresh_token,
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const data = await r.json()
  if (!r.ok || !data.access_token) throw new Error('google marketing token refresh: ' + JSON.stringify(data))

  await admin.from('google_marketing_tokens').update({
    access_token: data.access_token,
    token_expiry: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', row.id)

  return { accessToken: data.access_token, row: { ...row, access_token: data.access_token } }
}

// Search Console's "sites" the connected Google account can see -- includes
// ones they only have partial/unverified access to, so callers should show
// permissionLevel alongside each in case one shows up read-only.
export async function listSearchConsoleSites(accessToken) {
  const r = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error('Search Console sites: ' + (await r.text()))
  const data = await r.json()
  return (data.siteEntry || []).map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }))
}

// GA4 properties via the Admin API's account summaries -- one call returns
// every account the connected user can see, each with its properties
// nested underneath, instead of listing accounts then properties separately.
export async function listGa4Properties(accessToken) {
  const r = await fetch('https://analyticsadmin.googleapis.com/v1beta/accountSummaries', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!r.ok) throw new Error('GA4 account summaries: ' + (await r.text()))
  const data = await r.json()
  const properties = []
  for (const account of data.accountSummaries || []) {
    for (const p of account.propertySummaries || []) {
      properties.push({ propertyId: p.property, displayName: `${p.displayName} (${account.displayName})` })
    }
  }
  return properties
}

// Search Console's Search Analytics API only returns confirmed data through
// a few days ago -- pulling the last 3 days every sync (not just
// "yesterday") means a sync that missed a day, or ran before GSC finished
// processing a date, still catches up on the next run instead of leaving a
// permanent gap.
export async function fetchSearchPerformance(accessToken, siteUrl) {
  const end = new Date()
  const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000)
  const fmt = (d) => d.toISOString().slice(0, 10)
  const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: fmt(start),
      endDate: fmt(end),
      dimensions: ['date', 'query'],
      rowLimit: 1000,
    }),
  })
  if (!r.ok) throw new Error('Search Console query: ' + (await r.text()))
  const data = await r.json()
  return (data.rows || []).map((row) => ({
    date: row.keys[0],
    query: row.keys[1],
    clicks: row.clicks,
    impressions: row.impressions,
    position: row.position,
  }))
}

// Same 3-day trailing window as fetchSearchPerformance, and for the same
// reason -- GA4's own data can lag a day before it's queryable.
export async function fetchSiteAnalytics(accessToken, propertyId) {
  const r = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dateRanges: [{ startDate: '3daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }, { name: 'pagePath' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }],
      limit: 1000,
    }),
  })
  if (!r.ok) throw new Error('GA4 runReport: ' + (await r.text()))
  const data = await r.json()
  return (data.rows || []).map((row) => ({
    // GA4 dates come back as YYYYMMDD with no separators.
    date: `${row.dimensionValues[0].value.slice(0, 4)}-${row.dimensionValues[0].value.slice(4, 6)}-${row.dimensionValues[0].value.slice(6, 8)}`,
    page_path: row.dimensionValues[1].value,
    sessions: Number(row.metricValues[0].value),
    active_users: Number(row.metricValues[1].value),
    pageviews: Number(row.metricValues[2].value),
  }))
}
