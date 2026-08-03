import { supabase } from './_shared/supabase.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  try {
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json(401, { error: 'Unauthorized' })

    const { data: membership } = await supabase
      .from('memberships')
      .select('org_id')
      .eq('profile_id', user.id)
      .single()

    if (!membership) return json(403, { error: 'No org membership' })

    const { data: posts, error: postsErr } = await supabase
      .from('social_posts')
      .select('*')
      .eq('org_id', membership.org_id)
      .order('scheduled_date', { ascending: true })

    if (postsErr) return json(500, { error: postsErr.message })

    return json(200, { posts: posts || [] })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
