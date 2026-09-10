import { admin } from './_shared/supabaseAdmin.js'

// Scheduled (see netlify.toml), runs after google-marketing-sync.js each
// day. Flags "striking distance" keywords -- queries an org already ranks
// for at position 6-15 (page two) with enough real search volume that
// improving the page is likely to move them onto page one, as opposed to a
// position-40 query that needs a different strategy entirely.
//
// Position is impression-weighted (sum(position*impressions)/sum(impressions))
// over a trailing window rather than the average of daily positions, so a
// handful of low-traffic days can't skew the number as much as the days
// that actually carried the volume. The window is 28 days, not a single
// day's figure -- GSC position for a low-volume query swings noisily day to
// day, and a one-day snapshot would flag (and un-flag) keywords on noise.
//
// No hardcoded "high intent" keyword list here on purpose -- this CRM is
// multi-tenant, and a topic list tuned for one org's business wouldn't mean
// anything for another's. MIN_IMPRESSIONS is the stand-in for intent: a
// query with real impression volume that isn't converting to a top-5
// ranking is worth a look regardless of what business the org is in.
const WINDOW_DAYS = 28
const MIN_IMPRESSIONS = 10
const BAND_LOW = 6
const BAND_HIGH = 15

export const handler = async () => {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10)

  const { data: rows, error } = await admin
    .from('search_performance')
    .select('org_id, query, clicks, impressions, position')
    .gte('date', since)
  if (error) {
    console.error('❌ seo-striking-distance: could not read search_performance:', error)
    return { statusCode: 500, body: error.message }
  }

  const byKey = new Map()
  for (const r of rows) {
    const key = `${r.org_id}::${r.query}`
    const agg = byKey.get(key) || { orgId: r.org_id, query: r.query, clicks: 0, impressions: 0, weightedPosition: 0 }
    agg.clicks += r.clicks || 0
    agg.impressions += r.impressions || 0
    agg.weightedPosition += (r.position || 0) * (r.impressions || 0)
    byKey.set(key, agg)
  }

  const inBand = []
  const inBandKeys = new Set()
  for (const agg of byKey.values()) {
    if (agg.impressions < MIN_IMPRESSIONS) continue
    const avgPosition = agg.weightedPosition / agg.impressions
    if (avgPosition < BAND_LOW || avgPosition > BAND_HIGH) continue
    inBand.push({
      org_id: agg.orgId,
      query: agg.query,
      avg_position: Math.round(avgPosition * 100) / 100,
      window_impressions: agg.impressions,
      window_clicks: agg.clicks,
      window_days: WINDOW_DAYS,
      last_computed_at: new Date().toISOString(),
    })
    inBandKeys.add(`${agg.orgId}::${agg.query}`)
  }

  if (inBand.length) {
    // No `status` field in the upsert payload -- Supabase only writes the
    // columns it's given, so an existing row's status ('acknowledged' /
    // 'dismissed' / 'resolved') is left untouched here. New rows fall back
    // to the column default ('new'). The reconciliation pass below is what
    // brings a stale 'resolved' row back to 'new' if it re-enters the band.
    const { error: upsertError } = await admin
      .from('seo_keyword_alerts')
      .upsert(inBand, { onConflict: 'org_id,query' })
    if (upsertError) {
      console.error('❌ seo-striking-distance: upsert failed:', upsertError)
      return { statusCode: 500, body: upsertError.message }
    }
  }

  // Reconcile status against this run's in-band set. 'dismissed' is a
  // human's call and is deliberately excluded -- never touched here.
  const { data: existing, error: existingError } = await admin
    .from('seo_keyword_alerts')
    .select('id, org_id, query, status')
    .in('status', ['new', 'acknowledged', 'resolved'])
  if (existingError) {
    console.error('❌ seo-striking-distance: could not read existing alerts:', existingError)
    return { statusCode: 500, body: existingError.message }
  }

  const toResolve = []
  const toReflag = []
  for (const row of existing) {
    const stillInBand = inBandKeys.has(`${row.org_id}::${row.query}`)
    if (!stillInBand && row.status !== 'resolved') toResolve.push(row.id)
    if (stillInBand && row.status === 'resolved') toReflag.push(row.id)
  }
  if (toResolve.length) await admin.from('seo_keyword_alerts').update({ status: 'resolved' }).in('id', toResolve)
  if (toReflag.length) await admin.from('seo_keyword_alerts').update({ status: 'new' }).in('id', toReflag)

  return { statusCode: 200, body: JSON.stringify({ flagged: inBand.length, resolved: toResolve.length, reflagged: toReflag.length }) }
}
