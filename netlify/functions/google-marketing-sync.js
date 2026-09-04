import { admin } from './_shared/supabaseAdmin.js'
import { orgGoogleMarketingToken, fetchSearchPerformance, fetchSiteAnalytics } from './_shared/googleMarketing.js'

// Scheduled (see netlify.toml) -- pulls the last few days of Search Console
// + GA4 data for every org that's connected AND picked a site/property, and
// upserts into search_performance / site_analytics. Both tables already
// have a (org_id, date, query|page_path) unique constraint, so re-syncing
// an already-synced day just overwrites it with the latest numbers instead
// of duplicating rows -- safe to run daily even though each pull covers a
// trailing 3-day window.
export const handler = async () => {
  const { data: orgs, error } = await admin
    .from('google_marketing_tokens')
    .select('org_id, gsc_site_url, ga4_property_id')
  if (error) {
    console.error('❌ google-marketing-sync: could not list connected orgs:', error)
    return { statusCode: 500, body: error.message }
  }

  const results = []
  for (const { org_id: orgId, gsc_site_url: gscSiteUrl, ga4_property_id: ga4Property } of orgs) {
    if (!gscSiteUrl && !ga4Property) continue // connected but hasn't picked a site/property yet

    let accessToken
    try {
      ;({ accessToken } = await orgGoogleMarketingToken(orgId, admin))
    } catch (e) {
      console.error(`❌ google-marketing-sync: token refresh failed for org ${orgId}:`, e)
      results.push({ orgId, ok: false, reason: 'token refresh failed' })
      continue
    }

    if (gscSiteUrl) {
      try {
        const rows = await fetchSearchPerformance(accessToken, gscSiteUrl)
        if (rows.length) {
          await admin.from('search_performance').upsert(
            rows.map((r) => ({ org_id: orgId, ...r })),
            { onConflict: 'org_id,date,query' },
          )
        }
      } catch (e) {
        console.error(`❌ google-marketing-sync: Search Console pull failed for org ${orgId}:`, e)
      }
    }

    if (ga4Property) {
      try {
        const rows = await fetchSiteAnalytics(accessToken, ga4Property)
        if (rows.length) {
          await admin.from('site_analytics').upsert(
            rows.map((r) => ({ org_id: orgId, ...r })),
            { onConflict: 'org_id,date,page_path' },
          )
        }
      } catch (e) {
        console.error(`❌ google-marketing-sync: GA4 pull failed for org ${orgId}:`, e)
      }
    }

    results.push({ orgId, ok: true })
  }

  return { statusCode: 200, body: JSON.stringify({ synced: results.length }) }
}
