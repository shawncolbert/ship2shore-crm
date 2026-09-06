import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaude, askClaudeVision } from './_shared/anthropic.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

const PLATFORM_RULES = {
  instagram: `INSTAGRAM: warm, personal tone, short paragraphs, 1-2 relevant emoji max. End with 5-8 relevant hashtags on their own line. Instagram does not make links clickable in captions -- if a call to action is needed, write "Link in bio" instead of a URL, never a raw link.`,
  facebook: `FACEBOOK: a bit fuller and more conversational than Instagram, can read like a real update to people who know him. Facebook DOES make a link clickable automatically, so when a call to action fits, include the real link: https://ship2shorebooking.com -- don't write "link in bio" here. Few or no hashtags.`,
  tiktok: `TIKTOK: short, punchy, hook in the first line (the part that shows before "more"). Casual, not corporate. 3-5 short trending-style hashtags. TikTok does not make links clickable in captions -- use "Link in bio", never a raw link.`,
}

const SYSTEM = (platform) => `You write social media captions for Ship2Shore Booking, a TWIC-certified port vehicle escort business run by a single owner-operator with 16 years of experience. He does far more port ESCORT jobs (walking/driving a customer's vehicle off the port, through security, to the buyer or a carrier) than full long-haul transports, plus some JDM (Japanese classic car/kei truck) import brokering. Write like a real person who does this work, not a marketing agency -- specific, plain, a little proud of the work, never generic corporate logistics-speak ("streamline," "synergy," "10x faster").

${PLATFORM_RULES[platform] || PLATFORM_RULES.instagram}

Output ONLY the caption text, ready to post -- no preamble, no quotes around it, no explanation.`

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const platform = ['instagram', 'facebook', 'tiktok'].includes(payload.platform) ? payload.platform : 'instagram'
  const seedText = payload.seedText?.toString().trim() || ''
  const imageUrl = payload.imageUrl?.toString().trim() || ''

  try {
    let caption
    if (imageUrl) {
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) throw new Error(`Could not load the photo to look at it (${imgRes.status})`)
      const mediaType = imgRes.headers.get('content-type') || 'image/jpeg'
      const buffer = Buffer.from(await imgRes.arrayBuffer())
      caption = await askClaudeVision({
        system: SYSTEM(platform),
        prompt: seedText
          ? `Write the caption based on what's in this photo. The owner's rough note about it: "${seedText}"`
          : `Write the caption based on what's actually in this photo -- describe what you see (vehicle type, setting) rather than guessing details you can't see.`,
        imageBase64: buffer.toString('base64'),
        mediaType,
        maxTokens: 400,
      })
    } else {
      if (!seedText) return json(400, { error: 'Give it a photo or a quick note about the post first.' })
      caption = await askClaude({
        system: SYSTEM(platform),
        prompt: `Write the caption based on this rough note: "${seedText}"`,
        maxTokens: 400,
      })
    }
    return json(200, { caption })
  } catch (e) {
    return json(502, { error: e.message || 'Could not generate a caption.' })
  }
}
