import { admin } from './_shared/supabaseAdmin.js'
import { autoAssignDispatcher } from './_shared/dispatchAssignment.js'
import { sendTelegramLeadAlert } from './_shared/telegramDispatch.js'

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

// Long Beach Port Vehicle Transport / TWIC-Certified Port Escorts -- per
// Shawn 2026-08-28, every lead off THIS page always carries a flat $95
// port escort fee on top of (and entirely separate from) the usual vehicle
// transport quote: no deposit on the escort fee, it's not editable via the
// Telegram "Set price & deposit" flow (that only ever touches value/
// deposit_amount, i.e. transport), and it's not run through the pricing
// formula -- always exactly $95.
const PORT_ESCORT_LANDING_SLUG = 'port-transport'
const PORT_ESCORT_FEE = 95

async function getPage(slug) {
  const { data, error } = await admin
    .from('landing_pages')
    .select('id, org_id, title, blocks, published, theme, organizations(slug, ga4_measurement_id)')
    .eq('slug', String(slug || '').trim())
    .maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data || !data.published) return { status: 404, body: { error: 'Page not found.' } }
  return {
    status: 200,
    body: {
      title: data.title,
      blocks: data.blocks || [],
      theme: data.theme || 'classic',
      bookingOrgSlug: data.organizations?.slug || null,
      ga4MeasurementId: data.organizations?.ga4_measurement_id || null,
    },
  }
}

async function submitLead(payload) {
  // A pasted custom_html block's own <form> may use different field names
  // than the generic LeadForm ("name" instead of "full_name") -- accept
  // either. Standard honeypot convention: a hidden "bot-field" a real
  // visitor never sees or fills in. We used to drop the submission outright
  // when it was non-empty, but mobile autofill / password-manager
  // extensions can populate any empty text input on a form -- including
  // ones hidden via display:none on a parent -- so that false-positived
  // real leads into the void with zero trace. Flag it instead: still create
  // the lead, just marked for a human to sanity-check.
  const {
    slug, email, phone, notes,
    pickup_location, delivery_location, vehicle, ship_date, condition, trailer_type, value,
  } = payload
  const full_name = payload.full_name || payload.name
  const suspectedBot = Boolean(payload['bot-field'])
  // Email used to be required outright -- but a form that only collects a
  // phone number (e.g. the homepage quick-quote popup) is still a real,
  // callable lead, and this business runs on calling people back anyway.
  // Just need ONE reachable channel, not specifically email.
  if (!slug || !full_name || (!email && !phone)) {
    return { status: 400, body: { error: 'Missing required fields.' } }
  }

  const { data: page } = await admin
    .from('landing_pages').select('id, org_id, slug, title, published').eq('slug', String(slug).trim()).maybeSingle()
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

  const cleanEmail = email ? String(email).trim().toLowerCase() : null
  const cleanPhone = phone ? String(phone).trim() : null

  // Dedupe by whichever channel this submission actually has -- email when
  // present (the more reliable key), phone otherwise.
  let existingContact = null
  if (cleanEmail) {
    const { data } = await admin
      .from('contacts').select('id, phone, email').eq('org_id', page.org_id).eq('email', cleanEmail).maybeSingle()
    existingContact = data
  } else if (cleanPhone) {
    const { data } = await admin
      .from('contacts').select('id, phone, email').eq('org_id', page.org_id).eq('phone', cleanPhone).maybeSingle()
    existingContact = data
  }

  let contactId
  if (existingContact) {
    contactId = existingContact.id
    const fill = {}
    if (cleanPhone && !existingContact.phone) fill.phone = cleanPhone
    if (cleanEmail && !existingContact.email) fill.email = cleanEmail
    if (Object.keys(fill).length) await admin.from('contacts').update(fill).eq('id', contactId)
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

  // Flat-rate catalog services (homepage popup, digital business card) know
  // their price the moment the customer picks a service -- no per-mile
  // estimate to run. Passed through as opportunities.value so the Telegram
  // alert can show it pre-set instead of "estimate this manually".
  const parsedValue = Number(value)
  const cleanValue = value != null && Number.isFinite(parsedValue) && parsedValue >= 0 ? parsedValue : null

  // opportunities.value is NOT NULL DEFAULT 0 -- omit the key entirely when
  // there's no flat price (every real transport lead) so the column default
  // applies, instead of explicitly writing NULL over it and failing the
  // insert outright. Regression from adding flat-rate pricing: this broke
  // every non-catalog landing-page submission until caught 2026-08-29.
  const insertRow = {
    org_id: page.org_id, contact_id: contactId, pipeline_id: pipeline.id, stage_id: stage.id,
    title: `Website lead — ${page.title}`, status: 'open', source_board: page.slug,
    pickup_address: pickup_location ? String(pickup_location).trim() : null,
    dropoff_address: delivery_location ? String(delivery_location).trim() : null,
    vehicle: vehicle ? String(vehicle).trim() : null,
    escort_fee: page.slug === PORT_ESCORT_LANDING_SLUG ? PORT_ESCORT_FEE : null,
  }
  if (cleanValue != null) insertRow.value = cleanValue

  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .insert(insertRow)
    .select('id').single()
  if (oppErr || !opp) return { status: 500, body: { error: 'Could not create lead.', detail: oppErr?.message } }

  // Fields a custom form asks for that don't have their own opportunities
  // column (ship date, running/non-running, trailer type) -- kept as a note
  // on the contact rather than dropped, alongside any free-text message.
  const extraLines = [
    suspectedBot ? '⚠️ Honeypot field was filled — please verify this is a real lead before contacting.' : null,
    ship_date ? `Target ship date: ${ship_date}` : null,
    condition ? `Vehicle condition: ${condition}` : null,
    trailer_type ? `Trailer type: ${trailer_type}` : null,
    notes ? `Message: ${notes}` : null,
  ].filter(Boolean)
  if (extraLines.length) {
    await admin.from('activities').insert({
      org_id: page.org_id, contact_id: contactId, type: 'note',
      body: `Landing page submission (${page.title}):\n${extraLines.join('\n')}`.slice(0, 1000),
    })
  }

  // Same auto-assignment the booking funnel uses -- round-robins to
  // whoever's next in the org's dispatcher rotation, when the org has it
  // turned on. No-op (leaves the lead unassigned) otherwise.
  try {
    await autoAssignDispatcher({ orgId: page.org_id, opportunityId: opp.id })
  } catch (e) {
    console.error('❌ autoAssignDispatcher failed:', e)
  }

  // Best-effort team-wide push, separate from the dispatcher hand-off above --
  // no-ops silently for any org that hasn't set up a Telegram bot.
  try {
    const result = await sendTelegramLeadAlert({ orgId: page.org_id, opportunityId: opp.id })
    if (!result.sent && result.reason !== 'Telegram not configured') {
      console.error('❌ sendTelegramLeadAlert did not send:', result.reason)
    }
  } catch (e) {
    console.error('❌ sendTelegramLeadAlert failed:', e)
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
