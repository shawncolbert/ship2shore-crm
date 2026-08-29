import { admin } from './_shared/supabaseAdmin.js'
import { sendCustomerEmail } from './_shared/email.js'
import { isFlatRateLead } from './_shared/telegramDispatch.js'

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
    .select('id, org_id, title, value, deposit_amount, escort_fee, pickup_address, dropoff_address, contact_id, contacts!opportunities_contact_id_fkey(full_name, phone, email)')
    .eq('id', opportunityId).maybeSingle()
}

async function handleSetPrice({ token, chatId, callbackQuery, opportunityId }) {
  const { data: opp, error } = await fetchLead(opportunityId)
  if (error) return answerCallback(token, callbackQuery.id, `Lookup failed: ${error.message}`)
  if (!opp) return answerCallback(token, callbackQuery.id, 'That lead could not be found — it may have been deleted.')

  await answerCallback(token, callbackQuery.id)
  // A flat-rate catalog lead (TWIC/Hotshot/Semi-Container/Military) has no
  // deposit concept -- prompting for "total, deposit" and rejecting a
  // single-number reply was forcing a fake "95, 0" every time. Ask for just
  // the one number instead.
  const prompt = isFlatRateLead(opp)
    ? 'Reply to THIS message with the corrected flat fee -- just one number, no deposit.\nExample: 90\n\nFor:'
    : PRICE_PROMPT_PREFIX
  await telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `${prompt} ${opp.contacts?.full_name || 'Unknown'} — ${opp.title || 'lead'}\nRef: ${opp.id}`,
    reply_markup: { force_reply: true },
  })
}

