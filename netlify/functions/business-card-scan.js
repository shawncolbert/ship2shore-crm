import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaudeVision } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const FIELDS = ['name', 'company', 'title', 'phone', 'email', 'address', 'website']
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const SYSTEM = `You extract contact details from a photo of a physical business card. Respond with ONLY a single JSON object -- no markdown code fences, no commentary before or after -- with exactly these keys: name, company, title, phone, email, address, website. Use only the text actually printed on the card for each field. If a field is not visible or not present on the card, its value MUST be the JSON null -- never guess, infer, or invent a value that isn't printed on the card.`

// Scans a photographed business card and returns extracted contact fields.
// The image itself is never stored server-side -- it's forwarded to the
// vision model and discarded. Requires a signed-in user (any org member),
// same auth gate as the other per-org Netlify functions in this app, mainly
// so an anonymous caller can't run up the Anthropic bill.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { imageBase64, mediaType } = body
  if (!imageBase64) return json(400, { error: 'No image provided' })
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) return json(400, { error: 'Unsupported image type' })

  let raw
  try {
    raw = await askClaudeVision({
      system: SYSTEM,
      prompt: 'Extract the contact details from this business card photo. Respond with only the JSON object.',
      imageBase64,
      mediaType,
      maxTokens: 500,
    })
  } catch (e) {
    return json(502, { error: 'Could not reach the card-reading service. Try again, or enter the details manually.' })
  }

  // Models occasionally wrap JSON in a ```json fence despite instructions --
  // strip that before parsing rather than rejecting an otherwise-good response.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return json(422, { error: 'Couldn’t read that card clearly. Try retaking the photo, or enter the details manually.' })
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json(422, { error: 'Couldn’t read that card clearly. Try retaking the photo, or enter the details manually.' })
  }

  // Coerce anything that isn't a real string to null rather than trusting
  // the model's shape -- a blank field must render blank, not "null" or "undefined".
  const fields = {}
  for (const f of FIELDS) {
    const v = parsed[f]
    fields[f] = (typeof v === 'string' && v.trim()) ? v.trim() : null
  }

  return json(200, { fields })
}
