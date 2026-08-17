import { supabase, fetchMyOrgId } from './supabase'

// Per-org "what am I asking the customer for" picker on a Contact's Request
// a Document flow -- freight-specific defaults (Delivery Order, Gate Pass)
// only exist for Ship2Shore; every other org starts with a single generic
// "Supporting Documents" preset and can add/edit/remove their own from here.
export async function fetchDocumentPresets() {
  const { data, error } = await supabase
    .from('document_request_presets')
    .select('id, label, subject, body_template, position')
    .order('position', { ascending: true })
  if (error) throw error
  return data || []
}

export async function createDocumentPreset({ label, subject, bodyTemplate, position }) {
  const orgId = await fetchMyOrgId()
  const clean = { label: label?.trim(), subject: subject?.trim(), body_template: bodyTemplate?.trim() }
  if (!clean.label || !clean.subject || !clean.body_template) throw new Error('A name, subject, and message template are all required.')
  const { data, error } = await supabase
    .from('document_request_presets')
    .insert({ org_id: orgId, position: position ?? 0, ...clean })
    .select('id, label, subject, body_template, position')
    .single()
  if (error) throw error
  return data
}

export async function updateDocumentPreset(id, { label, subject, bodyTemplate }) {
  const clean = { label: label?.trim(), subject: subject?.trim(), body_template: bodyTemplate?.trim() }
  if (!clean.label || !clean.subject || !clean.body_template) throw new Error('A name, subject, and message template are all required.')
  const { error } = await supabase.from('document_request_presets').update(clean).eq('id', id)
  if (error) throw error
}

export async function deleteDocumentPreset(id) {
  const { error } = await supabase.from('document_request_presets').delete().eq('id', id)
  if (error) throw error
}

// {{first_name}} is the only placeholder the request form's textarea
// supports -- kept simple on purpose, this isn't a general template engine.
export function renderPresetBody(bodyTemplate, firstName) {
  return (bodyTemplate || '').replace(/\{\{first_name\}\}/g, firstName || 'there')
}
