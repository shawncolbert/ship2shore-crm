import { admin } from './_shared/supabaseAdmin.js'
import { sendInvoiceCore } from './_shared/sendInvoiceCore.js'

// Receives button taps from the team's Telegram group (registered as this
// bot's webhook via Telegram's setWebhook API, with a secret_token so this
// endpoint can tell a real Telegram request from a spoofed POST). Handles
// only "sq:<opportunity_id>" (Send Quote) -- "Call customer" and "Open in
// CRM" are plain url: buttons Telegram opens itself, no webhook involved.
//
// Editing the amount inline in Telegram isn't built -- that needs a
// stateful reply-and-wait conversation the bot doesn't track yet, so a
// dispatcher who wants a different number taps "Open in CRM" instead and
// uses the Price estimator there, same as always.

async function answerCallback(token, callbackQueryId, text) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
  })
}

async function editMessage(token, chatId, messageId, text) {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text }),
  })
}

async function handleSendQuote({ event, token, callbackQuery, opportunityId }) {
  // Same ambiguous-embed trap as telegramDispatch.js -- opportunities has
  // two FKs into contacts, so a plain contacts(...) embed fails outright
  // and this silently fell into the "not found" branch below every time,
  // which is why tapping the button never actually created an invoice.
  const { data: opp, error: oppErr } = await admin
    .from('opportunities')
    .select('id, org_id, title, value, confirmed_price, contact_id, contacts!opportunities_contact_id_fkey(full_name, phone, email)')
    .eq('id', opportunityId).maybeSingle()
  if (oppErr) return answerCallback(token, callbackQuery.id, `Lookup failed: ${oppErr.message}`)
  if (!opp) return answerCallback(token, callbackQuery.id, 'That lead could not be found — it may have been deleted.')

  if (!opp.contacts?.email) {
    return answerCallback(token, callbackQuery.id, 'No email on file for this customer — add one in the CRM before sending a quote.')
  }

  const { estimateLeadQuote } = await import('./_shared/telegramDispatch.js')
  const { data: fullOpp } = await admin
    .from('opportunities').select('pickup_address, dropoff_address, scheduled_at').eq('id', opportunityId).maybeSingle()
  const quote = await estimateLeadQuote({ pickupAddress: fullOpp?.pickup_address, dropoffAddress: fullOpp?.dropoff_address, scheduledAt: fullOpp?.scheduled_at })
  const amount = quote?.amount ?? opp.confirmed_price ?? opp.value
  if (!amount) return answerCallback(token, callbackQuery.id, 'Could not calculate a quote for this lead — open it in the CRM to price it manually.')

  await admin.from('opportunities').update({ value: amount, confirmed_price: amount }).eq('id', opp.id)

  const { data: invoice, error: invErr } = await admin
    .from('invoices')
    .insert({
      org_id: opp.org_id,
      contact_id: opp.contact_id,
      opportunity_id: opp.id,
      bill_to_name: opp.contacts.full_name || null,
      bill_to_phone: opp.contacts.phone || null,
      bill_to_email: opp.contacts.email,
      invoice_date: new Date().toISOString().slice(0, 10),
      subtotal: amount,
      total: amount,
      amount_due: amount,
      status: 'draft',
      payment_options: { stripe: true, zelle: true },
      kind: 'invoice',
    })
    .select('*').single()
  if (invErr || !invoice) return answerCallback(token, callbackQuery.id, `Could not create the invoice: ${invErr?.message || 'unknown error'}`)

  await admin.from('invoice_line_items').insert({
    org_id: opp.org_id, invoice_id: invoice.id,
    description: opp.title || 'Vehicle transport', quantity: 1, unit_price: amount, line_total: amount, sort_order: 0,
  })

  const result = await sendInvoiceCore({ invoice, orgId: opp.org_id, event })
  if (!result.ok) {
    await answerCallback(token, callbackQuery.id, `Invoice created but the email failed: ${result.error}`)
  } else {
    await answerCallback(token, callbackQuery.id, `Quote sent — $${amount.toLocaleString()}`)
  }

  const msg = callbackQuery.message
  if (msg) {
    await editMessage(token, msg.chat.id, msg.message_id, `${msg.text}\n\n✅ Quote sent — $${amount.toLocaleString()}`)
  }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (secret && event.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return { statusCode: 401, body: 'Unauthorized' }
  }

  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { statusCode: 200, body: 'ok' } // not configured -- ack and drop

  let update
  try { update = JSON.parse(event.body || '{}') } catch { return { statusCode: 200, body: 'ok' } }

  const callbackQuery = update.callback_query
  if (!callbackQuery?.data) return { statusCode: 200, body: 'ok' }

  const [action, id] = callbackQuery.data.split(':')
  try {
    if (action === 'sq' && id) {
      await handleSendQuote({ event, token, callbackQuery, opportunityId: id })
    } else {
      await answerCallback(token, callbackQuery.id, 'Unknown action')
    }
  } catch (e) {
    await answerCallback(token, callbackQuery.id, `Something went wrong: ${String(e.message || e)}`)
  }

  return { statusCode: 200, body: 'ok' }
}
