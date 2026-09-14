import { admin } from './_shared/supabaseAdmin.js'
import { sendOutreachEmail } from './_shared/outreachSend.js'

// Scheduled daily. Processes every org's due outreach_enrollments (status
// 'active', next_send_at already passed) -- gated per-org by the
// 'outreach' feature flag (System Controls), same on/off switch as every
// other add-on, checked fresh per org rather than cached across the whole
// run so a mid-run toggle takes effect immediately. do_not_contact is
// checked right before every send, no exceptions, regardless of how a
// prospect got suppressed (unsubscribe link, bounce, manual add).
export const handler = async () => {
  const nowIso = new Date().toISOString()
  const { data: due, error } = await admin
    .from('outreach_enrollments')
    .select('*, prospects(email, business_name, status), outreach_sequences(steps, active)')
    .eq('status', 'active')
    .lte('next_send_at', nowIso)
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }

  let sent = 0
  let skipped = 0
  const featureCache = new Map()
  const suppressedCache = new Map() // orgId -> Set(email)

  const orgHasOutreach = async (orgId) => {
    if (featureCache.has(orgId)) return featureCache.get(orgId)
    const { data: org } = await admin.from('organizations').select('enabled_features').eq('id', orgId).maybeSingle()
    const on = org?.enabled_features?.outreach !== false
    featureCache.set(orgId, on)
    return on
  }
  const isSuppressed = async (orgId, email) => {
    if (!suppressedCache.has(orgId)) {
      const { data } = await admin.from('do_not_contact').select('email').eq('org_id', orgId)
      suppressedCache.set(orgId, new Set((data || []).map((r) => r.email.toLowerCase())))
    }
    return suppressedCache.get(orgId).has(String(email || '').toLowerCase())
  }

  for (const enr of due || []) {
    const prospect = enr.prospects
    const sequence = enr.outreach_sequences
    const steps = Array.isArray(sequence?.steps) ? sequence.steps : []

    // Sequence got deactivated, or a prospect got manually marked
    // do-not-contact / converted since enrolling -- stop cleanly instead
    // of sending into a dead end.
    if (!sequence?.active || !prospect?.email || prospect.status === 'do_not_contact') {
      await admin.from('outreach_enrollments').update({ status: 'stopped', updated_at: nowIso }).eq('id', enr.id)
      skipped++
      continue
    }
    if (!(await orgHasOutreach(enr.org_id))) { skipped++; continue }
    if (await isSuppressed(enr.org_id, prospect.email)) {
      await admin.from('outreach_enrollments').update({ status: 'stopped', updated_at: nowIso }).eq('id', enr.id)
      skipped++
      continue
    }

    const step = steps[enr.current_step]
    if (!step) {
      await admin.from('outreach_enrollments').update({ status: 'completed', updated_at: nowIso }).eq('id', enr.id)
      skipped++
      continue
    }

    try {
      await sendOutreachEmail({
        orgId: enr.org_id,
        to: prospect.email,
        subject: step.subject || '(no subject)',
        body: step.body || '',
        unsubscribeToken: enr.unsubscribe_token,
      })
      await admin.from('outreach_sends').insert({
        org_id: enr.org_id, prospect_id: enr.prospect_id, sequence_id: enr.sequence_id,
        enrollment_id: enr.id, step_index: enr.current_step, subject: step.subject || null,
      })
      if (prospect.status === 'new') {
        await admin.from('prospects').update({ status: 'contacted', updated_at: nowIso }).eq('id', enr.prospect_id)
      }

      const nextIndex = enr.current_step + 1
      const nextStep = steps[nextIndex]
      if (!nextStep) {
        await admin.from('outreach_enrollments').update({ status: 'completed', current_step: nextIndex, updated_at: nowIso }).eq('id', enr.id)
      } else {
        const delayDays = Number(nextStep.delay_days) || 0
        const nextSendAt = new Date(Date.now() + delayDays * 86400000).toISOString()
        await admin.from('outreach_enrollments')
          .update({ current_step: nextIndex, next_send_at: nextSendAt, updated_at: nowIso })
          .eq('id', enr.id)
      }
      sent++
    } catch (e) {
      console.error('❌ outreach-sequence-sender: send failed for enrollment', enr.id, e)
      skipped++ // a Gmail hiccup for one prospect shouldn't block the rest of the batch
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, checked: due?.length || 0, sent, skipped }) }
}
