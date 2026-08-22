import { admin } from './_shared/supabaseAdmin.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Public, unauthenticated contract page -- the customer clicks a link from
// their email, no CRM login involved. Reads via the service-role client
// (contracts RLS is org-members-only) but only ever returns exactly the
// fields the sign page needs.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { id } = payload
  if (!id) return json(400, { error: 'Missing contract id' })

  const { data: contract, error } = await admin
    .from('contracts')
    .select('id, org_id, body, bill_to_name, total_price, deposit_amount, status, signer_name, signed_at, deposit_invoice_id, sent_at')
    .eq('id', id)
    .maybeSingle()
  if (error) return json(500, { error: error.message })
  if (!contract) return json(404, { error: 'Contract not found.' })

  const { data: org } = await admin
    .from('organizations').select('name, logo_url, invoice_business_name').eq('id', contract.org_id).maybeSingle()

  const { org_id, ...publicContract } = contract
  return json(200, { contract: publicContract, businessInfo: org || null })
}
