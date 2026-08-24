import { admin } from './_shared/supabaseAdmin.js'
import { sendInternalAlert } from './_shared/email.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// Public, unauthenticated -- the customer's own signature action. Records
// the signature, then automatically creates the deposit invoice as a draft
// -- correct customer, correct amount, ready to go -- so the dispatcher
// isn't starting from a blank form. It stays a draft on purpose: sending it
// (via the same "Approve"/"Send invoice" action every other invoice uses)
// is a separate, deliberate step a human takes, not something that fires
// itself the moment a customer taps sign.
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' })

  let payload
  try { payload = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Bad JSON' }) }
  const { id, signerName } = payload
  if (!id) return json(400, { error: 'Missing contract id' })

  const { data: contract, error: cErr } = await admin
    .from('contracts').select('*').eq('id', id).maybeSingle()
  if (cErr) return json(500, { error: cErr.message })
  if (!contract) return json(404, { error: 'Contract not found.' })

  // Already signed -- return the existing state instead of erroring, so a
  // double-tap or a page refresh after signing doesn't look like a failure.
  if (contract.status === 'signed') {
    return json(200, {
      ok: true, alreadySigned: true, status: 'signed',
      signerName: contract.signer_name, signedAt: contract.signed_at,
      depositInvoiceId: contract.deposit_invoice_id,
    })
  }
  if (contract.status === 'void') return json(400, { error: 'This agreement is no longer active.' })

  const name = String(signerName || '').trim()
  if (!name) return json(400, { error: 'Please type your name to sign.' })

  const signerIp =
    event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || null

  const { error: updErr } = await admin.from('contracts').update({
    status: 'signed', signer_name: name, signed_at: new Date().toISOString(), signer_ip: signerIp,
  }).eq('id', id)
  if (updErr) return json(500, { error: updErr.message })

  const { data: opp } = await admin
    .from('opportunities')
    .select('id, org_id, title, booking_number, contact_id, dropoff_address, vehicle, vehicle_year, vehicle_make, vehicle_model, contacts!contact_id(id, full_name, email, phone)')
    .eq('id', contract.opportunity_id).maybeSingle()
  const contact = opp?.contacts

  const vehicleDescription = opp?.vehicle || [opp?.vehicle_year, opp?.vehicle_make, opp?.vehicle_model].filter(Boolean).join(' ') || 'vehicle transport'

  if (!(Number(contract.deposit_amount) > 0)) {
    await sendInternalAlert({
      orgId: contract.org_id,
      subject: `Contract signed — ${name}`,
      body: `${name} just signed the booking agreement for ${vehicleDescription}.\n\nNo deposit amount was set, so no invoice was created automatically.`,
    })
    return json(200, { ok: true, status: 'signed', depositInvoiceId: null })
  }

  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .insert({
      org_id: contract.org_id,
      contact_id: contact?.id || null,
      po_number: opp?.booking_number || null,
      bill_to_name: contract.bill_to_name || contact?.full_name || null,
      bill_to_email: contract.bill_to_email || contact?.email || null,
      bill_to_phone: contact?.phone || null,
      ship_to_name: contact?.full_name || null,
      ship_to_address: opp?.dropoff_address || null,
      ship_to_phone: contact?.phone || null,
      subtotal: contract.deposit_amount, total: contract.deposit_amount, amount_due: contract.deposit_amount,
      status: 'draft',
      // Zelle always included, per policy -- see lib/invoices.js.
      payment_options: { stripe: true, zelle: true },
      opportunity_id: contract.opportunity_id,
      kind: 'deposit',
    })
    .select('*')
    .single()
  if (invErr) return json(500, { error: invErr.message })

  await admin.from('invoice_line_items').insert({
    org_id: contract.org_id,
    invoice_id: invoice.id,
    description: `Deposit — ${vehicleDescription}`,
    quantity: 1, unit_price: contract.deposit_amount, line_total: contract.deposit_amount, sort_order: 0,
  })

  await admin.from('contracts').update({ deposit_invoice_id: invoice.id }).eq('id', id)

  await sendInternalAlert({
    orgId: contract.org_id,
    subject: `Contract signed — ${name}`,
    body:
      `${name} just signed the booking agreement for ${vehicleDescription}.\n\n` +
      `Booking: ${opp?.booking_number || '—'}\n` +
      `Deposit: $${Number(contract.deposit_amount).toFixed(2)}\n` +
      `A deposit invoice (${invoice.invoice_number}) is drafted and ready — approve it under Invoices to send it to the customer.`,
  })

  return json(200, {
    ok: true, status: 'signed',
    depositInvoiceId: invoice.id,
  })
}
