// Minimal Claude API client -- plain fetch, matching this repo's pattern of
// hitting external HTTP APIs directly (see google.js) instead of pulling in
// an SDK dependency for a handful of calls.

const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'

export async function askClaude({ system, prompt, maxTokens = 600 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Claude API error: ' + JSON.stringify(data))
  return (data.content || []).map((b) => b.text || '').join('').trim()
}

// Vision variant of askClaude -- same model/auth, but the message content is
// an image block plus a text instruction instead of a plain string. Used by
// the business-card scanner to read printed contact details off a photo.
export async function askClaudeVision({ system, prompt, imageBase64, mediaType = 'image/jpeg', maxTokens = 600 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error('Claude API error: ' + JSON.stringify(data))
  return (data.content || []).map((b) => b.text || '').join('').trim()
}