async function handlePriceReply({ token, chatId, message }) {
  const refMatch = message.reply_to_message?.text?.match(/Ref: ([0-9a-f-]{36})/i)
  if (!refMatch) return // not a reply to our price prompt -- ignore, could be unrelated group chatter

  const opportunityId = refMatch[1]
  const { data: opp, error } = await fetchLead(opportunityId)
  if (error || !opp) {
    await telegramApi(token, 'sendMessage', { chat_id: chatId, text: 'Could not find that lead anymore — it may have been deleted.', reply_to_message_id: message.message_id })
    return
  }

  const numbers = (message.text || '').match(/[\d,]+\.?\d*/g)?.map((n) => Number(n.replace(/,/g, ''))).filter((n) => !Number.isNaN(n))
  const flat = isFlatRateLead(opp)

  if (flat) {
    if (!numbers || numbers.length < 1) {
      // Carries the same Ref + force_reply as the original prompt, so
      // replying to THIS message also works.
      await telegramApi(token, 'sendMessage', {
        chat_id: chatId,
        text: `Could not read that — reply with just the flat fee amount. Example: 90\nRef: ${opportunityId}`,
        reply_markup: { force_reply: true },
      })
      return
    }
    const [amount] = numbers
    const { error: updErr } = await admin
      .from('opportunities')
      .update({ value: amount })
      .eq('id', opportunityId).eq('org_id', opp.org_id)
    if (updErr) {
      await telegramApi(token, 'sendMessage', { chat_id: chatId, text: `Couldn't save that: ${updErr.message}`, reply_to_message_id: message.message_id })
      return
    }
    const canText = !!opp.contacts?.email
    await telegramApi(token, 'sendMessage', {
      chat_id: chatId,
      text: `Saved — $${amount.toLocaleString()} flat fee for ${opp.contacts?.full_name || 'this lead'}.${canText ? '' : ' No email on file, so "Text quote" won’t work until one’s added in the CRM.'}`,
      reply_markup: canText ? { inline_keyboard: [[{ text: '💬 Text quote to customer', callback_data: `tq:${opportunityId}` }]] } : undefined,
    })
    return
  }

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

  const { error: updErr } = await admin
    .from('opportunities')
    .update({ value: total, deposit_amount: deposit })
    .eq('id', opportunityId).eq('org_id', opp.org_id)
  if (updErr) {
    await telegramApi(token, 'sendMessage', { chat_id: chatId, text: `Couldn't save that: ${updErr.message}`, reply_to_message_id: message.message_id })
    return
  }

  const canText = !!opp.contacts?.email
  // escort_fee (set automatically for port-escort leads, never touched by
  // this reply) is called out separately here on purpose -- it's a flat fee
  // with no deposit, not part of the total/deposit just saved above.
  const escortNote = opp.escort_fee ? ` Plus the $${opp.escort_fee.toLocaleString()} port escort fee (flat, no deposit) — not affected by this.` : ''
  await telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Saved — $${total.toLocaleString()} transport total, $${deposit.toLocaleString()} deposit, for ${opp.contacts?.full_name || 'this lead'}.${escortNote}${canText ? '' : ' No email on file, so "Text quote" won’t work until one’s added in the CRM.'}`,
    reply_markup: canText ? { inline_keyboard: [[{ text: '💬 Text quote to customer', callback_data: `tq:${opportunityId}` }]] } : undefined,
  })
}

async function handleTextQuote({ token, chatId, callbackQuery, opportunityId }) {
  const { data: opp, error } = await fetchLead(opportunityId)
  if (error) return answerCallback(token, callbackQuery.id, `Lookup failed: ${error.message}`)
  if (!opp) return answerCallback(token, callbackQuery.id, 'That lead could not be found.')
  if (!opp.contacts?.email) return answerCallback(token, callbackQuery.id, 'No email on file for this customer.')
  // == null (not falsy) on purpose -- an escort-only lead has value = 0,
  // which is a real, deliberately-set price, not "nothing set yet".
  if (opp.value == null) return answerCallback(token, callbackQuery.id, 'No price set yet — use "Set price & deposit" first.')

  const { data: org } = await admin.from('organizations').select('name, invoice_business_phone').eq('id', opp.org_id).maybeSingle()
  const orgName = org?.name || 'our team'

  // Escort-only leads have value = 0 (see handleEscortOnly) -- a fixed,
  // no-variables $95 is the one case Shawn wants a real self-serve pay link
  // for (2026-08-28); transport still always requires a call first, since
  // rural/lifted/running condition can change that number. Wave has no API
  // to generate a checkout link per quote, so this reuses whatever link was
  // saved by hand in Payment Settings > Wave Checkout links, matched by
  // amount -- Shawn creates one for $95 in Wave once, pastes it in, done.
  const isEscortOnly = Number(opp.value) === 0 && !!opp.escort_fee
  const isFlatCatalog = isFlatRateLead(opp)
  let escortCheckoutUrl = null
  if (isEscortOnly) {
    const { data: link } = await admin
      .from('wave_checkout_links').select('url').eq('org_id', opp.org_id).eq('amount', opp.escort_fee).limit(1).maybeSingle()
    escortCheckoutUrl = link?.url || null
  }

  let subject, body
  if (isFlatCatalog) {
    // TWIC Vehicle Escort, Hotshot, Semi/Container, Military -- no transport
    // involved, so this shouldn't read like a mileage quote. The specific
    // service name isn't on the opportunity itself (only in the CRM's
    // landing-page intake note), so this names it generically as a
    // flat-rate service fee rather than guessing which one.
    const phoneLine = org?.invoice_business_phone ? `\n\nCall us at ${org.invoice_business_phone} to lock this in.` : '\n\nGive us a call to lock this in.'
    subject = `Your quote — ${orgName}`
    body = [
      `Hi ${opp.contacts.full_name || 'there'},`,
      '',
      `Here's your quote:`,
      `Flat-rate service fee: $${Number(opp.value).toLocaleString()} (due in full, no deposit).`,
      phoneLine,
      '',
      orgName,
    ].filter(Boolean).join('\n')
  } else if (isEscortOnly) {
    subject = `Port Escort Service Quote — ${orgName}`
    const lockInLine = escortCheckoutUrl
      ? `To lock in your escort date & time, click below to pay the flat-rate fee. Once paid, our TWIC-certified port escort team is officially locked in for your terminal gate time.\n\n👉 Pay $${Number(opp.escort_fee).toLocaleString()} escort fee & confirm: ${escortCheckoutUrl}`
      : org?.invoice_business_phone ? `To lock in your escort date & time, call us at ${org.invoice_business_phone}.` : 'To lock in your escort date & time, give us a call.'
    body = [
      `Hi ${opp.contacts.full_name || 'there'},`,
      '',
      `Thanks for reaching out to ${orgName} for your port escort requirements.`,
      '',
      'Here is your flat-rate quote for the TWIC-certified vehicle escort:',
      '',
      'Service: Port Escort / Entry Specialist Service',
      `Port Escort Fee: $${Number(opp.escort_fee).toLocaleString()}.00 (due in full, no deposit required)`,
      `Pickup / Location: ${opp.pickup_address || "we'll confirm the exact terminal details with you directly"}`,
      '',
      lockInLine,
      '',
      `If you need to adjust the terminal schedule or have any questions, reply directly to this email${org?.invoice_business_phone ? ` or call us at ${org.invoice_business_phone}` : ''}.`,
      '',
      'Thanks,',
      orgName,
    ].filter(Boolean).join('\n')
  } else {
    const phoneLine = org?.invoice_business_phone ? `\n\nCall us at ${org.invoice_business_phone} to lock this in.` : '\n\nGive us a call to lock this in.'
    const transportLine = Number(opp.value) > 0 ? `Transport: $${Number(opp.value).toLocaleString()} total.` : null
    const depositLine = opp.deposit_amount && Number(opp.deposit_amount) > 0 ? `A deposit of $${Number(opp.deposit_amount).toLocaleString()} books your spot; the balance is due at delivery.` : null
    // Escort fee is flat and never carries a deposit -- called out as its
    // own line so the customer isn't surprised it's not folded into the
    // transport total/deposit above. (Combined jobs still always need a
    // call -- only the pure escort-only case above gets a pay link.)
    const escortLine = opp.escort_fee ? `Port escort fee: $${Number(opp.escort_fee).toLocaleString()}, due in full (no deposit).` : null
    subject = `Your transport quote — ${orgName}`
    body = [
      `Hi ${opp.contacts.full_name || 'there'},`,
      '',
      `Here's your quote:`,
      transportLine,
      depositLine,
      escortLine,
      phoneLine,
      '',
      orgName,
    ].filter(Boolean).join('\n')
  }

  try {
    await sendCustomerEmail({
      orgId: opp.org_id,
      to: opp.contacts.email,
      subject,
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

// One-tap alternative to "Set price & deposit" for a port-escort lead that
// turns out not to want transport at all -- zeroes the transport
// total/deposit so all that's left is the flat escort_fee already on the
// job. Doesn't touch escort_fee itself; that was set automatically when
// the lead came in and stays exactly as-is either way.
async function handleEscortOnly({ token, chatId, callbackQuery, opportunityId }) {
  const { data: opp, error } = await fetchLead(opportunityId)
  if (error) return answerCallback(token, callbackQuery.id, `Lookup failed: ${error.message}`)
  if (!opp) return answerCallback(token, callbackQuery.id, 'That lead could not be found — it may have been deleted.')
  if (!opp.escort_fee) return answerCallback(token, callbackQuery.id, "This lead doesn't have an escort fee set.")

  const { error: updErr } = await admin
    .from('opportunities')
    .update({ value: 0, deposit_amount: 0 })
    .eq('id', opportunityId).eq('org_id', opp.org_id)
  if (updErr) return answerCallback(token, callbackQuery.id, `Couldn't save that: ${updErr.message}`)

  await answerCallback(token, callbackQuery.id, 'Marked escort only')
  const msg = callbackQuery.message
  if (msg) await editMessage(token, msg.chat.id, msg.message_id, `${msg.text}\n\n✅ Escort only — $${Number(opp.escort_fee).toLocaleString()} total, no transport.`)

  // Same gap that existed in handlePriceReply until this button was added:
  // without this, there was no way to actually get the price to the
  // customer after tapping "Escort only" -- it saved the number and stopped.
  const canText = !!opp.contacts?.email
  const { data: link } = await admin
    .from('wave_checkout_links').select('id').eq('org_id', opp.org_id).eq('amount', opp.escort_fee).limit(1).maybeSingle()
  const linkNote = link ? '' : ` No $${Number(opp.escort_fee).toLocaleString()} Wave Checkout link saved yet, so the quote email will say "call to lock in" instead of a pay link — add one in Payment Settings for the self-serve version.`
  await telegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text: `Ready to send — $${Number(opp.escort_fee).toLocaleString()} escort fee, for ${opp.contacts?.full_name || 'this lead'}.${canText ? '' : ' No email on file, so "Text quote" won’t work until one’s added in the CRM.'}${linkNote}`,
    reply_markup: canText ? { inline_keyboard: [[{ text: '💬 Text quote to customer', callback_data: `tq:${opportunityId}` }]] } : undefined,
  })
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
      } else if (action === 'eo' && id) {
        await handleEscortOnly({ token, chatId, callbackQuery, opportunityId: id })
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
