import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { orgGoogleAccessToken, buildRaw, gmailSend } from './_shared/google.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Wilmington's gate pass desk. Ship2Shore-specific for now -- other ports
// (Long Beach, Matson) get their own recipient once there's a real address
// to send to; see gate-pass-extract.js's `port` field for where a per-port
// lookup would key off of.
const GATE_PASS_RECIPIENT = 'NATSS.TricorSupport@portsamerica.com'

// Sends the gate pass request email (see the Pipeline "Request gate pass"
// modal) with the job's delivery order attached, from the org's own
// connected Gmail (never a shared/global account -- same reasoning as
// sendCustomerEmail). Deliberately NOT logged into the job's customer
// conversation thread: this goes to the port's gate desk, not the
// customer, so it would misrepresent who a message was sent to if it
// showed up there. gate_pass_requested_at on the opportunity is the audit
// trail instead -- visible right on the job.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { opportunityId, vessel, blNumber, driverName, vehicleDescription, vin, pickupDate } = body
  if (!opportunityId) return json(400, { error: 'opportunityId is required' })
  const missing = ['vessel', 'blNumber', 'driverName', 'vehicleDescription', 'vin', 'pickupDate']
    .filter((k) => !String(body[k] || '').trim())
  if (missing.length) return json(400, { error: `Missing: ${missing.join(', ')}` })

  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .select('id')
    .eq('id', opportunityId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (oppErr || !opp) return json(404, { error: 'Job not found' })

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()

  const { data: doc } = await admin
    .from('attachments')
    .select('file_path, file_name, mime_type')
    .eq('opportunity_id', opportunityId)
    .eq('org_id', orgId)
    .eq('kind', 'delivery_order')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let accessToken, from
  try {
    ;({ accessToken, email: from } = await orgGoogleAccessToken(orgId, admin))
  } catch (e) {
    return json(400, { error: e.message })
  }

  const attachments = []
  if (doc?.file_path) {
    const { data: fileData } = await admin.storage.from('delivery-orders').download(doc.file_path)
    if (fileData) {
      attachments.push({
        filename: doc.file_name || 'delivery-order.pdf',
        mimeType: doc.mime_type || 'application/pdf',
        base64: Buffer.from(await fileData.arrayBuffer()).toString('base64'),
      })
    }
  }

  const lines = [
    `REQUESTING GATE PASS FOR PICKUP ON ${pickupDate}.`,
    'PLEASE ISSUE GATE PASS FOR:',
    '',
    `VESSEL- ${vessel}`,
    `BL# ${blNumber}`,
    `DRIVER- ${driverName}`,
    vehicleDescription,
    `VIN# ${vin}`,
    '',
    profile?.full_name || from,
    org?.name || '',
    from,
  ].filter((l) => l !== '')

  try {
    const sent = await gmailSend(accessToken, buildRaw({
      from,
      to: GATE_PASS_RECIPIENT,
      subject: `Gate Pass Request -- BL# ${blNumber}`,
      body: lines.join('\n'),
      attachments,
    }))

    await admin.from('opportunities').update({
      vessel_name: vessel,
      gate_pass_requested_at: new Date().toISOString(),
    }).eq('id', opportunityId)

    return json(200, { ok: true, messageId: sent.id })
  } catch (e) {
    return json(502, { error: 'Could not send: ' + String(e.message || e) })
  }
}
