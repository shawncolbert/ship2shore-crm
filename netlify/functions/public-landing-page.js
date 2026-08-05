import { admin } from './_shared/supabaseAdmin.js'

// Public, unauthenticated -- serves a published landing page by slug, and
// handles its lead-capture CTA form (creates a contact + opportunity, same
// as the rest of the pipeline). Unlike public-booking.js and the older
// webhooks, this resolves org_id/pipeline/stage dynamically from the page
// row rather than a hardcoded single-org constant, since landing pages are
// meant to work for any org from the start (white-label readiness).

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

async function getPage(slug) {
  const { data, error } = await admin
    .from('landing_pages')
    .select('id, org_id, title, blocks, published, organizations(slug)')
    .eq('slug', String(slug || '').trim())
    .maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data || !data.published) return { status: 404, body: { error: 'Page not found.' } }
  return { status: 200, body: { title: data.title, blocks: data.blocks || [], bookingOrgSlug: data.organizations?.slug || null } }
}

async function submitLead(payload) {
  const { slug, full_name, email, phone, notes } = payload
  if (!slug || !full_name || !email) {
    return { status: 400, body: { error: 'Missing required fields.' } }
  }

  const { data: page } = await admin
    .from('landing_pages').select('id, org_id, title, published').eq('slug', String(slug).trim()).maybeSingle()
  if (!page || !page.published) return { status: 404, body: { error: 'Page not found.' } }

  // Resolve this org's default pipeline + entry stage dynamically -- no
  // hardcoded pipeline/stage id, so this works for any org without code changes.
  const { data: pipeline } = await admin
    .from('pipelines').select('id').eq('org_id', page.org_id).eq('is_default', true).limit(1).maybeSingle()
  if (!pipeline) return { status: 500, body: { error: 'This org has no default pipeline configured.' } }
  // Negative position = a pre-pipeline/administrative stage (e.g. customs
  // clearance), not somewhere a brand-new lead belongs -- same convention
  // Dashboard.jsx already uses (`stages.filter(s => s.position >= 0)`).
  const { data: stage } = await admin
    .from('stages').select('id').eq('pipeline_id', pipeline.id).gte('position', 0)
    .order('position', { ascending: true }).limit(1).maybeSingle()
  if (!stage) return { status: 500, body: { error: 'This org\'s pipeline has no stages configured.' } }

  const cleanEmail = String(email).trim().toLowerCase()
  const cleanPhone = phone ? String(phone).trim() : null

  const { data: existingContact } = await admin
    .from('contacts').select('id, phone').eq('org_id', page.org_id).eq('email', cleanEmail).maybeSingle()

  let contactId
  if (existingContact) {
    contactId = existingContact.id
    if (cleanPhone && !existingContact.phone) {
      await admin.from('contacts').update({ phone: cleanPhone }).eq('id', contactId)
    }
  } else {
    const { data: newContact, error: contactErr } = await admin
      .from('contacts')
      .insert({
        org_id: page.org_id, full_name: String(full_name).trim(), email: cleanEmail, phone: cleanPhone,
        segment: 'private', source: 'landing_page',
      })
      .select('id').single()
    if (contactErr || !newContact) return { status: 500, body: { error: 'Could not create contact.', detail: contactErr?.message } }
    contactId = newContact.id
  }

  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .insert({
      org_id: page.org_id, contact_id: contactId, pipeline_id: pipeline.id, stage_id: stage.id,
      title: `Website lead — ${page.title}`, status: 'open',
    })
    .select('id').single()
  if (oppErr || !opp) return { status: 500, body: { error: 'Could not create lead.', detail: oppErr?.message } }

  if (notes) {
    await admin.from('activities').insert({
      org_id: page.org_id, contact_id: contactId, type: 'note', body: `Landing page note: ${String(notes).slice(0, 1000)}`,
    })
  }

  return { status: 200, body: { ok: true, contact_id: contactId, opportunity_id: opp.id } }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { action } = payload

  try {
    if (action === 'get') {
      const r = await getPage(payload.slug)
      return json(r.status, r.body)
    }
    if (action === 'submit_lead') {
      const r = await submitLead(payload)
      return json(r.status, r.body)
    }
    return json(400, { error: 'Unknown action' })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
