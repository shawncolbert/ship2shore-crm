import { admin } from './_shared/supabaseAdmin.js'
import { getDefaultPipeline, getIntakeStage } from './_shared/pipeline.js'
import { autoAssignDispatcher } from './_shared/dispatchAssignment.js'

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
    const { data: funnel, error: funnelErr } = await admin
      .from('funnels')
      .select('id, org_id')
      .eq('id', funnelId)
      .single()

    if (funnelErr || !funnel) return json(404, { error: 'Funnel not found' })

    const orgId = funnel.org_id

    // Check if contact exists by email
    let contact = null
    if (data.email) {
      const { data: existing } = await admin
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('email', data.email)
        .single()
      contact = existing
    }

    // Create or update contact
    if (!contact && data.full_name && data.email) {
      const { data: newContact, error: contactErr } = await admin
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
      const pipeline = await getDefaultPipeline(orgId)
      if (!pipeline) return json(500, { error: 'No default pipeline configured for this organization' })

      const stage = await getIntakeStage(orgId)
      if (!stage) return json(500, { error: 'This pipeline has no stages configured yet.' })

      const details = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(' | ')

      const { data: newOpp, error: oppErr } = await admin
        .from('opportunities')
        .insert({
          org_id: orgId,
          pipeline_id: pipeline.id,
          stage_id: stage.id,
          contact_id: contact.id,
          title: `${contact.full_name} - ${data.service_type || 'Funnel Lead'}${details ? ` (${details})` : ''}`,
        })
        .select('id')
        .single()

      if (oppErr) return json(500, { error: oppErr.message })

      // Hands the lead straight to whoever's next in the dispatcher
      // rotation, when the org has auto-assign turned on (Settings >
      // Dispatch Assignment). No-ops -- leaves the job unassigned for
      // manual pick -- when it's off or nobody's marked "in rotation".
      // Never blocks the customer's submission on a notification hiccup.
      try {
        await autoAssignDispatcher({ orgId, opportunityId: newOpp.id })
      } catch (e) {
        console.error('❌ autoAssignDispatcher failed:', e)
      }
    }

    // Log submission
    const { error: logErr } = await admin
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
