import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Picks which named CA pricing zone (Los Angeles Local, Orange County, San
// Diego, etc.) a drop-off address falls into, if any -- the zones are named
// regions, not defined geographic boundaries, so this is exactly the kind
// of fuzzy "does this address belong to this named area" judgment an LLM is
// well suited for, versus a hardcoded city-to-zone lookup table that would
// need constant upkeep. Used by PriceEstimator to auto-suggest a price
// instead of requiring a manual zone pick.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const address = String(body?.address || '').trim()
  const zones = Array.isArray(body?.zones) ? body.zones : []
  if (!address || !zones.length) return json(400, { error: 'Missing address or zones' })

  const zoneList = zones.map((z) => `${z.id}: ${z.name}${z.note ? ` (${z.note})` : ''}`).join('\n')
  const system = `You match a delivery address to the correct named local pricing zone for a Southern/Northern California vehicle transport company, if any zone applies. Respond with ONLY the matching zone's id (the text before the colon), nothing else -- no explanation, no punctuation. If the address is outside all of these zones (out of state, or clearly a long-distance interstate haul rather than a local CA delivery), respond with exactly: NONE`

  let raw
  try {
    raw = await askClaude({ system, prompt: `Address: ${address}\n\nZones:\n${zoneList}`, maxTokens: 30 })
  } catch (e) {
    return json(502, { error: 'Could not reach the AI service: ' + String(e.message || e) })
  }

  const answer = raw.trim()
  const matched = zones.find((z) => z.id === answer)
  return json(200, { zoneId: matched ? matched.id : null })
}
