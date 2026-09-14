import { admin } from './_shared/supabaseAdmin.js'

const html = (body) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
  body: `<!doctype html><html><body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center;color:#16232f;">${body}</body></html>`,
})

// Public, unauthenticated by necessity -- an unsubscribe link has to work
// without the recipient signing into anything. The token is per-enrollment
// (generated once, reused for every step of that sequence), so it only
// ever reveals/affects one prospect's own subscription, nothing else.
export const handler = async (event) => {
  const token = event.queryStringParameters?.token
  if (!token) return html('<h2>Missing link</h2><p>This unsubscribe link looks incomplete.</p>')

  const { data: enrollment } = await admin
    .from('outreach_enrollments')
    .select('id, org_id, prospect_id, prospects(email)')
    .eq('unsubscribe_token', token)
    .maybeSingle()
  if (!enrollment) return html('<h2>Link not found</h2><p>This unsubscribe link is no longer valid.</p>')

  const email = enrollment.prospects?.email
  if (email) {
    // Manual check-then-insert, not upsert -- the uniqueness here is
    // enforced by an expression index (org_id, lower(email)), which
    // PostgREST's onConflict can't target directly (same reason
    // createContactWithBooking in src/lib/supabase.js does the same thing).
    const { data: already } = await admin
      .from('do_not_contact').select('id').eq('org_id', enrollment.org_id).ilike('email', email).maybeSingle()
    if (!already) {
      await admin.from('do_not_contact').insert({ org_id: enrollment.org_id, email: email.toLowerCase(), reason: 'unsubscribed' })
    }
    await admin.from('prospects').update({ status: 'do_not_contact' }).eq('id', enrollment.prospect_id)
  }
  await admin.from('outreach_enrollments').update({ status: 'stopped' }).eq('id', enrollment.id)

  return html("<h2>You're unsubscribed</h2><p>You won't receive any more emails from this sequence.</p>")
}
