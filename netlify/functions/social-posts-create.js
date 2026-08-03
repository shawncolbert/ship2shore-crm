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

    const { text, imageUrl, scheduledDate } = JSON.parse(event.body || '{}')

    if (!text?.trim()) return json(400, { error: 'Post text is required' })
    if (!scheduledDate) return json(400, { error: 'Scheduled date is required' })

    const { data: post, error: postErr } = await supabase
      .from('social_posts')
      .insert({
        org_id: membership.org_id,
        text,
        image_url: imageUrl || null,
        scheduled_date: scheduledDate,
        status: 'draft',
      })
      .select()
      .single()

    if (postErr) return json(500, { error: postErr.message })

    return json(200, { post })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
