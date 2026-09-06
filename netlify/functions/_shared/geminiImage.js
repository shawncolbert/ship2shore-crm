// Google's current image-generation model, reachable through the regular
// Gemini generateContent endpoint (marketing name "Nano Banana"). Imagen
// standalone models are being retired in 2026 -- Google's own docs now
// point new integrations at this model instead, so this is the one to use.
const MODEL = 'gemini-2.5-flash-image'
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`

// aspectRatio matches what a caller actually needs it for -- e.g. "1:1" for
// an Instagram/Facebook feed post, "9:16" for a Story/Reel/TikTok frame.
export async function generateImage(prompt, { aspectRatio } = {}) {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured on the server.')

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(aspectRatio ? { imageConfig: { aspectRatio } } : {}),
      },
    }),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`Gemini image API error (${res.status}): ${data?.error?.message || JSON.stringify(data)}`)
  }

  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!part) {
    const textPart = data?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text
    throw new Error(textPart || 'Gemini did not return an image for this prompt -- try rephrasing it.')
  }

  return { base64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' }
}

const EXT_BY_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

// Shared by generate-social-image.js and agent-controller.js's
// generate_post_image tool, so a generated image lands in the same bucket
// and path shape (org-scoped, card-assets/<org>/social-posts/...) no matter
// which caller made it -- see SocialPosts.jsx's own upload button for why
// this bucket/public-URL choice was made in the first place.
export async function uploadGeneratedImage(admin, orgId, { base64, mimeType }) {
  const ext = EXT_BY_MIME[mimeType] || 'png'
  const path = `${orgId}/social-posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const buffer = Buffer.from(base64, 'base64')

  const { error } = await admin.storage.from('card-assets').upload(path, buffer, { contentType: mimeType, upsert: false })
  if (error) throw new Error(`Generated the image but couldn't save it: ${error.message}`)

  const { data: pub } = admin.storage.from('card-assets').getPublicUrl(path)
  return pub.publicUrl
}
