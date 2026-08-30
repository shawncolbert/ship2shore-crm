import { supabase } from './supabase'

// Contacts tagged as dispatchers, each flagged with whether they're
// currently "in rotation" for auto-assignment (dispatcher_rotation is a
// simple marker table -- present = in rotation, absent = not). Not every
// dispatcher-segment contact is automatically eligible; Shawn picks who's in.
export async function fetchDispatchRotationCandidates() {
  const [{ data: dispatchers, error: dErr }, { data: rotation, error: rErr }] = await Promise.all([
    supabase.from('contacts')
      .select('id, full_name, company, email, telegram_chat_id, telegram_link_code, telegram_link_code_expires_at')
      .eq('segment', 'dispatcher').order('full_name', { ascending: true }),
    supabase.from('dispatcher_rotation').select('contact_id'),
  ])
  if (dErr) throw dErr
  if (rErr) throw rErr
  const inRotation = new Set((rotation || []).map((r) => r.contact_id))
  return (dispatchers || []).map((d) => ({ ...d, inRotation: inRotation.has(d.id) }))
}

// Six digits is short enough to read over a text message, long enough that
// someone else's stray "hi" to the bot won't collide with it by chance.
function randomLinkCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// Generates a fresh one-time code for a dispatcher to text to the org's bot
// -- telegram-webhook.js matches it on receipt and saves that chat's id as
// telegram_chat_id, which is how sendTelegramLeadAlert (telegramDispatch.js)
// knows to route their leads to their own private chat instead of the
// shared group. 30-minute expiry so an old, unused code lying around in a
// text thread can't be replayed to hijack a dispatcher's linked chat later.
export async function generateTelegramLinkCode(contactId) {
  const code = randomLinkCode()
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('contacts')
    .update({ telegram_link_code: code, telegram_link_code_expires_at: expiresAt })
    .eq('id', contactId)
  if (error) throw error
  return code
}

// Un-links a dispatcher's private chat -- their leads fall back to posting
// in the shared group again, same as before they ever linked.
export async function unlinkTelegramChat(contactId) {
  const { error } = await supabase
    .from('contacts')
    .update({ telegram_chat_id: null, telegram_link_code: null, telegram_link_code_expires_at: null })
    .eq('id', contactId)
  if (error) throw error
}

export async function addToDispatchRotation(orgId, contactId) {
  const { error } = await supabase.from('dispatcher_rotation').insert({ org_id: orgId, contact_id: contactId })
  if (error && error.code !== '23505') throw error // 23505 = already in rotation, fine
}

export async function removeFromDispatchRotation(contactId) {
  const { error } = await supabase.from('dispatcher_rotation').delete().eq('contact_id', contactId)
  if (error) throw error
}

export async function saveAutoAssignLeads(orgId, enabled) {
  const { error } = await supabase.from('organizations').update({ auto_assign_leads: !!enabled }).eq('id', orgId)
  if (error) throw error
}

// The @username dispatchers message to link their Telegram chat -- shown
// in the UI next to each "Get link code" button so Shawn doesn't have to
// go find it in BotFather every time.
export async function saveTelegramBotUsername(orgId, username) {
  const clean = String(username || '').trim().replace(/^@/, '') || null
  const { error } = await supabase.from('organizations').update({ telegram_bot_username: clean }).eq('id', orgId)
  if (error) throw error
}
