import { admin } from './_shared/supabaseAdmin.js'

// Public, unauthenticated delivery-order upload. A customer opens a share link
// (/u/<token>) you generated and uploads a file. The token is validated here
// with the service role, so the customer never gets direct DB/storage access.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json', ...cors }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors }
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { token, filename, contentType, dataBase64 } = payload
  if (!token || !filename || !dataBase64) return json(400, { error: 'Missing token, filename, or data' })

  // 1. Validate the share link.
  const { data: link } = await admin
    .from('upload_links').select('*').eq('token', token).maybeSingle()
  if (!link) return json(404, { error: 'This upload link is not valid.' })
  if (link.expires_at && new Date(link.expires_at) < new Date())
    return json(410, { error: 'This upload link has expired. Ask for a new one.' })

  // 2. Decode + size guard (Netlify function body ~6MB; base64 inflates ~33%).
  let buf
  try { buf = Buffer.from(dataBase64, 'base64') } catch { return json(400, { error: 'Bad file data' }) }
  if (buf.length === 0) return json(400, { error: 'Empty file' })
  if (buf.length > 8 * 1024 * 1024) return json(413, { error: 'File too large (max 8 MB).' })

  // 3. Store under the org's prefix and record the attachment (service role).
  const safe = String(filename).replace(/[^\w.\-]+/g, '_').slice(0, 120)
  const path = `${link.org_id}/${link.contact_id || 'inbound'}/${Date.now()}-${safe}`
  const up = await admin.storage.from('delivery-orders')
    .upload(path, buf, { contentType: contentType || 'application/octet-stream', upsert: false })
  if (up.error) return json(500, { error: up.error.message })

  const { error } = await admin.from('attachments').insert({
    org_id: link.org_id,
    contact_id: link.contact_id || null,
    opportunity_id: link.opportunity_id || null,
    file_name: filename,
    file_path: path,
    mime_type: contentType || null,
    size_bytes: buf.length,
    kind: 'delivery_order',
  })
  if (error) return json(500, { error: error.message })

  await admin.from('upload_links')
    .update({ use_count: (link.use_count || 0) + 1, last_used_at: new Date().toISOString() })
    .eq('id', link.id)

  return json(200, { ok: true })
}
