import { admin } from './_shared/supabaseAdmin.js'

// TEMPORARY, single-purpose utility -- uploads one asset (the Ship2Shore
// Transport landing page's hero map image) into the existing public
// card-assets bucket, once, so a custom_html landing block can reference a
// real URL instead of a relative filename that only worked as a standalone
// static site. Hardcoded to this one bucket/path prefix on purpose so it
// isn't a general-purpose open upload endpoint while it's live -- meant to
// be neutered (or deleted) right after this one-time use.
const BUCKET = 'card-assets'
const ALLOWED_PREFIX = '11111111-1111-1111-1111-111111111111/landing/'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  let payload
  try {
    payload = JSON.parse(event.body || '{}')
  } catch (e) {
    return json(400, { error: `Invalid JSON: ${e.message}` })
  }

  const { path, contentBase64, contentType } = payload
  if (!path || !String(path).startsWith(ALLOWED_PREFIX)) {
    return json(400, { error: `path must start with ${ALLOWED_PREFIX}` })
  }
  if (!contentBase64) return json(400, { error: 'contentBase64 is required' })

  const bytes = Buffer.from(contentBase64, 'base64')
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  })
  if (error) return json(500, { error: error.message })

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path)
  return json(200, { url: data.publicUrl })
}
