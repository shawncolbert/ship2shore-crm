import { admin } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'

// Receives everything from the team's Telegram group (registered as this
// bot's webhook via Telegram's setWebhook API): button taps AND the plain
// replies that follow "Set price & deposit," since Telegram delivers a
// force_reply answer as an ordinary message update, not a callback.
//
// Deliberate flow, per Shawn's call on 2026-08-27: never quote a customer
// a number the auto-estimate produced -- a dispatcher calls first, then
// sets the real price here. And never call anything an "invoice" until
// it's an actual payable document a human decided to send; "Text quote"
// below only ever sends a plain price + "call us to lock this in" email,
// no payment link, no invoice row. The real (payable) invoice still goes
// out the normal way, from inside the CRM, once the customer's verbally
// committed -- that's intentionally not automated from here.

const PRICE_PROMPT_PREFIX = 'Reply to THIS message with the total price and deposit, separated by a comma.\nExample: 1800, 500\n\nFor:'

async function telegramApi(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: res.ok, data: await res.json().catch(() => null) }
}

async function answerCallback(token, callbackQueryId, text) {
  await telegramApi(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: false })
}

async function editMessage(token, chatId, messageId, text) {
  await telegramApi(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text })
}

// opportunities has two FKs into contacts (contact_id and
// assigned_dispatcher_id) -- a plain contacts(...) embed is ambiguous and
// Supabase rejects it outright, which is why this needs the FK's actual
// constraint name as the embed hint.
async function fetchLead(opportunityId) {
  return admin
    .from('opportunities')
    .select('id, org_id, title, value, deposit_amount, contact_id, contacts!opportunities_contact_id_fkey(full_name, phone, email)')
    .eq('id', opportunityId).maybeSingle()
}

async function handleSetPrice({ token, chatId, callbackQuery, opportunityId }) {
  const { data: opp, error } = await fetchLead(opportunityId)
  if (error) return answerCallback(token, callbackQuery.id, `Lookup failed: ${error.message}`)
  if (!opp) return answerCallback(token, callbackQuery.id, 'That lead could not be found — it may have been deleted.')

  await answerCallback(token, callbackQuery.id)
  await telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `${PRICE_PROMPT_PREFIX} ${opp.contacts?.full_name || 'Unknown'} — ${opp.title || 'lead'}\nRef: ${opp.id}`,
    reply_markup: { force_reply: true },
  })
}

async function handlePriceReply({ token, chatId, message }) {
  const refMatch = message.reply_to_message?.text?.match(/Ref: ([0-9a-f-]{36})/i)
  if (!refMatch) return // not a reply to our price prompt -- ignore, could be unrelated group chatter

  const opportunityId = refMatch[1]
  const numbers = (message.text || '').match(/[\d,]+\.?\d*/g)?.map((n) => Number(n.replace(/,/g, ''))).filter((n) => !Number.isNaN(n))
  if (!numbers || numbers.length < 2) {
    // Carries the same Ref + force_reply as the original prompt, so
    // replying to THIS message also works -- without it, a mistyped
    // reply was a dead end: this bounce-back had no Ref for handlePriceReply
    // to find, so replying to it a second time was silently ignored.
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: `Could not read that — reply with two numbers, total then deposit. Example: 1800, 500\nRef: ${opportunityId}`,
      reply_markup: { force_reply: true },
    })
    return
  }
  const [total, deposit] = numbers

  const { data: opp, error } = await fetchLead(opportunityId)
  if (error || !opp) {
    await telegramApi(token, 'sendMessage', { chat_id: chatId, text: 'Could not find that lead anymore — it may have been deleted.', reply_to_message_id: message.message_id })
    return
  }

  const { error: updErr } = await admin
    .from('opportunities')
    .update({ value: total, deposit_amount: deposit })
    .eq('id', opportunityId).eq('org_id', opp.org_id)
  if (updErr) {
    await telegramApi(token, 'sendMessage', { chat_id: chatId, text: `Couldn't save that: ${updErr.message}`, reply_to_message_id: message.message_id })
    return
  }

  const canText = !!opp.contacts?.email
  await telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Saved — $${total.toLocaleString()} total, $${deposit.toLocaleString()} deposit, for ${opp.contacts?.full_name || 'this lead'}.${canText ? '' : ' No email on file, so "Text quote" won’t work until one’s added in the CRM.'}`,
    reply_markup: canText ? { inline_keyboard: [[{ text: '💬 Text quote to customer', callback_data: `tq:${opportunityId}` }]] } : undefined,
  })
}

async function handleTextQuote({ token, chatId, callbackQuery, opportunityId }) {
  const { data: opp, error } = await fetchLead(opportunityId)
  if (error) return answerCallback(token, callbackQuery.id, `Lookup failed: ${error.message}`)
  if (!opp) return answerCallback(token, callbackQuery.id, 'That lead could not be found.')
  if (!opp.contacts?.email) return answerCallback(token, callbackQuery.id, 'No email on file for this customer.')
  if (!opp.value) return answerCallback(token, callbackQuery.id, 'No price set yet — use "Set price & deposit" first.')

  const { data: org } = await admin.from('organizations').select('name, invoice_business_phone').eq('id', opp.org_id).maybeSingle()
  const orgName = org?.name || 'our team'
  const phoneLine = org?.invoice_business_phone ? `\n\nCall us at ${org.invoice_business_phone} to lock this in.` : '\n\nGive us a call to lock this in.'

  const depositLine = opp.deposit_amount ? `A deposit of $${Number(opp.deposit_amount).toLocaleString()} books your spot; the balance is due at delivery.` : ''

  const body = [
    `Hi ${opp.contacts.full_name || 'there'},`,
    '',
    `Here's your transport quote: $${Number(opp.value).toLocaleString()} total.`,
    depositLine,
    phoneLine,
    '',
    orgName,
  ].filter(Boolean).join('\n')

  try {
    await sendCustomerEmail({
      orgId: opp.org_id,
      to: opp.contacts.email,
      subject: `Your transport quote — ${orgName}`,
      body,
      contactId: opp.contact_id,
    })
  } catch (e) {
    return answerCallback(token, callbackQuery.id, `Email failed to send: ${String(e.message || e)}`)
  }

  await answerCallback(token, callbackQuery.id, 'Quote texted to customer')
  const msg = callbackQuery.message
  if (msg) await editMessage(token, msg.chat.id, msg.message_id, `${msg.text}\n\n✅ Quote texted — $${Number(opp.value).toLocaleString()}`)
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

  try {
    const callbackQuery = update.callback_query
    if (callbackQuery?.data) {
      const [action, id] = callbackQuery.data.split(':')
      const chatId = callbackQuery.message?.chat?.id
      if (action === 'sp' && id) {
        await handleSetPrice({ token, chatId, callbackQuery, opportunityId: id })
      } else if (action === 'tq' && id) {
        await handleTextQuote({ token, chatId, callbackQuery, opportunityId: id })
      } else {
        await answerCallback(token, callbackQuery.id, 'Unknown action')
      }
    } else if (update.message?.reply_to_message) {
      await handlePriceReply({ token, chatId: update.message.chat.id, message: update.message })
    }
  } catch (e) {
    console.error('❌ telegram-webhook failed:', e)
  }

  return { statusCode: 200, body: 'ok' }
}
