// Buffer's GraphQL API -- one POST endpoint, no /graphql path, personal
// access key as a Bearer token. Field names below (schedulingType, mode,
// needsApproval, assets/AssetInput/ImageAssetInput, and the
// PostActionPayload union members) were confirmed live against Buffer's
// own schema via buffer-setup-probe.js, not guessed from docs.
import { admin } from './supabaseAdmin.js'

const BUFFER_ENDPOINT = 'https://api.buffer.com/buffer/'

async function bufferGraphQL(apiKey, query, variables) {
  const r = await fetch(BUFFER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  })
  const data = await r.json()
  if (!r.ok || data.errors?.length) throw new Error('Buffer API: ' + JSON.stringify(data.errors || data))
  return data.data
}

export async function bufferConnection(orgId) {
  const { data } = await admin.from('buffer_connections').select('*').eq('org_id', orgId).maybeSingle()
  return data
}

const CREATE_POST = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      __typename
      ... on PostActionSuccess { post { id } }
      ... on NotFoundError { message }
      ... on UnauthorizedError { message }
      ... on UnexpectedError { message }
      ... on RestProxyError { message code }
      ... on LimitReachedError { message }
      ... on InvalidInputError { message }
    }
  }
`

// Facebook and Instagram both require a platform-specific "type" in
// metadata (confirmed live against Buffer's schema, not guessed) --
// 'post' is the plain feed post every other type variant (reel/story/
// carousel/etc.) specializes. Instagram additionally requires
// shouldShareToFeed. TikTok needs no metadata at all -- everything on
// TikTokPostMetadataInput is optional.
function metadataFor(platform) {
  if (platform === 'facebook') return { facebook: { type: 'post' } }
  if (platform === 'instagram') return { instagram: { type: 'post', shouldShareToFeed: true } }
  return undefined
}

// TikTok photo posts cap out at 2,073,600 pixels (1920x1080) -- a real
// phone/library photo is routinely well past that (a 12MP photo is ~6x
// over), and Buffer rejects the whole post outright rather than resizing
// it. wsrv.nl is a long-standing free image proxy: fetches the original,
// resizes it, and serves the result from its own URL -- no image library
// or Supabase transform tier needed on our side. fit=inside keeps the
// aspect ratio and guarantees both dimensions stay under the cap for any
// source shape, landscape or portrait.
function tiktokSafeImageUrl(url) {
  if (!url) return url
  return `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&w=1400&h=1400&fit=inside`
}

// Publishes immediately (mode: shareNow) -- buffer-publish.js only calls
// this once a post's own scheduled_date has already arrived, so there's
// nothing to gain from also handing Buffer a future dueAt to manage.
export async function bufferPublishNow(apiKey, { channelId, text, imageUrl, platform }) {
  const metadata = metadataFor(platform)
  const safeImageUrl = platform === 'tiktok' ? tiktokSafeImageUrl(imageUrl) : imageUrl
  const input = {
    channelId,
    text: text || '',
    schedulingType: 'automatic',
    mode: 'shareNow',
    needsApproval: false,
    assets: safeImageUrl ? [{ image: { url: safeImageUrl } }] : [],
    ...(metadata ? { metadata } : {}),
  }
  const data = await bufferGraphQL(apiKey, CREATE_POST, { input })
  const result = data?.createPost
  if (!result) throw new Error('Buffer createPost: empty response')
  if (result.__typename !== 'PostActionSuccess') {
    throw new Error(`Buffer ${result.__typename}: ${result.message || 'unknown error'}`)
  }
  return result.post
}
