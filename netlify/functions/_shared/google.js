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

// Email headers must be 7-bit ASCII. Any non-ASCII text (em dashes, curly
// quotes, accents, emoji) has to be wrapped as an RFC 2047 "encoded-word"
// or it turns into mojibake in recipients' clients. Pure-ASCII values pass
// through untouched; non-ASCII values are UTF-8/base64 encoded-words, chunked
// on code-point boundaries so a multibyte character is never split.
function encodeHeaderWord(value) {
  const s = String(value ?? '')
  if (/^[\x00-\x7F]*$/.test(s)) return s
  const words = []
  let chunk = ''
  const flush = () => {
    if (chunk) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
      chunk = ''
    }
  }
  for (const ch of s) {
    // Keep each encoded-word's source well under the 75-char header-word limit.
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) flush()
    chunk += ch
  }
  flush()
  return words.join('\r\n ') // fold long values across multiple encoded-words
}

// Address headers may be "Display Name <addr>" — only the display name may
// carry non-ASCII, and the <addr> must stay bare. Encode just the name part.
function encodeAddressHeader(value) {
  const s = String(value ?? '').trim()
  const m = s.match(/^(.*?)\s*<([^>]+)>$/)
  if (m) {
    const name = m[1].trim().replace(/^"(.*)"$/, '$1')
    return name ? `${encodeHeaderWord(name)} <${m[2]}>` : `<${m[2]}>`
  }
  return s // bare address, already ASCII
}

export function buildRaw({ from, to, subject, body }) {
  // Body is base64-encoded UTF-8 so any characters survive intact.
  const b64body = Buffer.from(String(body ?? ''), 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n')
  const msg = [
    `From: ${encodeAddressHeader(from)}`,
    `To: ${encodeAddressHeader(to)}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64body,
  ].join('\r\n')
  // msg is now pure ASCII (encoded headers + base64 body), so the final
  // base64url wrapping can't double-encode anything.
  return Buffer.from(msg, 'utf8').toString('base64')
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
