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

// Publishes immediately (mode: shareNow) -- buffer-publish.js only calls
// this once a post's own scheduled_date has already arrived, so there's
// nothing to gain from also handing Buffer a future dueAt to manage.
export async function bufferPublishNow(apiKey, { channelId, text, imageUrl }) {
  const input = {
    channelId,
    text: text || '',
    schedulingType: 'automatic',
    mode: 'shareNow',
    needsApproval: false,
    assets: imageUrl ? [{ image: { url: imageUrl } }] : [],
  }
  const data = await bufferGraphQL(apiKey, CREATE_POST, { input })
  const result = data?.createPost
  if (!result) throw new Error('Buffer createPost: empty response')
  if (result.__typename !== 'PostActionSuccess') {
    throw new Error(`Buffer ${result.__typename}: ${result.message || 'unknown error'}`)
  }
  return result.post
}
