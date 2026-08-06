import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
    const user = await userFromToken(token)
    if (!user) return json(401, { error: 'Unauthorized' })

    const orgId = await orgForUser(user.id)
    if (!orgId) return json(403, { error: 'No org membership' })

    const { text, imageUrl, scheduledDate, autoPublishTiktok, tiktokPrivacyLevel, tiktokIsAigc } = JSON.parse(event.body || '{}')

    if (!text?.trim()) return json(400, { error: 'Post text is required' })
    if (!scheduledDate) return json(400, { error: 'Scheduled date is required' })
    if (autoPublishTiktok && !imageUrl) return json(400, { error: 'An image URL is required to auto-publish to TikTok' })

    const { data: post, error: postErr } = await admin
      .from('social_posts')
      .insert({
        org_id: orgId,
        text,
        image_url: imageUrl || null,
        scheduled_date: scheduledDate,
        status: autoPublishTiktok ? 'scheduled' : 'draft',
        platform: autoPublishTiktok ? 'tiktok' : null,
        tiktok_privacy_level: tiktokPrivacyLevel || 'SELF_ONLY',
        tiktok_is_aigc: Boolean(tiktokIsAigc),
      })
      .select()
      .single()

    if (postErr) return json(500, { error: postErr.message })

    return json(200, { post })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
