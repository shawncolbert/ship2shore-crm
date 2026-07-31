import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { name, slug, logoUrl, primaryColor, customDomain } = payload
  if (!name || !name.trim()) return json(400, { error: 'Name is required' })

  const { data, error } = await admin
    .from('organizations')
    .insert({
      name: name.trim(),
      slug: slug?.trim() || null,
      logo_url: logoUrl?.trim() || null,
      primary_color: primaryColor?.trim() || null,
      custom_domain: customDomain?.trim() || null,
    })
    .select('id, name, slug')
    .single()
  if (error) return json(500, { error: error.message })

  return json(200, { organization: data })
}
