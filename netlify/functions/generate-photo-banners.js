import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaudeVision } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const SYSTEM = `You write short banner-style text for a TWIC-certified port vehicle escort business (Ship2Shore Booking, 16 years experience, mostly port escorts, some full transport). Never suggest anything about JDM or import brokering as his own service -- he's not affiliated with any import business. These phrases get overlaid directly on a photo as bold text -- like the style you'd see on a car dealer's Instagram (a header naming the vehicle, a footer with a call to action or a differentiator). Short, punchy, ALL CAPS or Title Case, no more than about 6 words each. No hashtags, no emoji.

Look at the photo and suggest:
- 5 HEADER options: mostly about the specific vehicle you see (year/make/model if identifiable, otherwise a strong hook about the pickup/escort itself)
- 5 FOOTER options: a call to action or a real differentiator (TWIC-certified, 16 years, same-day, no broker fees, book now, etc.)

Respond with ONLY this JSON shape, nothing else, no markdown fences:
{"headers": ["...", "...", "...", "...", "..."], "footers": ["...", "...", "...", "...", "..."]}`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const imageUrl = payload.imageUrl?.toString().trim()
  if (!imageUrl) return json(400, { error: 'A photo is required to suggest ideas for it.' })

  try {
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) throw new Error(`Could not load the photo (${imgRes.status})`)
    const mediaType = imgRes.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await imgRes.arrayBuffer())

    const raw = await askClaudeVision({
      system: SYSTEM,
      prompt: 'Suggest header and footer banner text for this photo.',
      imageBase64: buffer.toString('base64'),
      mediaType,
      maxTokens: 500,
    })

    const match = raw.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(match ? match[0] : raw)
    const headers = Array.isArray(parsed.headers) ? parsed.headers.filter(Boolean).slice(0, 5) : []
    const footers = Array.isArray(parsed.footers) ? parsed.footers.filter(Boolean).slice(0, 5) : []
    if (!headers.length && !footers.length) throw new Error('No ideas came back -- try again.')

    return json(200, { headers, footers })
  } catch (e) {
    return json(502, { error: e.message || 'Could not come up with ideas for this photo.' })
  }
}
