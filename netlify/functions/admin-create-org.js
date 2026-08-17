import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { name, slug, logoUrl, primaryColor, customDomain } = payload
  if (!name || !name.trim()) return json(400, { error: 'Name is required' })

  const { data, error } = await admin
    .from('organizations')
    .insert({
      name: name.trim(),
      slug: slug?.trim() || null,
      logo_url: logoUrl?.trim() || null,
      primary_color: primaryColor?.trim() || null,
      custom_domain: customDomain?.trim() || null,
    })
    .select('id, name, slug')
    .single()
  if (error) return json(500, { error: error.message })

  // Seed a blank business card row so the builder isn't a crash on first
  // login (see supabase/migrations/0015_business_cards.sql for the same
  // backfill applied to orgs that already existed).
  await admin.from('business_cards').insert({
    org_id: data.id,
    slug: data.slug || `card-${data.id.slice(0, 8)}`,
    brand_name: data.name,
    full_name: data.name,
  })

  // Seed a default pipeline with a simple 4-stage starter set so the
  // dashboard, booking sidebar, and public booking widget all work from
  // the first login -- without this an org has zero pipelines and every
  // one of those breaks (see supabase/migrations/0016_stages_color_and_intake_flag.sql
  // for the same backfill applied to orgs that already existed). The
  // pipeline stages admin screen lets them rename/reorder/recolor or
  // start over with a different template afterward.
  const { data: pipeline } = await admin
    .from('pipelines')
    .insert({ org_id: data.id, name: 'Main Pipeline', is_default: true })
    .select('id')
    .single()
  if (pipeline) {
    await admin.from('stages').insert([
      { org_id: data.id, pipeline_id: pipeline.id, name: 'New Lead', position: 0, color: '#e8a317', is_intake: true },
      { org_id: data.id, pipeline_id: pipeline.id, name: 'Scheduled', position: 1, color: '#22d3ee' },
      { org_id: data.id, pipeline_id: pipeline.id, name: 'Completed', position: 2, color: '#1fa97a' },
      { org_id: data.id, pipeline_id: pipeline.id, name: 'Canceled', position: 100, color: '#d9534f' },
    ])
  }

  // A generic starter for the Contact page's "Request a Document" picker --
  // freight-specific presets (Delivery Order, Gate Pass) only make sense
  // for Ship2Shore, so a brand-new org gets one plain option instead,
  // editable/expandable from Settings > Document Requests.
  await admin.from('document_request_presets').insert({
    org_id: data.id,
    label: 'Supporting Documents',
    subject: 'Supporting Documents Needed',
    body_template: 'Hi {{first_name}},\n\nCould you send over any supporting documents for this? Whatever you have is a help.',
    position: 0,
  })

  return json(200, { organization: data })
}
