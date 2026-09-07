import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Self-reported "I actually posted this" for platforms with no real
// connection yet (Instagram/Facebook always, TikTok when auto-publish
// isn't on) -- the CRM has no way to detect a manual post made on your
// phone, so this just gives Shawn his own record of what's done vs. still
// sitting as a draft, instead of no tracking at all.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { postId } = payload
  if (!postId) return json(400, { error: 'postId is required' })

  const { data: updated, error } = await admin
    .from('social_posts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', postId)
    .eq('org_id', orgId)
    .select()
    .single()

  if (error) return json(500, { error: error.message })
  if (!updated) return json(404, { error: 'Post not found' })

  return json(200, { post: updated })
}
