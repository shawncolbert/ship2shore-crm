import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { orgGoogleAccessToken, buildRaw, gmailSend } from './_shared/google.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const GATE_PASS_RECIPIENT = 'NATSS.TricorSupport@portsamerica.com'

// Same normalization gmail-sync uses to match a document to a job -- strip
// everything but A-Z0-9 and uppercase, so "MOLU 1800-9386800" and
// "molu18009386800" compare equal.
const normalize = (s) => (typeof s === 'string' ? s.toUpperCase().replace(/[^A-Z0-9]/g, '') : '')

// Sends one combined gate pass request covering several BL#s/vehicles --
// the multi-vehicle counterpart to gate-pass-send.js, for a pickup trip
// like "2 BLs, 4 vehicles each" where the port wants everything in one
// email rather than one per vehicle. Each BL# group gets its own uploaded
// document attached and, if a job already exists for that BL# (matched the
// same way gmail-sync matches an inbound reply), gets its
// vessel_name/gate_pass_requested_at updated too -- best-effort, since a
// bulk request commonly covers vehicles that don't have individual job
// cards yet.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { vessel, voyage, driverName, pickupDate, groups } = body
  if (!Array.isArray(groups) || !groups.length) return json(400, { error: 'At least one BL# group is required' })
  const missing = ['vessel', 'driverName', 'pickupDate'].filter((k) => !String(body[k] || '').trim())
  if (missing.length) return json(400, { error: `Missing: ${missing.join(', ')}` })
  for (const [i, g] of groups.entries()) {
    if (!g.blNumber?.trim()) return json(400, { error: `Group ${i + 1}: BL# is required` })
    if (!Array.isArray(g.vehicles) || !g.vehicles.length) return json(400, { error: `Group ${i + 1}: at least one vehicle is required` })
  }

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const { data: org } = await admin.from('organizations').select('name').eq('id', orgId).maybeSingle()

  const { data: opps } = await admin
    .from('opportunities')
    .select('id, contact_id, billing_number, bl_number')
    .eq('org_id', orgId)

  let accessToken, from
  try {
    ;({ accessToken, email: from } = await orgGoogleAccessToken(orgId, admin))
  } catch (e) {
    return json(400, { error: e.message })
  }

  const attachments = []
  const bodyLines = [
    `REQUESTING GATE PASS FOR PICKUP ON ${pickupDate}.`,
    'PLEASE ISSUE GATE PASS FOR:',
    '',
    `VESSEL- ${vessel}`,
  ]
  if (voyage) bodyLines.push(`VOYAGE- ${voyage}`)

  for (const g of groups) {
    bodyLines.push('', `BL# ${g.blNumber}`, `DRIVER- ${driverName}`)
    g.vehicles.forEach((v, i) => {
      bodyLines.push(`${i + 1}. ${v.description}${v.vin ? ` — VIN# ${v.vin}` : ''}`)
    })

    if (g.fileBase64) {
      attachments.push({
        filename: g.fileName || `delivery-order-${g.blNumber}.pdf`,
        mimeType: g.mimeType || 'application/pdf',
        base64: g.fileBase64,
      })

      const path = `${orgId}/bulk/${Date.now()}_${(g.fileName || 'delivery-order').replace(/[^\w.\-]+/g, '_')}`
      const { error: upErr } = await admin.storage
        .from('delivery-orders')
        .upload(path, Buffer.from(g.fileBase64, 'base64'), { contentType: g.mimeType || 'application/pdf' })

      if (!upErr) {
        const normBl = normalize(g.blNumber)
        const match = (opps || []).find((o) => {
          const a = normalize(o.billing_number)
          const b = normalize(o.bl_number)
          return (a.length >= 6 && a === normBl) || (b.length >= 6 && b === normBl)
        })

        await admin.from('attachments').insert({
          org_id: orgId,
          contact_id: match?.contact_id || null,
          opportunity_id: match?.id || null,
          file_name: g.fileName || `delivery-order-${g.blNumber}.pdf`,
          file_path: path,
          mime_type: g.mimeType || 'application/pdf',
          size_bytes: Buffer.byteLength(g.fileBase64, 'base64'),
          kind: 'delivery_order',
          bl_number: g.blNumber,
          needs_review: !match,
          source: 'gate_pass_bulk',
        })

        if (match) {
          await admin.from('opportunities').update({
            vessel_name: vessel,
            gate_pass_requested_at: new Date().toISOString(),
          }).eq('id', match.id)
        }
      }
    }
  }

  bodyLines.push('', profile?.full_name || from, org?.name || '', from)

  const allVins = groups.flatMap((g) => g.vehicles.map((v) => v.vin)).filter(Boolean)
  const subject = groups.length > 1
    ? `Gate Pass Request -- BL# ${groups.map((g) => g.blNumber).join(' & ')}`
    : `Gate Pass Request -- BL# ${groups[0].blNumber}`

  try {
    const sent = await gmailSend(accessToken, buildRaw({
      from,
      to: GATE_PASS_RECIPIENT,
      subject,
      body: bodyLines.join('\n').replace(/\n{3,}/g, '\n\n'),
      attachments,
    }))
    return json(200, { ok: true, messageId: sent.id, vehicleCount: allVins.length })
  } catch (e) {
    return json(502, { error: 'Could not send: ' + String(e.message || e) })
  }
}
