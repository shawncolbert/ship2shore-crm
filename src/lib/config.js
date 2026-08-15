// Every org's own Calendly link is stored on organizations.calendly_url
// (Settings > Scheduling) -- there is no fallback to any one org's account
// here. Returns null when the org hasn't set one up yet, which callers
// must handle explicitly (show a "connect your Calendly" prompt) rather
// than silently showing a different org's calendar.
export function calendlyPrefillUrl(contact, orgCalendlyUrl, { embed = false } = {}) {
  if (!orgCalendlyUrl) return null
  try {
    const u = new URL(orgCalendlyUrl)
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
    return null
  }
}

export function mailtoUrl(contact, orgName) {
  const subject = `${orgName || 'New message'} - ${contact?.full_name || ''}`.trim()
  return `mailto:${contact?.email || ''}?subject=${encodeURIComponent(subject)}`
}
