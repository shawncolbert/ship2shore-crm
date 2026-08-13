import { admin } from './_shared/supabaseAdmin.js'
import { tiktokConfigured, tiktokAccessToken, tiktokPublishPhoto, tiktokPublishStatus } from './_shared/tiktok.js'

// Scheduled: publish any social_posts row whose scheduled time has arrived,
// across every org -- not just Ship2Shore. Each post already carries its own
// org_id, so publishing just needs to key off that per-row instead of a
// single hardcoded org.
// Privacy level and AI-disclosure were chosen by a human at schedule time
// (see social-posts-create.js) and are only replayed here, never decided by
// this job -- TikTok's Direct Post API ties those flags to real user consent.
export const handler = async () => {
  const { data: due, error: dueErr } = await admin
    .from('social_posts')
    .select('*')
    .eq('platform', 'tiktok')
    .eq('status', 'scheduled')
    .lte('scheduled_date', new Date().toISOString())

  if (dueErr) return { statusCode: 500, body: JSON.stringify({ error: dueErr.message }) }

  let published = 0
  let failed = 0

  for (const post of due || []) {
    if (!(await tiktokConfigured(post.org_id))) {
      await admin.from('social_posts').update({
        status: 'failed',
        publish_error: 'No TikTok account is connected yet. Go to Social Posts and click "Connect TikTok" before scheduled posts can auto-publish.',
      }).eq('id', post.id)
      failed++
      continue
    }
    if (!post.image_url) {
      await admin.from('social_posts').update({
        status: 'failed', publish_error: 'No image attached -- TikTok posts need an image URL.',
      }).eq('id', post.id)
      failed++
      continue
    }

    try {
      const token = await tiktokAccessToken(post.org_id)
      const { publish_id: publishId } = await tiktokPublishPhoto(token, {
        imageUrl: post.image_url,
        caption: post.text,
        privacyLevel: post.tiktok_privacy_level,
        isAigc: post.tiktok_is_aigc,
      })

      // TikTok accepted the post; it processes asynchronously from here. Mark
      // it published now so this row is never resubmitted on the next run --
      // resolve the public URL best-effort with one immediate status check.
      let publishedUrl = null
      try {
        const status = await tiktokPublishStatus(token, publishId)
        const postId = status?.publicaly_available_post_id?.[0]
        if (postId) publishedUrl = `https://www.tiktok.com/@${status.creator_username || 'me'}/video/${postId}`
      } catch {
        // Still processing or status not resolvable yet -- fine, published_url stays null.
      }

      await admin.from('social_posts').update({
        status: 'published',
        published_at: new Date().toISOString(),
        published_url: publishedUrl,
        publish_error: null,
      }).eq('id', post.id)
      published++
    } catch (e) {
      await admin.from('social_posts').update({
        status: 'failed', publish_error: String(e.message || e),
      }).eq('id', post.id)
      failed++
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, due: due?.length || 0, published, failed }) }
}
