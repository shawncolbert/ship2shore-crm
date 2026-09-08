// One-time diagnostic: Shawn reported the Instagram/Facebook posts Buffer's
// createPost mutation said succeeded aren't actually showing up on the real
// pages, for him or his followers. A success response from createPost only
// means Buffer accepted the request -- it doesn't guarantee the platform
// itself actually published it. This checks Buffer's own post records for
// the connected channels to see their real status/error, instead of taking
// the earlier "success" response at face value. Delete once resolved.
import { admin } from './_shared/supabaseAdmin.js'

const BUFFER_ENDPOINT = 'https://api.buffer.com/buffer/'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2),
})

async function gql(apiKey, query, variables) {
  const r = await fetch(BUFFER_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, variables }),
  })
  const data = await r.json()
  if (!r.ok || data.errors?.length) throw new Error(JSON.stringify(data.errors || data))
  return data.data
}

export const handler = async (event) => {
  const key = event.queryStringParameters?.key
  if (!process.env.BUFFER_SETUP_TOKEN || key !== process.env.BUFFER_SETUP_TOKEN) {
    return json(403, { error: 'Forbidden' })
  }

  try {
    const { data: conn } = await admin
      .from('buffer_connections').select('*')
      .eq('org_id', '11111111-1111-1111-1111-111111111111').maybeSingle()
    if (!conn) return json(500, { error: 'No buffer_connections row found' })

    const orgData = await gql(conn.api_key, `query { account { organizations { id } } }`)
    const bufferOrgId = orgData?.account?.organizations?.[0]?.id

    // Shawn just reconnected TikTok to the correct account -- need the new
    // channel id so buffer_connections.channel_tiktok can be updated.
    const chData = await gql(
      conn.api_key,
      `query GetChannels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name service } }`,
      { organizationId: bufferOrgId }
    )

    // Introspect Post's own fields first -- haven't looked at these yet.
    const postType = await gql(
      conn.api_key,
      `query { __type(name: "Post") { name fields { name type { name kind ofType { name kind } } } } }`
    )

    const channelIds = [conn.channel_instagram, conn.channel_facebook, conn.channel_tiktok].filter(Boolean)
    const posts = await gql(
      conn.api_key,
      `query GetPosts($organizationId: OrganizationId!, $channelIds: [ChannelId!]) {
        posts(first: 10, input: { organizationId: $organizationId, filter: { channelIds: $channelIds } }) {
          edges {
            node {
              id
              text
              dueAt
              channelId
            }
          }
        }
      }`,
      { organizationId: bufferOrgId, channelIds }
    )

    return json(200, {
      bufferOrgId,
      channels: chData?.channels || [],
      postTypeFields: postType?.__type?.fields || [],
      posts: posts?.posts?.edges || [],
      connChannels: { instagram: conn.channel_instagram, facebook: conn.channel_facebook, tiktok: conn.channel_tiktok },
    })
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
