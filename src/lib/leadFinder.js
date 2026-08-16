import { supabase, fetchMyOrgId } from './supabase'

async function callFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`/.netlify/functions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `${name} failed.`)
  return data
}

/* ------------------------------------------------------------------ */
/* FMCSA search + Claude-drafted audit -- both live pulls, nothing      */
/* persisted until the user clicks "Save" on a specific lead.           */
/* ------------------------------------------------------------------ */

export async function searchFmcsaLeads({ state, companyName, cargoKeyword, limit, offset }) {
  return callFunction('fmcsa-search', { state, companyName, cargoKeyword, limit, offset })
}

export async function auditLead({ websiteUrl, companyName }) {
  return callFunction('lead-audit', { websiteUrl, companyName })
}

// Finds a company's own website and social media (Facebook, Instagram,
// TikTok, LinkedIn) from just its name via Firecrawl search -- FMCSA has
// none of this. Returns { website, social: { facebook, instagram, tiktok,
// linkedin } }, any of which may be null if nothing turned up.
export async function discoverCompany({ companyName, city, state }) {
  return callFunction('lead-discover', { companyName, city, state })
}

// Direct DOT and/or MC number lookup against FMCSA's official QCMobile API
// (fmcsa-verify.js) -- built for exactly this single-company check, unlike
// the bulk census file the state/company search above uses. Verifies that
// whoever called claiming to run under a given number actually matches
// who's registered to it (a real, common double-brokering risk in
// freight). Returns { carrier, mcMatchesDot } -- carrier is null if
// nothing came back; mcMatchesDot is only set when both numbers were given.
export async function verifyCarrier({ dotNumber, mcNumber }) {
  return callFunction('fmcsa-verify', { dotNumber, mcNumber })
}

/* ------------------------------------------------------------------ */
/* Saved leads -- org-scoped tracking once a lead's worth following up  */
/* on (see fmcsa_leads migration).                                      */
/* ------------------------------------------------------------------ */

export async function fetchSavedLeads() {
  const { data, error } = await supabase
    .from('fmcsa_leads')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function saveLead(lead) {
  const orgId = await fetchMyOrgId()
  const { error } = await supabase.from('fmcsa_leads').upsert({
    org_id: orgId,
    dot_number: lead.dotNumber,
    mc_number: lead.mcNumber || null,
    legal_name: lead.legalName || null,
    dba_name: lead.dbaName || null,
    entity_type: lead.entityType || null,
    phone: lead.phone || null,
    city: lead.city || null,
    state: lead.state || null,
    power_units: lead.powerUnits ?? null,
    drivers: lead.drivers ?? null,
    cargo_classification: lead.cargoClassification || null,
    website_url: lead.websiteUrl || null,
    social_links: lead.socialLinks || null,
    site_notes: lead.siteNotes || null,
    pitch_email: lead.pitchEmail || null,
    contact_email: lead.contactEmail || null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'org_id,dot_number' })
  if (error) throw error
}

export async function updateLeadStatus(id, status) {
  const { error } = await supabase
    .from('fmcsa_leads')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteLead(id) {
  const { error } = await supabase.from('fmcsa_leads').delete().eq('id', id)
  if (error) throw error
}
