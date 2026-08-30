import { admin } from './_shared/supabaseAdmin.js'
import { sendPushToOrgOwners } from './_shared/webPush.js'

// Runs every 5 minutes (see netlify.toml). For every lead the
// unfollowed_lead_alerts view flags (10+ min assigned, no reply from the
// dispatcher's own inbox, card hasn't moved -- see the view definition and
// dispatchAssignment.js's markAssigned), pushes a notification to the org's
// owner(s) so Shawn finds out on his phone instead of having to have the
// CRM open. Per lead, only re-pushes every 20+ minutes (tracked via
// opportunities.unfollowed_push_sent_at) so a still-stuck lead nags again
// periodically without firing on every single 5-minute tick.
export const handler = async () => {
  const { data: alerts, error } = await admin
    .from('unfollowed_lead_alerts')
    .select('opportunity_id, org_id, title, dispatcher_name, dispatcher_company, customer_name, assigned_at')
  if (error) {
    console.error('❌ check-unfollowed-leads: could not read alerts:', error)
    return { statusCode: 200, body: 'ok' }
  }
  if (!alerts?.length) return { statusCode: 200, body: 'ok' }

  const opportunityIds = alerts.map((a) => a.opportunity_id)
  const { data: sentRows } = await admin
    .from('opportunities').select('id, unfollowed_push_sent_at').in('id', opportunityIds)
  const sentAtById = Object.fromEntries((sentRows || []).map((r) => [r.id, r.unfollowed_push_sent_at]))

  const RENOTIFY_MS = 20 * 60 * 1000
  const now = Date.now()
  const due = alerts.filter((a) => {
    const last = sentAtById[a.opportunity_id]
    return !last || now - new Date(last).getTime() > RENOTIFY_MS
  })

  for (const a of due) {
    const dispatcherLabel = a.dispatcher_name || a.dispatcher_company || 'A dispatcher'
    try {
      await sendPushToOrgOwners({
        orgId: a.org_id,
        title: `${dispatcherLabel} hasn't followed up`,
        body: `${a.customer_name || 'A lead'}${a.title ? ` — ${a.title}` : ''} — assigned and untouched.`,
        url: `/pipeline?job=${a.opportunity_id}`,
      })
      await admin.from('opportunities').update({ unfollowed_push_sent_at: new Date().toISOString() }).eq('id', a.opportunity_id)
    } catch (e) {
      console.error('❌ check-unfollowed-leads: push failed for', a.opportunity_id, e)
    }
  }

  return { statusCode: 200, body: 'ok' }
}
