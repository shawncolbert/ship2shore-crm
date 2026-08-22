import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const SYSTEM = `You extract structured vehicle-transport job details from a dispatcher's spoken job brief (already transcribed to text). Respond with ONLY a JSON object, no other text, no markdown code fences. Use exactly these keys:
{
  "title": string or null,
  "pickup_address": string or null,
  "dropoff_address": string or null,
  "vehicle_description": string or null,
  "price": number or null,
  "notes": string or null
}
vehicle_description should be the year/make/model as heard (e.g. "2022 Toyota Tacoma"). price should be a plain number with no currency symbol or commas. notes is for anything else relevant that was said and doesn't fit the fields above (special instructions, timing, contact preferences). If something wasn't mentioned, use null for it -- never guess or invent a value that wasn't actually said in the brief.`

// Turns a dispatcher's spoken job brief (transcribed client-side via the
// browser's own speech recognition -- see AudioBriefField in Pipeline.jsx)
// into structured fields for the job form. Never saves anything itself --
// the frontend fills the form with whatever comes back and the dispatcher
// still has to review and hit Save, same "AI suggests, dispatcher confirms"
// rule as vehicle pricing.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const transcript = String(body?.transcript || '').trim()
  if (!transcript) return json(400, { error: 'Missing transcript' })
  if (transcript.length > 4000) return json(400, { error: 'That brief is too long -- try a shorter one.' })

  let raw
  try {
    raw = await askClaude({ system: SYSTEM, prompt: transcript, maxTokens: 400 })
  } catch (e) {
    return json(502, { error: 'Could not reach the AI service: ' + String(e.message || e) })
  }

  let fields
  try {
    fields = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    return json(502, { error: "Couldn't understand that brief clearly enough -- try again, or fill the fields in by hand." })
  }

  return json(200, {
    ok: true,
    title: fields.title || null,
    pickup_address: fields.pickup_address || null,
    dropoff_address: fields.dropoff_address || null,
    vehicle_description: fields.vehicle_description || null,
    price: Number.isFinite(Number(fields.price)) ? Number(fields.price) : null,
    notes: fields.notes || null,
  })
}
