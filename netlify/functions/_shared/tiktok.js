// TikTok Content Posting API v2 helpers. Direct (server-to-server) integration
// with TikTok's own API -- NOT the Higgsfield MCP tiktok_* tools, which only
// exist inside an interactive Claude agent session and can't be called from
// an unattended Netlify function. Requires a TikTok Developer app with
// Content Posting API access and a one-time OAuth exchange done by an admin
// (same shape as the existing Gmail integration in google.js), whose
// resulting tokens are stored in env vars.

export function tiktokConfigured() {
  return Boolean(
    process.env.TIKTOK_CLIENT_KEY &&
    process.env.TIKTOK_CLIENT_SECRET &&
    process.env.TIKTOK_REFRESH_TOKEN
  )
}

export async function tiktokAccessToken() {
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    client_secret: process.env.TIKTOK_CLIENT_SECRET,
    refresh_token: process.env.TIKTOK_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  const data = await r.json()
  if (!r.ok || !data.access_token) throw new Error('tiktok token: ' + JSON.stringify(data))
  return data.access_token
}

// Single-image photo post via PULL_FROM_URL. TikTok fetches image_url itself,
// so it must be a publicly reachable HTTPS URL on a domain verified with
// TikTok for this app -- an unverified domain is rejected at this step.
// Video posts aren't implemented: social_posts only stores one image_url today.
export async function tiktokPublishPhoto(accessToken, { imageUrl, caption, privacyLevel, isAigc }) {
  const r = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: (caption || '').slice(0, 150),
        privacy_level: privacyLevel || 'SELF_ONLY',
        disclose_video_gift: false,
        is_aigc: Boolean(isAigc),
        auto_add_music: true,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        photo_cover_index: 0,
        photo_images: [imageUrl],
      },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    }),
  })
  const data = await r.json()
  if (!r.ok || data.error?.code && data.error.code !== 'ok') {
    throw new Error('tiktok publish: ' + JSON.stringify(data.error || data))
  }
  return data.data // { publish_id, ... }
}

export async function tiktokPublishStatus(accessToken, publishId) {
  const r = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ publish_id: publishId }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error('tiktok status: ' + JSON.stringify(data.error || data))
  return data.data // { status, publicaly_available_post_id, fail_reason }
}
