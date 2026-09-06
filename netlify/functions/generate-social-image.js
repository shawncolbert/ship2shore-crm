import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { generateImage, uploadGeneratedImage } from './_shared/geminiImage.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const prompt = payload.prompt?.toString().trim()
  if (!prompt) return json(400, { error: 'A description of the image is required.' })

  let image
  try {
    image = await generateImage(prompt, { aspectRatio: payload.aspectRatio })
  } catch (e) {
    return json(502, { error: e.message || 'Image generation failed.' })
  }

  let imageUrl
  try {
    imageUrl = await uploadGeneratedImage(admin, orgId, image)
  } catch (e) {
    return json(500, { error: e.message })
  }

  return json(200, { imageUrl })
}
