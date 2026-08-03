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

    const { data: posts, error: postsErr } = await admin
      .from('social_posts')
      .select('*')
      .eq('org_id', orgId)
      .order('scheduled_date', { ascending: true })

    if (postsErr) return json(500, { error: postsErr.message })

    return json(200, { posts: posts || [] })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
