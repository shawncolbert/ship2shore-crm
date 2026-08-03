import { admin, userFromToken, orgForUser } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })

  const { funnelId: incomingFunnelId, name, description, steps } = JSON.parse(event.body || '{}')

  if (!name?.trim()) return json(400, { error: 'Name required' })
  if (!steps?.length || steps.length < 2) return json(400, { error: 'At least 2 steps required' })

  // Get user's org
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No organization' })

  // Generate slug
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  try {
    let funnelId = incomingFunnelId

    if (funnelId) {
      // Update existing funnel
      const { error: updateErr } = await admin
        .from('funnels')
        .update({ name, description, updated_at: new Date().toISOString() })
        .eq('id', funnelId)
        .eq('org_id', orgId)

      if (updateErr) return json(500, { error: updateErr.message })

      // Delete old steps
      await admin.from('funnel_steps').delete().eq('funnel_id', funnelId)
    } else {
      // Create new funnel
      const { data: funnel, error: createErr } = await admin
        .from('funnels')
        .insert({
          org_id: orgId,
          name,
          description,
          slug,
          published: false,
        })
        .select()
        .single()

      if (createErr) return json(500, { error: createErr.message })
      funnelId = funnel.id
    }

    // Create steps
    const stepsToInsert = steps.map((step, idx) => ({
      funnel_id: funnelId,
      step_number: idx + 1,
      title: step.title || `Step ${idx + 1}`,
      description: step.description || '',
      fields: step.fields || [],
    }))

    const { error: stepsErr } = await admin
      .from('funnel_steps')
      .insert(stepsToInsert)

    if (stepsErr) return json(500, { error: stepsErr.message })

    return json(200, { success: true, funnelId })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
