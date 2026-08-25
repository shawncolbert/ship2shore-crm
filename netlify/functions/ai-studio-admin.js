import { randomUUID } from 'crypto'
import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// AI Studio's cross-org data access -- listing/loading/saving a landing
// page or business card for an org the caller isn't necessarily a member
// of (e.g. Shawn pre-building a brand-new client's stuff before handing
// the org over). Platform-admin only and service-role, same trust
// boundary as admin-create-org.js -- ordinary RLS deliberately can't do
// any of this.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { action, orgId, kind, id, content } = body
  if (!orgId) return json(400, { error: 'Missing orgId' })
  if (kind !== 'landing_page' && kind !== 'business_card') return json(400, { error: 'Unknown kind' })

  if (action === 'list_content') {
    if (kind === 'landing_page') {
      const { data, error } = await admin
        .from('landing_pages').select('id, slug, title, updated_at')
        .eq('org_id', orgId).order('updated_at', { ascending: false })
      if (error) return json(500, { error: error.message })
      return json(200, { items: (data || []).map((p) => ({ id: p.id, label: p.title || p.slug })) })
    }
    const { data, error } = await admin
      .from('business_cards').select('id, slug, brand_name, full_name, created_at')
      .eq('org_id', orgId).order('created_at', { ascending: true })
    if (error) return json(500, { error: error.message })
    return json(200, { items: (data || []).map((c) => ({ id: c.id, label: c.brand_name || c.full_name || 'Untitled card' })) })
  }

  if (action === 'get_content') {
    if (!id) return json(400, { error: 'Missing id' })
    const table = kind === 'landing_page' ? 'landing_pages' : 'business_cards'
    const { data, error } = await admin.from(table).select('*').eq('id', id).eq('org_id', orgId).maybeSingle()
    if (error) return json(500, { error: error.message })
    if (!data) return json(404, { error: 'Not found' })
    return json(200, { item: data })
  }

  if (action === 'save_content') {
    if (!content) return json(400, { error: 'Missing content' })

    if (kind === 'landing_page') {
      const blocks = [{ id: randomUUID(), type: 'custom_html', html: content.html }]
      const row = {
        slug: content.slug, title: content.title, meta_description: content.meta_description || null,
        schema_json: content.schema_json || null, theme: 'classic', published: true, blocks,
      }
      const query = id
        ? admin.from('landing_pages').update(row).eq('id', id).eq('org_id', orgId)
        : admin.from('landing_pages').insert({ org_id: orgId, ...row })
      const { data, error } = await query.select('id, slug').single()
      if (error) {
        if (error.code === '23505') return json(409, { error: 'That slug is already taken — pick another.' })
        return json(500, { error: error.message })
      }
      return json(200, { id: data.id, slug: data.slug })
    }

    // business_card -- slug is NOT NULL, so a new card always gets one even
    // if the model left it out (same fallback shape businessCard.js's own
    // createBusinessCard uses).
    const cardRow = !id && !content.slug
      ? { ...content, slug: `card-${orgId.slice(0, 8)}-${Date.now().toString(36)}` }
      : content
    const query = id
      ? admin.from('business_cards').update(cardRow).eq('id', id).eq('org_id', orgId)
      : admin.from('business_cards').insert({ org_id: orgId, ...cardRow })
    const { data, error } = await query.select('id, slug').single()
    if (error) {
      if (error.code === '23505') return json(409, { error: 'That link is already taken — try another.' })
      return json(500, { error: error.message })
    }
    return json(200, { id: data.id, slug: data.slug })
  }

  return json(400, { error: 'Unknown action' })
}
