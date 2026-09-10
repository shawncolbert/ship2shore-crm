import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaudeDocument } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const SYSTEM = `You read freight delivery order documents. Respond with ONLY a JSON object, no other text, no markdown code fences. Use exactly these keys:
{
  "vessel": string or null,
  "bl_number": string or null,
  "vin": string or null,
  "vehicle_description": string or null
}
vessel is the importing carrier/vessel name (often labeled "IMPORTING CARRIER" or "VESSEL"). bl_number is the Bill of Lading / AWB number. vin is the vehicle's VIN. vehicle_description is the year/make/model as written (e.g. "1999 Nissan Silvia"). If a field isn't on the document, use null -- never guess or invent a value that isn't actually printed on it.`

// Reads a job's delivery order (whichever attachment is most recently
// classified delivery_order for it) and pulls the fields needed to prefill
// the "Request gate pass" form -- primarily vessel, since bl_number,
// vehicle_vin/description are usually already on the opportunity itself
// from gmail-sync's own matching. Uses Claude's native PDF reading rather
// than a text-layer extraction: gate-pass delivery orders are frequently
// scanned/forwarded phone photos with no embedded text layer at all.
// Never saves anything -- the frontend fills the review form with whatever
// comes back and Shawn still has to review and hit Send, same "AI
// suggests, dispatcher confirms" rule as parse-job-brief.js and vehicle
// pricing.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { opportunityId } = body
  if (!opportunityId) return json(400, { error: 'opportunityId is required' })

  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .select('id, bl_number, vessel_name, vehicle, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, port')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (oppErr || !opp) return json(404, { error: 'Job not found' })

  const { data: doc } = await admin
    .from('attachments')
    .select('file_path, mime_type')
    .eq('opportunity_id', opportunityId)
    .eq('org_id', orgId)
    .eq('kind', 'delivery_order')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const fallback = {
    vessel: opp.vessel_name || null,
    blNumber: opp.bl_number || null,
    vin: opp.vehicle_vin || null,
    vehicleDescription: [opp.vehicle_year, opp.vehicle_make, opp.vehicle_model].filter(Boolean).join(' ') || opp.vehicle || null,
    port: opp.port || null,
  }

  if (!doc || doc.mime_type !== 'application/pdf') {
    // No delivery order on file, or it's an image we can't hand to the PDF
    // reader -- return whatever the job itself already has rather than
    // failing the whole request.
    return json(200, { ok: true, ...fallback, source: doc ? 'job_only_unsupported_file' : 'job_only_no_document' })
  }

  const { data: fileData, error: dlErr } = await admin.storage.from('delivery-orders').download(doc.file_path)
  if (dlErr || !fileData) return json(200, { ok: true, ...fallback, source: 'job_only_download_failed' })

  const pdfBase64 = Buffer.from(await fileData.arrayBuffer()).toString('base64')

  let extracted
  try {
    const raw = await askClaudeDocument({ system: SYSTEM, prompt: 'Extract the fields from this delivery order.', pdfBase64, maxTokens: 400 })
    extracted = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    return json(200, { ok: true, ...fallback, source: 'job_only_extraction_failed' })
  }

  return json(200, {
    ok: true,
    vessel: extracted.vessel || fallback.vessel,
    blNumber: extracted.bl_number || fallback.blNumber,
    vin: extracted.vin || fallback.vin,
    vehicleDescription: extracted.vehicle_description || fallback.vehicleDescription,
    port: fallback.port,
    source: 'document',
  })
}
