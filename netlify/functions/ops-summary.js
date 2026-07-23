import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// ops-summary — read-only pipeline snapshot for the Claude Ops Center HUD.
//
// Standalone, additive endpoint. It does NOT touch the dispatch app: it only
// READS aggregates from Supabase using the service key (server-side only) and
// returns a small JSON summary. Scoped to a single org via ORG_ID.
//
// Auth: gated by a shared token. Set OPS_SUMMARY_TOKEN in Netlify env, then
// call with ?key=<that token>. If the env var is missing the endpoint refuses
// to serve (fail closed) so business data is never accidentally public.
//
// The Supabase client is built lazily inside the handler so a missing env var
// returns a clean JSON error instead of crashing the function at load time.
// ---------------------------------------------------------------------------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
  body: JSON.stringify(body),
})

const money = (n) => Math.round(Number(n || 0) * 100) / 100
const nameOf = (o) => o.contacts?.full_name || o.contacts?.company || o.title || 'Job'
const trim = (o) => ({
  name: nameOf(o),
  value: money(o.value),
  port: o.port || null,
  billing_number: o.billing_number || null,
})

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' }
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET only' })

  const expected = process.env.OPS_SUMMARY_TOKEN
  if (!expected) return json(503, { error: 'ops-summary not configured (set OPS_SUMMARY_TOKEN)' })
  const key = event.queryStringParameters?.key || ''
  if (key !== expected) return json(401, { error: 'Unauthorized' })

  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  const org = process.env.ORG_ID
  if (!url || !serviceKey) return json(500, { error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_KEY' })
  if (!org) return json(500, { error: 'Missing ORG_ID' })

  // Service-role client — bypasses RLS. Only ever runs server-side.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  try {
    // Default pipeline stages (for stage-by-stage counts, in board order).
    const { data: pipeline } = await admin
      .from('pipelines').select('id').eq('org_id', org).eq('is_default', true).limit(1).maybeSingle()

    let stages = []
    if (pipeline) {
      const { data } = await admin
        .from('stages').select('id, name, position')
        .eq('pipeline_id', pipeline.id).order('position', { ascending: true })
      stages = data || []
    }

    // Active jobs (everything not cancelled).
    const { data: opps, error } = await admin
      .from('opportunities')
      .select('value, stage_id, cleared, paid, port, billing_number, status, updated_at, contacts(full_name, company), title')
      .eq('org_id', org)
      .neq('status', 'cancelled')
    if (error) throw error

    const active = opps || []
    const byStage = stages.map((s) => ({
      name: s.name,
      count: active.filter((o) => o.stage_id === s.id).length,
    }))

    const clearedUnpaidJobs = active.filter((o) => o.cleared && !o.paid)
    const readyJobs = active.filter((o) => o.cleared && o.paid)
    const recentPaid = active
      .filter((o) => o.paid)
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
      .slice(0, 8)

    return json(200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      counts: {
        openJobs: active.length,
        readyToRelease: readyJobs.length,
        clearedUnpaid: clearedUnpaidJobs.length,
        byStage,
      },
      money: {
        openValue: money(active.reduce((s, o) => s + Number(o.value || 0), 0)),
        unpaidValue: money(active.filter((o) => !o.paid).reduce((s, o) => s + Number(o.value || 0), 0)),
        paidValue: money(active.filter((o) => o.paid).reduce((s, o) => s + Number(o.value || 0), 0)),
      },
      jobs: {
        clearedUnpaid: clearedUnpaidJobs.slice(0, 8).map(trim), // the chase list
        recentPaid: recentPaid.map(trim),
      },
    })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
