// Per-tenant integrations. Env vars override the defaults.
export const CALENDLY_URL =
  import.meta.env.VITE_CALENDLY_URL || 'https://calendly.com/whaleyinc'

// Calendly link with the contact's details prefilled.
export function calendlyPrefillUrl(contact, { embed = false } = {}) {
  try {
    const u = new URL(CALENDLY_URL)
    if (contact?.full_name) u.searchParams.set('name', contact.full_name)
    if (contact?.email) u.searchParams.set('email', contact.email)
    if (contact?.phone) u.searchParams.set('a1', contact.phone)
    if (embed) {
      u.searchParams.set('embed_domain', typeof location !== 'undefined' ? location.hostname : 'localhost')
      u.searchParams.set('embed_type', 'Inline')
      u.searchParams.set('hide_gdpr_banner', '1')
    }
    return u.toString()
  } catch {
    return CALENDLY_URL
  }
}

export function mailtoUrl(contact) {
  const subject = `Ship2Shore - ${contact?.full_name || ''}`.trim()
  return `mailto:${contact?.email || ''}?subject=${encodeURIComponent(subject)}`
}
