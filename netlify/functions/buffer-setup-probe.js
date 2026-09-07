// One-time setup helper -- NOT part of the ongoing publish flow. Buffer's
// GraphQL API is still young enough that its exact field names for
// createPost aren't reliably documented outside their own site (which this
// sandbox can't reach to double check). Rather than guess and find out only
// when a real scheduled post silently fails, this asks Buffer's own schema
// what it expects: connected channels (so we know the real channelId for
// Instagram/Facebook/TikTok) and the live shape of CreatePostInput (so
// buffer-publish.js is built against what Buffer actually accepts, not a
// blog post's guess). Gated by BUFFER_SETUP_TOKEN so this doesn't need a
// logged-in CRM session to view -- open the URL with ?key=<token>.
// Safe to delete once buffer-publish.js is confirmed working.

const BUFFER_ENDPOINT = 'https://api.buffer.com/buffer/'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body, null, 2),
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

function unwrapType(t) {
  // Peels NON_NULL / LIST wrappers down to the named type.
  let cur = t
  while (cur && !cur.name && cur.ofType) cur = cur.ofType
  return cur?.name || null
}

export const handler = async (event) => {
  const key = event.queryStringParameters?.key
  if (!process.env.BUFFER_SETUP_TOKEN || key !== process.env.BUFFER_SETUP_TOKEN) {
    return json(403, { error: 'Forbidden' })
  }
  if (!process.env.BUFFER_API_KEY) return json(500, { error: 'BUFFER_API_KEY not set' })
  const apiKey = process.env.BUFFER_API_KEY

  try {
    const result = {}

    // 1. Organization + channels (need the real channelId per platform).
    const orgData = await gql(apiKey, `query { account { organizations { id } } }`)
    const bufferOrgId = orgData?.account?.organizations?.[0]?.id
    result.bufferOrgId = bufferOrgId || null

    if (bufferOrgId) {
      const chData = await gql(
        apiKey,
        `query GetChannels($organizationId: OrganizationId!) { channels(input: { organizationId: $organizationId }) { id name service } }`,
        { organizationId: bufferOrgId }
      )
      result.channels = chData?.channels || []
    } else {
      result.channelsError = 'No organization id returned -- see raw org query below'
      result.rawOrgQuery = orgData
    }

    // 2. Introspect CreatePostInput so buffer-publish.js is built against
    // the real field names/enum values instead of a guess.
    const inputSchema = await gql(
      apiKey,
      `query { __type(name: "CreatePostInput") { name inputFields { name type { name kind ofType { name kind ofType { name kind } } } } } }`
    )
    result.createPostInputFields = inputSchema?.__type?.inputFields || []

    // 3. For every non-scalar field type found above (likely enums or
    // nested input objects like the image/asset field), introspect it too.
    const nestedTypeNames = [...new Set(
      (result.createPostInputFields || [])
        .map((f) => unwrapType(f.type))
        .filter((name) => name && !['String', 'Boolean', 'Int', 'Float', 'ID'].includes(name))
    )]
    result.nestedTypes = {}
    for (const typeName of nestedTypeNames) {
      try {
        const t = await gql(
          apiKey,
          `query($n: String!) { __type(name: $n) { name kind enumValues { name } inputFields { name type { name kind ofType { name kind } } } } }`,
          { n: typeName }
        )
        result.nestedTypes[typeName] = t?.__type || null
      } catch (e) {
        result.nestedTypes[typeName] = { error: String(e.message || e) }
      }
    }

    // 4. The createPost mutation's return type (union members), so the
    // response-handling fragment names (PostActionSuccess / MutationError
    // per public examples) are confirmed rather than assumed.
    try {
      const returnType = await gql(
        apiKey,
        `query { __schema { mutationType { fields(includeDeprecated: true) { name type { name kind ofType { name } } } } } }`
      )
      const createPostField = returnType?.__schema?.mutationType?.fields?.find((f) => f.name === 'createPost')
      result.createPostReturnTypeRaw = createPostField || null
    } catch (e) {
      result.createPostReturnTypeError = String(e.message || e)
    }

    return json(200, result)
  } catch (e) {
    return json(500, { error: String(e.message || e) })
  }
}
