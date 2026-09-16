import { admin } from './_shared/supabaseAdmin.js'
import { sendOutreachEmail } from './_shared/outreachSend.js'
import { sendSms } from './_shared/twilioSend.js'

// Scheduled daily. Processes every org's due outreach_enrollments (status
// 'active', next_send_at already passed) -- gated per-org by the
// 'outreach' feature flag (System Controls), same on/off switch as every
// other add-on, checked fresh per org rather than cached across the whole
// run so a mid-run toggle takes effect immediately. do_not_contact is
// checked right before every send, no exceptions, regardless of how a
// prospect got suppressed (unsubscribe link, bounce, manual add).
//
// SMS steps (Phase 3) are opt-in only: a step with channel 'sms' only ever
// sends to a prospect with sms_opted_in = true -- set ONLY by the real
// inbound-SMS webhook (twilio-sms-webhook.js), never by hand. This is
// deliberately a separate field from the general `status` column staff use
// for pipeline tracking: replying to a cold outreach EMAIL is not consent
// to be texted, so a staff member flipping status to "replied" for pipeline
// reasons must never be able to unlock texting as a side effect. If an SMS
// step comes due and they haven't actually opted in yet, it's skipped (not
// sent, not retried) and the sequence just moves on to whatever's next,
// rather than stalling forever waiting for a reply that may never come.
export const handler = async () => {
  const nowIso = new Date().toISOString()
  const { data: due, error } = await admin
    .from('outreach_enrollments')
    .select('*, prospects(email, phone, business_name, status, sms_opted_in), outreach_sequences(steps, active)')
    .eq('status', 'active')
    .lte('next_send_at', nowIso)
  if (error) return { statusCode: 500, body: JSON.stringify({ error: error.message }) }

  let sent = 0
  let skipped = 0
  const featureCache = new Map()
  const suppressedEmailCache = new Map() // orgId -> Set(email)
  const suppressedPhoneCache = new Map() // orgId -> Set(phone)
  const limitCache = new Map() // orgId -> { email: number, sms: number }
  const sentTodayCount = new Map() // orgId -> { email: number, sms: number }, running count for this run

  const todayStartIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString()

  const orgHasOutreach = async (orgId) => {
    if (featureCache.has(orgId)) return featureCache.get(orgId)
    const { data: org } = await admin.from('organizations').select('enabled_features').eq('id', orgId).maybeSingle()
    const on = org?.enabled_features?.outreach !== false
    featureCache.set(orgId, on)
    return on
  }

  // Failsafe against a mass-enrollment (huge CSV import, "select all" +
  // enroll) blasting hundreds of sends in one run: each org has its own
  // daily email/SMS cap (organizations.outreach_daily_*_limit, editable in
  // Outreach settings). Once an org hits its cap for a channel, further due
  // sends on that channel are left alone (not marked sent, not advanced) so
  // they're simply picked up on tomorrow's run instead of being dropped.
  const underDailyCap = async (orgId, channel) => {
    if (!limitCache.has(orgId)) {
      const { data: org } = await admin.from('organizations')
        .select('outreach_daily_email_limit, outreach_daily_sms_limit').eq('id', orgId).maybeSingle()
      limitCache.set(orgId, {
        email: org?.outreach_daily_email_limit ?? 150,
        sms: org?.outreach_daily_sms_limit ?? 100,
      })
    }
    if (!sentTodayCount.has(orgId)) {
      const { count: emailCount } = await admin.from('outreach_sends')
        .select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('channel', 'email').gte('sent_at', todayStartIso)
      const { count: smsCount } = await admin.from('outreach_sends')
        .select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('channel', 'sms').gte('sent_at', todayStartIso)
      sentTodayCount.set(orgId, { email: emailCount || 0, sms: smsCount || 0 })
    }
    const limits = limitCache.get(orgId)
    const counts = sentTodayCount.get(orgId)
    return counts[channel] < limits[channel]
  }
  const isEmailSuppressed = async (orgId, email) => {
    if (!suppressedEmailCache.has(orgId)) {
      const { data } = await admin.from('do_not_contact').select('email').eq('org_id', orgId).not('email', 'is', null)
      suppressedEmailCache.set(orgId, new Set((data || []).map((r) => r.email.toLowerCase())))
    }
    return suppressedEmailCache.get(orgId).has(String(email || '').toLowerCase())
  }
  const isPhoneSuppressed = async (orgId, phone) => {
    if (!suppressedPhoneCache.has(orgId)) {
      const { data } = await admin.from('do_not_contact').select('phone').eq('org_id', orgId).not('phone', 'is', null)
      suppressedPhoneCache.set(orgId, new Set((data || []).map((r) => r.phone)))
    }
    return suppressedPhoneCache.get(orgId).has(phone)
  }

  const advance = async (enr, steps, nowIso2) => {
    const nextIndex = enr.current_step + 1
    const nextStep = steps[nextIndex]
    if (!nextStep) {
      await admin.from('outreach_enrollments').update({ status: 'completed', current_step: nextIndex, updated_at: nowIso2 }).eq('id', enr.id)
    } else {
      const delayDays = Number(nextStep.delay_days) || 0
      const nextSendAt = new Date(Date.now() + delayDays * 86400000).toISOString()
      await admin.from('outreach_enrollments')
        .update({ current_step: nextIndex, next_send_at: nextSendAt, updated_at: nowIso2 })
        .eq('id', enr.id)
    }
  }

  for (const enr of due || []) {
    const prospect = enr.prospects
    const sequence = enr.outreach_sequences
    const steps = Array.isArray(sequence?.steps) ? sequence.steps : []

    if (!sequence?.active || !prospect || prospect.status === 'do_not_contact') {
      await admin.from('outreach_enrollments').update({ status: 'stopped', updated_at: nowIso }).eq('id', enr.id)
      skipped++
      continue
    }
    if (!(await orgHasOutreach(enr.org_id))) { skipped++; continue }

    const step = steps[enr.current_step]
    if (!step) {
      await admin.from('outreach_enrollments').update({ status: 'completed', updated_at: nowIso }).eq('id', enr.id)
      skipped++
      continue
    }

    const channel = step.channel === 'sms' ? 'sms' : 'email'

    if (!(await underDailyCap(enr.org_id, channel))) { skipped++; continue }

    if (channel === 'sms') {
      // Opt-in gate: not opted in yet, or no phone on file -- skip this
      // step and move on, don't send, don't stall. sms_opted_in is set
      // only by an actual inbound text (see twilio-sms-webhook.js), never
      // by hand, so this can't be satisfied by a staff-entered status change.
      if (!prospect.sms_opted_in || !prospect.phone) { await advance(enr, steps, nowIso); skipped++; continue }
      if (await isPhoneSuppressed(enr.org_id, prospect.phone)) {
        await admin.from('outreach_enrollments').update({ status: 'stopped', updated_at: nowIso }).eq('id', enr.id)
        skipped++
        continue
      }
    } else {
      if (!prospect.email) { await advance(enr, steps, nowIso); skipped++; continue }
      if (await isEmailSuppressed(enr.org_id, prospect.email)) {
        await admin.from('outreach_enrollments').update({ status: 'stopped', updated_at: nowIso }).eq('id', enr.id)
        skipped++
        continue
      }
    }

    try {
      if (channel === 'sms') {
        const result = await sendSms({ orgId: enr.org_id, to: prospect.phone, body: step.body || '' })
        if (!result.sent) throw new Error(result.reason || 'SMS send failed')
      } else {
        await sendOutreachEmail({
          orgId: enr.org_id,
          to: prospect.email,
          subject: step.subject || '(no subject)',
          body: step.body || '',
          unsubscribeToken: enr.unsubscribe_token,
        })
      }
      await admin.from('outreach_sends').insert({
        org_id: enr.org_id, prospect_id: enr.prospect_id, sequence_id: enr.sequence_id,
        enrollment_id: enr.id, step_index: enr.current_step, subject: channel === 'email' ? (step.subject || null) : null,
        channel,
      })
      if (prospect.status === 'new') {
        await admin.from('prospects').update({ status: 'contacted', updated_at: nowIso }).eq('id', enr.prospect_id)
      }

      await advance(enr, steps, nowIso)
      sentTodayCount.get(enr.org_id)[channel]++
      sent++
    } catch (e) {
      console.error('❌ outreach-sequence-sender: send failed for enrollment', enr.id, e)
      skipped++ // a send hiccup for one prospect shouldn't block the rest of the batch
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, checked: due?.length || 0, sent, skipped }) }
}
