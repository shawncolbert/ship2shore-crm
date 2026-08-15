import { supabase } from './supabase'
import { createBusinessCard, slugify as slugifyCard, suggestSlugs as suggestCardSlugs } from './businessCard'
import { slugifyCardName } from './externalCards'

// The one-stop "sell a new card" flow: creates the in-app card (published,
// with Call/Text/Email + Book Now), the booking-referral entry that makes
// /book?ref=... route leads + notifications to this person, and links the
// two together so the on/off switch (Settings > Digital Business Cards)
// actually kills the whole card, not just the booking link. Everything
// that used to require direct database work when onboarding Tilly/Eloy/
// Val/Warrior happens here in one call.
export async function createDriverCard(orgId, {
  fullName, title, phone, email, serviceCodes, roundTheClock, bookingLabel, serviceLabel,
}) {
  const name = String(fullName || '').trim()
  if (!name) throw new Error('Name is required.')

  const cardSlug = await firstFreeSlug('business_cards', slugifyCard(`${name}-driver`) || `driver-${Date.now().toString(36)}`)
  const linkSlug = await firstFreeSlug('external_card_links', slugifyCardName(name) || `card-${Date.now().toString(36)}`)
  const origin = window.location.origin

  const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()

  const card = await createBusinessCard(orgId, {
    slug: cardSlug,
    brand_name: org?.name || name,
    full_name: name,
    title: title || null,
    phone: phone || null,
    sms_number: phone || null,
    email: email || null,
    primary_cta_label: 'Save to Contacts',
    secondary_cta_label: 'Book Now',
    secondary_cta_url: `${origin}/book?ref=${linkSlug}`,
    is_published: true,
  })

  const { data: link, error } = await supabase
    .from('external_card_links')
    .insert({
      org_id: orgId,
      slug: linkSlug,
      name,
      target_url: `${origin}/card/${cardSlug}`,
      notify_email: email || null,
      phone: phone || null,
      round_the_clock: !!roundTheClock,
      service_codes: serviceCodes?.length ? serviceCodes : null,
      service_label: serviceLabel || null,
      booking_label: bookingLabel || null,
      business_card_id: card.id,
      active: true,
    })
    .select('*')
    .single()
  if (error) {
    // Roll back the card so a failed link doesn't leave an orphaned,
    // published-but-unreachable card behind.
    await supabase.from('business_cards').delete().eq('id', card.id)
    throw error
  }

  return { card, link }
}

// Slugs are unique per table -- offer name-2, name-3, ... instead of
// failing outright on a collision, same pattern already used for landing
// pages/funnels/business cards individually.
async function firstFreeSlug(table, base) {
  const { data } = await supabase.from(table).select('slug').eq('slug', base).maybeSingle()
  if (!data) return base
  const candidates = suggestCardSlugs(base)
  for (const c of candidates) {
    const { data: taken } = await supabase.from(table).select('slug').eq('slug', c).maybeSingle()
    if (!taken) return c
  }
  return `${base}-${Date.now().toString(36)}`
}
