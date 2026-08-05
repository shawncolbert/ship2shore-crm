import { supabase, fetchMyOrgId } from './supabase'

/* ------------------------------------------------------------------ */
/* Data access — direct client CRUD under RLS, same pattern as         */
/* Services.jsx and the automation rules editor. One row per org.      */
/* ------------------------------------------------------------------ */

export async function fetchMyBusinessCard() {
  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('business_cards').select('*').eq('org_id', orgId).maybeSingle()
  if (error) throw error
  if (data) return data
  // Every org gets a row seeded on creation (admin-create-org.js) or by the
  // backfill migration, but fall back to creating one on the fly just in
  // case this org predates both.
  return createDefaultBusinessCard(orgId)
}

async function createDefaultBusinessCard(orgId) {
  const { data, error } = await supabase
    .from('business_cards')
    .insert({ org_id: orgId, slug: `card-${orgId.slice(0, 8)}` })
    .select('*').single()
  if (error) throw error
  return data
}

// Slugs are globally unique (enforced at the DB level, like funnels/landing
// pages). Whoever's editing can only ever touch their own row anyway
// (RLS), so a plain update + 23505 catch is enough -- no need for a
// separate cross-tenant availability check.
export async function saveBusinessCard(id, patch) {
  const { data, error } = await supabase
    .from('business_cards').update(patch).eq('id', id).select('*').single()
  if (error) {
    if (error.code === '23505') throw new Error('That link is already taken — try another.')
    throw error
  }
  if (!data) throw new Error('Could not save — permission denied.')
  return data
}

export const slugify = (s) =>
  String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Offers "name-2", "name-3", ... after a slug collision, so the tenant
// doesn't have to guess a free one themselves.
export function suggestSlugs(base) {
  const b = slugify(base) || 'card'
  return [2, 3, 4].map((n) => `${b}-${n}`)
}

/* ------------------------------------------------------------------ */
/* Payment methods                                                     */
/* ------------------------------------------------------------------ */

// action: 'pay' attempts an app/web deep link; 'copy' just copies the
// handle. Each type has a sensible default so the builder can pick it
// automatically, but the tenant can override per entry.
export const PAYMENT_TYPES = [
  { value: 'cashapp', label: 'Cash App', defaultAction: 'pay', handleHint: '$cashtag', handlePrefix: '$' },
  { value: 'venmo', label: 'Venmo', defaultAction: 'pay', handleHint: '@venmo-username', handlePrefix: '@' },
  { value: 'paypal', label: 'PayPal', defaultAction: 'pay', handleHint: 'paypal.me username', handlePrefix: '' },
  { value: 'zelle', label: 'Zelle', defaultAction: 'copy', handleHint: 'phone or email', handlePrefix: '' },
  { value: 'applepay', label: 'Apple Pay', defaultAction: 'copy', handleHint: 'phone or email', handlePrefix: '' },
  { value: 'other', label: 'Other', defaultAction: 'copy', handleHint: 'however customers should pay you', handlePrefix: '' },
]

export const paymentTypeLabel = (type) => PAYMENT_TYPES.find((t) => t.value === type)?.label || type

// Builds the URL a "pay" action should open. Cash App and PayPal have real
// universal links that fall back to the web automatically when the app
// isn't installed; Venmo's is app-scheme only, so the caller (BusinessCardView)
// pairs it with a timed web fallback.
export function paymentPayUrl(method) {
  const handle = String(method.handle || '').trim()
  switch (method.type) {
    case 'cashapp':
      return `https://cash.app/$${handle.replace(/^\$/, '')}`
    case 'venmo':
      return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(handle.replace(/^@/, ''))}`
    case 'venmo_web_fallback':
      return `https://venmo.com/u/${encodeURIComponent(handle.replace(/^@/, ''))}`
    case 'paypal':
      return `https://paypal.me/${encodeURIComponent(handle.replace(/^@/, ''))}`
    default:
      return /^https?:\/\//i.test(handle) ? handle : null
  }
}

/* ------------------------------------------------------------------ */
/* vCard (.vcf) generation                                             */
/* ------------------------------------------------------------------ */

// vCard 3.0 text/plain -- fields are folded/escaped per spec (commas,
// semicolons, and newlines inside a value must be backslash-escaped).
function vEsc(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n')
}

export function buildVCard(card) {
  const nameParts = String(card.full_name || '').trim().split(/\s+/)
  const last = nameParts.length > 1 ? nameParts.pop() : ''
  const first = nameParts.join(' ')
  const org = card.company_line || card.brand_name || ''
  const adr = [card.address_line1, card.address_line2].filter(Boolean).join(', ')

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vEsc(last)};${vEsc(first)};;;`,
    `FN:${vEsc(card.full_name || '')}`,
  ]
  if (org) lines.push(`ORG:${vEsc(org)}`)
  if (card.title) lines.push(`TITLE:${vEsc(card.title)}`)
  if (card.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(card.phone)}`)
  if (card.sms_number && card.sms_number !== card.phone) lines.push(`TEL;TYPE=CELL:${vEsc(card.sms_number)}`)
  if (card.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(card.email)}`)
  if (adr) lines.push(`ADR;TYPE=WORK:;;${vEsc(adr)};;;;`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

// iOS Safari only shows the native "Add Contact" sheet when it navigates
// directly to a vcard-typed resource -- an <a download> forces a plain file
// save instead. Direct location navigation is the reliable cross-browser
// trick (Android/desktop fall back to a normal download, which is still
// correct there).
export function downloadVCard(card) {
  const vcf = buildVCard(card)
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
