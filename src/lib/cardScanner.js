import { supabase, fetchMyOrgId } from './supabase'
import { vEsc } from './businessCard'

/* ------------------------------------------------------------------ */
/* Image capture -> resized base64                                     */
/* ------------------------------------------------------------------ */

// Phone camera photos can be 5-10MB, which is both slow to upload and far
// more detail than a vision model needs to read printed text off a card --
// downscale to a sensible max dimension and re-encode as JPEG before it
// ever leaves the browser.
export function fileToResizedBase64(file, { maxDim = 1600, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.round(width * scale)
        height = Math.round(height * scale)
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Could not process that image.')); return }
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = String(reader.result)
          resolve({ base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg', previewUrl: dataUrl })
        }
        reader.onerror = () => reject(new Error('Could not read that image.'))
        reader.readAsDataURL(blob)
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not load that image — try another photo.')) }
    img.src = objectUrl
  })
}

/* ------------------------------------------------------------------ */
/* OCR extraction (Anthropic vision, via Netlify function)             */
/* ------------------------------------------------------------------ */

// Returns { full_name, company, title, phone, email, address, website },
// each either a trimmed string or null. Never guesses -- a field the card
// didn't have comes back null, for the review form to leave blank.
export async function scanBusinessCard({ base64, mediaType }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/business-card-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ imageBase64: base64, mediaType }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not scan that card.')
  const f = data.fields || {}
  return {
    full_name: f.name || null,
    company: f.company || null,
    title: f.title || null,
    phone: f.phone || null,
    email: f.email || null,
    address: f.address || null,
    website: f.website || null,
  }
}

/* ------------------------------------------------------------------ */
/* Duplicate check + save                                              */
/* ------------------------------------------------------------------ */

const normEmail = (e) => String(e || '').trim().toLowerCase()
const normPhone = (p) => String(p || '').trim()

// Looks for an existing contact in this org matching the scanned phone or
// email -- same intent as contactImport.js's dedupe check, so re-scanning
// someone already in the CRM offers to update instead of silently
// duplicating them. Two separate .eq() lookups rather than one .or() filter,
// since phone numbers commonly contain "+"/"()" that would need escaping in
// PostgREST's or-filter syntax.
export async function findDuplicateContact({ phone, email }) {
  const orgId = await fetchMyOrgId()
  const p = normPhone(phone)
  const e = normEmail(email)
  if (!p && !e) return null

  if (p) {
    const { data, error } = await supabase
      .from('contacts').select('id, full_name, company, phone, email')
      .eq('org_id', orgId).eq('phone', p).limit(1)
    if (error) throw error
    if (data?.[0]) return data[0]
  }
  if (e) {
    const { data, error } = await supabase
      .from('contacts').select('id, full_name, company, phone, email')
      .eq('org_id', orgId).eq('email', e).limit(1)
    if (error) throw error
    if (data?.[0]) return data[0]
  }
  return null
}

// Saves the user-confirmed scan. Passing existingId patches that contact
// instead of inserting a new one (its original `source` is left alone --
// it didn't stop being a manually-entered/imported contact just because
// someone re-scanned their card). Title/address/website have no dedicated
// columns on `contacts`, so they live in the existing (currently unused)
// custom_fields jsonb column instead of a schema change.
export async function saveScannedContact({ fields, existingId = null }) {
  const custom_fields = {}
  if (fields.title) custom_fields.title = fields.title
  if (fields.address) custom_fields.address = fields.address
  if (fields.website) custom_fields.website = fields.website

  const payload = {
    full_name: fields.full_name?.trim() || null,
    company: fields.company?.trim() || null,
    phone: fields.phone?.trim() || null,
    email: fields.email?.trim().toLowerCase() || null,
    notes: fields.notes?.trim() || null,
    custom_fields,
  }

  if (existingId) {
    const { data, error } = await supabase
      .from('contacts').update(payload).eq('id', existingId).select('*').single()
    if (error) throw error
    return data
  }

  const orgId = await fetchMyOrgId()
  const { data, error } = await supabase
    .from('contacts')
    .insert({ ...payload, org_id: orgId, source: 'business_card_scan' })
    .select('*').single()
  if (error) throw error
  return data
}

/* ------------------------------------------------------------------ */
/* vCard (.vcf) for "Save to Phone Contacts"                           */
/* ------------------------------------------------------------------ */

export function buildContactVCard(c) {
  const nameParts = String(c.full_name || '').trim().split(/\s+/).filter(Boolean)
  const last = nameParts.length > 1 ? nameParts.pop() : ''
  const first = nameParts.join(' ')

  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${vEsc(last)};${vEsc(first)};;;`,
    `FN:${vEsc(c.full_name || '')}`,
  ]
  if (c.company) lines.push(`ORG:${vEsc(c.company)}`)
  if (c.title) lines.push(`TITLE:${vEsc(c.title)}`)
  if (c.phone) lines.push(`TEL;TYPE=WORK,VOICE:${vEsc(c.phone)}`)
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(c.email)}`)
  if (c.address) lines.push(`ADR;TYPE=WORK:;;${vEsc(c.address)};;;;`)
  if (c.website) lines.push(`URL:${vEsc(c.website)}`)
  lines.push('END:VCARD')
  return lines.join('\r\n')
}

// Same "navigate the tab directly to a vcard: blob" trick as businessCard.js's
// downloadVCard -- iOS Safari only offers the native "Add Contact" sheet on a
// direct navigation, not an <a download>, which just forces a plain file save.
export function downloadContactVCard(c) {
  const vcf = buildContactVCard(c)
  const blob = new Blob([vcf], { type: 'text/vcard;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  window.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
