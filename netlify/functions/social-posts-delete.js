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

    const { postId } = JSON.parse(event.body || '{}')

    if (!postId) return json(400, { error: 'Post ID is required' })

    const { data: post } = await supabase
      .from('social_posts')
      .select('org_id')
      .eq('id', postId)
      .single()

    if (!post || post.org_id !== membership.org_id) {
      return json(403, { error: 'Unauthorized' })
    }

    const { error: delErr } = await supabase
      .from('social_posts')
      .delete()
      .eq('id', postId)

    if (delErr) return json(500, { error: delErr.message })

    return json(200, { success: true })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
