import { supabase } from './_shared/supabase.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const handler = async (event) => {
  const { funnelId, data } = JSON.parse(event.body || '{}')

  if (!funnelId || !data) return json(400, { error: 'Missing funnel ID or data' })

  try {
    // Get funnel to find org
    const { data: funnel, error: funnelErr } = await supabase
      .from('funnels')
      .select('id, org_id')
      .eq('id', funnelId)
      .single()

    if (funnelErr || !funnel) return json(404, { error: 'Funnel not found' })

    const orgId = funnel.org_id

    // Check if contact exists by email
    let contact = null
    if (data.email) {
      const { data: existing } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('email', data.email)
        .single()
      contact = existing
    }

    // Create or update contact
    if (!contact && data.full_name && data.email) {
      const { data: newContact, error: contactErr } = await supabase
        .from('contacts')
        .insert({
          org_id: orgId,
          full_name: data.full_name,
          email: data.email,
          phone: data.phone || null,
          company: null,
          tags: ['from-funnel'],
        })
        .select()
        .single()

      if (contactErr) return json(500, { error: contactErr.message })
      contact = newContact
    }

    // Create opportunity
    if (contact) {
      // Get default pipeline and first stage
      const { data: pipeline } = await supabase
        .from('pipelines')
        .select('id')
        .eq('org_id', orgId)
        .eq('is_default', true)
        .single()

      const { data: firstStage } = await supabase
        .from('stages')
        .select('id')
        .eq('pipeline_id', pipeline?.id)
        .order('position', { ascending: true })
        .limit(1)
        .single()

      const { error: oppErr } = await supabase
        .from('opportunities')
        .insert({
          org_id: orgId,
          pipeline_id: pipeline?.id,
          stage_id: firstStage?.id,
          contact_id: contact.id,
          title: data.service_type || 'Funnel Lead',
          value: null,
          description: Object.entries(data)
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n'),
        })

      if (oppErr) return json(500, { error: oppErr.message })
    }

    // Log submission
    const { error: logErr } = await supabase
      .from('funnel_submissions')
      .insert({
        funnel_id: funnelId,
        contact_id: contact?.id,
        data,
      })

    if (logErr) return json(500, { error: logErr.message })

    return json(200, { success: true, contactId: contact?.id })
  } catch (e) {
    return json(500, { error: e.message })
  }
}
