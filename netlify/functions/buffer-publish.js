import { admin } from './_shared/supabaseAdmin.js'
import { bufferConnection, bufferPublishNow } from './_shared/bufferClient.js'

const CHANNEL_FIELD = {
  instagram: 'channel_instagram',
  facebook: 'channel_facebook',
  tiktok: 'channel_tiktok',
}

// Publish any social_posts row whose scheduled time has arrived and which
// was set to auto-publish via Buffer (publish_via = 'buffer') -- across
// every org, each row already carries its own org_id. This is separate
// from tiktok-publish.js's direct-TikTok-API path; that job only ever
// touches rows with publish_via still null, so the two never race on the
// same post. See buffer-setup-probe.js for how the request shape below was
// confirmed against Buffer's real schema.
export const handler = async () => {
  const { data: due, error: dueErr } = await admin
    .from('social_posts')
    .select('*')
    .eq('publish_via', 'buffer')
    .eq('status', 'scheduled')
    .lte('scheduled_date', new Date().toISOString())

  if (dueErr) return { statusCode: 500, body: JSON.stringify({ error: dueErr.message }) }

  let published = 0
  let failed = 0

  for (const post of due || []) {
    try {
      const conn = await bufferConnection(post.org_id)
      if (!conn) throw new Error('No Buffer account connected for this org yet.')

      const channelField = CHANNEL_FIELD[post.platform]
      const channelId = channelField && conn[channelField]
      if (!channelId) throw new Error(`No Buffer channel connected for ${post.platform || 'this platform'}.`)

      await bufferPublishNow(conn.api_key, {
        channelId,
        text: post.text,
        imageUrl: post.image_url,
        platform: post.platform,
      })

      // Buffer's createPost only returns its own internal post id, not the
      // live public URL -- nothing reliable to store in published_url yet.
      await admin.from('social_posts').update({
        status: 'published',
        published_at: new Date().toISOString(),
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
