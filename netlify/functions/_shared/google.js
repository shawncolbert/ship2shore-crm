// Gmail API helpers. Uses an OAuth refresh token exchanged for short-lived
// access tokens. All secrets come from environment variables.

export async function googleAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!r.ok) throw new Error('google token: ' + (await r.text()))
  return (await r.json()).access_token
}

export function buildRaw({ from, to, subject, body }) {
  const msg = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n')
  return Buffer.from(msg).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function gmailSend(token, raw) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  })
  if (!r.ok) throw new Error('gmail send: ' + (await r.text()))
  return r.json()
}

export async function gmailList(token, q, max = 100) {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error('gmail list: ' + (await r.text()))
  return (await r.json()).messages || []
}

export async function gmailGet(token, id) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw new Error('gmail get: ' + (await r.text()))
  return r.json()
}

export function headerVal(payload, name) {
  return (payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || ''
}

export function emailFrom(str) {
  const m = String(str).match(/<([^>]+)>/)
  return (m ? m[1] : str).trim().toLowerCase()
}

function decodeB64(d) {
  return Buffer.from(String(d).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

export function extractText(payload) {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodeB64(payload.body.data)
  for (const p of payload.parts || []) {
    const t = extractText(p)
    if (t) return t
  }
  return ''
}
