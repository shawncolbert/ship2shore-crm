import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaudeDocument, askClaudeVision } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

const SYSTEM = `You read freight delivery order / pickup order documents that may list MULTIPLE vehicles under one Bill of Lading. Respond with ONLY a JSON object, no other text, no markdown code fences. Use exactly these keys:
{
  "vessel": string or null,
  "voyage": string or null,
  "bl_number": string or null,
  "vehicles": [{"description": string, "vin": string or null}]
}
vessel is the ship/importing carrier name. voyage is the voyage number if shown. bl_number is the Bill of Lading number for this document. vehicles is EVERY line item on the document, in the order listed -- description is the year/make/model/color as written, vin is that line's VIN/chassis number (often shown right after the description, sometimes on its own line). If a field isn't on the document, use null -- never guess or invent a value that isn't actually printed on it. Never skip a vehicle line item.`

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// Reads ONE uploaded delivery order (PDF or photo) and returns every vehicle
// line item on it, for the bulk "Gate Pass Request" tool -- a single BL# can
// cover several vehicles, and NATSS/Ports America want them all listed in
// one request rather than one email per vehicle. Purely a read: nothing is
// stored here. The frontend collects results from each file the dispatcher
// adds, lets them review/edit every field, and only gate-pass-bulk-send.js
// (triggered by Send) persists or emails anything -- same "AI suggests,
// human confirms" rule as gate-pass-extract.js and parse-job-brief.js.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { fileBase64, mimeType } = body
  if (!fileBase64) return json(400, { error: 'fileBase64 is required' })

  let raw
  try {
    if (mimeType === 'application/pdf') {
      raw = await askClaudeDocument({ system: SYSTEM, prompt: 'Extract the fields from this delivery order.', pdfBase64: fileBase64, maxTokens: 1200 })
    } else if (ALLOWED_IMAGE_TYPES.includes(mimeType)) {
      raw = await askClaudeVision({ system: SYSTEM, prompt: 'Extract the fields from this delivery order.', imageBase64: fileBase64, mediaType: mimeType, maxTokens: 1200 })
    } else {
      return json(400, { error: 'Unsupported file type -- use a PDF or a photo (JPEG/PNG).' })
    }
  } catch (e) {
    return json(502, { error: 'Could not reach the AI service: ' + String(e.message || e) })
  }

  let parsed
  try {
    parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, ''))
  } catch {
    return json(502, { error: "Couldn't read that document clearly enough -- try a clearer photo, or fill the fields in by hand below." })
  }

  return json(200, {
    ok: true,
    vessel: parsed.vessel || null,
    voyage: parsed.voyage || null,
    blNumber: parsed.bl_number || null,
    vehicles: Array.isArray(parsed.vehicles)
      ? parsed.vehicles.map((v) => ({ description: v?.description || '', vin: v?.vin || '' }))
      : [],
  })
}
