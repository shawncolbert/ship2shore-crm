import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Editing a draft in place -- before this, the only options were delete and
// start over, which meant a typo or a wrong photo meant losing your whole
// caption. Only ever touches a post's own fields, org-scoped; platform
// isn't editable here since a post is tied to the platform it was created
// for (change platform = make a new one for that platform instead).
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { postId, text, imageUrl, scheduledDate, autoPublishTiktok, tiktokPrivacyLevel, tiktokIsAigc } = payload
  if (!postId) return json(400, { error: 'postId is required' })
  if (!text?.trim()) return json(400, { error: 'Post text is required' })
  if (!scheduledDate) return json(400, { error: 'Scheduled date is required' })

  const { data: existing, error: fetchErr } = await admin
    .from('social_posts').select('platform, status').eq('id', postId).eq('org_id', orgId).maybeSingle()
  if (fetchErr) return json(500, { error: fetchErr.message })
  if (!existing) return json(404, { error: 'Post not found' })

  const update = {
    text,
    image_url: imageUrl || null,
    scheduled_date: scheduledDate,
    // Editing un-does a stale reminder/failure state -- it's effectively a
    // fresh draft again until the new schedule time actually arrives.
    reminded_at: null,
  }
  if (existing.status !== 'published') update.status = 'draft'

  if (existing.platform === 'tiktok') {
    update.tiktok_privacy_level = tiktokPrivacyLevel || 'SELF_ONLY'
    update.tiktok_is_aigc = Boolean(tiktokIsAigc)
    if (autoPublishTiktok && !imageUrl) return json(400, { error: 'An image is required to auto-publish to TikTok' })
    update.status = autoPublishTiktok ? 'scheduled' : 'draft'
  }

  const { data: updated, error } = await admin
    .from('social_posts').update(update).eq('id', postId).eq('org_id', orgId).select().single()
  if (error) return json(500, { error: error.message })

  return json(200, { post: updated })
}
