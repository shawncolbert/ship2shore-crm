import Papa from 'papaparse'
import { supabase, fetchMyOrgId } from './supabase'

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

// Parses a CSV file client-side and returns { fields, rows } -- rows are
// plain objects keyed by the file's own header row (papaparse header:true).
export function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => resolve({ fields: result.meta.fields || [], rows: result.data }),
      error: reject,
    })
  })
}

// Our importable contact fields, in the order they should show as mapping
// options. "" means "don't import this column."
export const IMPORT_FIELDS = [
  { value: '', label: 'Ignore this column' },
  { value: 'full_name', label: 'Name' },
  { value: 'phone', label: 'Phone' },
  { value: 'email', label: 'Email' },
  { value: 'company', label: 'Company' },
  { value: 'notes', label: 'Notes' },
]

// Common header spellings seen in iPhone/Google/Outlook contact exports,
// so the mapping step starts pre-filled instead of blank every time --
// the user still confirms/overrides before anything imports. Google splits
// name into Given/Family Name and numbers its multi-value columns
// ("E-mail 1 - Value"); Outlook splits First/Last Name and labels phones
// by type ("Business Phone", "Mobile Phone") -- both map into full_name/
// phone here since applyMapping below joins repeated full_name/company
// hits instead of overwriting, so "Given Name" + "Family Name" correctly
// becomes one "John Smith".
const HEADER_GUESSES = {
  full_name: [
    'name', 'full name', 'fullname', 'contact name', 'display name',
    'first name', 'given name', 'last name', 'family name', 'surname',
  ],
  phone: [
    'phone', 'phone number', 'mobile', 'mobile phone', 'cell', 'cell phone',
    'telephone', 'primary phone', 'business phone', 'home phone', 'phone 1 - value',
  ],
  email: [
    'email', 'e-mail', 'email address', 'e-mail address', 'primary email',
    'e-mail 1 - value', 'email 1 - value',
  ],
  company: ['company', 'organization', 'organisation', 'business', 'company name', 'organization name'],
  notes: ['notes', 'note', 'comment', 'comments', 'description'],
}

// Fields where more than one mapped source column should be joined together
// rather than one silently overwriting another -- e.g. Outlook/Google split
// First Name and Last Name into separate columns that both map to full_name.
const JOINABLE_FIELDS = { full_name: ' ', company: ' ', notes: ' — ' }

export function guessFieldMapping(headers) {
  const mapping = {}
  for (const header of headers) {
    const norm = String(header || '').trim().toLowerCase()
    const hit = Object.entries(HEADER_GUESSES).find(([, variants]) => variants.includes(norm))
    mapping[header] = hit ? hit[0] : ''
  }
  return mapping
}

// Applies a { csvHeader: contactField } mapping to raw parsed rows, producing
// the normalized shape every downstream step (preview, dedupe, insert) uses.
// Joinable fields (name/company/notes) accumulate every mapped column that
// has a value; phone/email keep only the first non-empty mapped column,
// since the contacts table has room for exactly one of each.
export function applyMapping(rows, mapping) {
  return rows.map((row) => {
    const parts = { full_name: [], phone: [], email: [], company: [], notes: [] }
    for (const [header, field] of Object.entries(mapping)) {
      if (!field) continue
      const v = row[header]
      if (v == null || !String(v).trim()) continue
      parts[field].push(String(v).trim())
    }
    const out = {}
    for (const field of Object.keys(parts)) {
      out[field] = field in JOINABLE_FIELDS ? parts[field].join(JOINABLE_FIELDS[field]) : (parts[field][0] || '')
    }
    return out
  })
}

/* ------------------------------------------------------------------ */
/* vCard (.vcf) parsing                                                */
/* ------------------------------------------------------------------ */

// Unescapes vCard's backslash-escaped commas/semicolons/newlines (the
// inverse of businessCard.js's vEsc, which writes them).
function vUnesc(s) {
  return String(s ?? '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

// Un-folds RFC 6350 line folding -- a continuation line starts with a
// single space or tab and should be joined to the previous line.
function unfoldLines(text) {
  return text.replace(/\r\n/g, '\n').split('\n').reduce((lines, line) => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1)
    } else {
      lines.push(line)
    }
    return lines
  }, [])
}

// A single .vcf file can hold one contact or (iPhone's "export all") many
// concatenated VCARD blocks -- split on BEGIN/END and parse each.
export function parseVcfFile(text) {
  const lines = unfoldLines(text)
  const blocks = []
  let current = null
  for (const raw of lines) {
    const line = raw.trim()
    if (/^BEGIN:VCARD$/i.test(line)) { current = []; continue }
    if (/^END:VCARD$/i.test(line)) { if (current) blocks.push(current); current = null; continue }
    if (current) current.push(raw)
  }

  return blocks.map((blockLines) => {
    const out = { full_name: '', phone: '', email: '', company: '', notes: '' }
    for (const line of blockLines) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const rawKey = line.slice(0, colonIdx)
      const value = vUnesc(line.slice(colonIdx + 1).trim())
      if (!value) continue
      const key = rawKey.split(';')[0].toUpperCase()

      if (key === 'FN' && !out.full_name) out.full_name = value
      else if (key === 'N' && !out.full_name) {
        // N is "Last;First;Middle;Prefix;Suffix" -- only used if FN is missing.
        const parts = value.split(';').filter(Boolean)
        out.full_name = parts.length > 1 ? `${parts[1]} ${parts[0]}`.trim() : parts[0] || ''
      }
      else if (key === 'TEL' && !out.phone) out.phone = value
      else if (key === 'EMAIL' && !out.email) out.email = value
      else if (key === 'ORG' && !out.company) out.company = value.split(';')[0]
      else if (key === 'NOTE' && !out.notes) out.notes = value
    }
    return out
  }).filter((c) => c.full_name || c.phone || c.email)
}

/* ------------------------------------------------------------------ */
/* Dedupe + bulk insert                                                */
/* ------------------------------------------------------------------ */

const normEmail = (e) => String(e || '').trim().toLowerCase()
const normPhone = (p) => String(p || '').trim()

// Fetches the importing org's existing contact phone/email so we can skip
// rows that already exist -- mirrors the DB's own partial unique indexes
// (org_id, phone) and (org_id, lower(email)), just checked up front instead
// of relying on catching 23505 on every row.
async function fetchExistingKeys(orgId) {
  const { data, error } = await supabase.from('contacts').select('phone, email').eq('org_id', orgId)
  if (error) throw error
  const phones = new Set()
  const emails = new Set()
  for (const c of data || []) {
    if (c.phone) phones.add(normPhone(c.phone))
    if (c.email) emails.add(normEmail(c.email))
  }
  return { phones, emails }
}

// Runs the full import: dedupes against existing org contacts (and against
// duplicates within the file itself), then inserts the rest in chunks.
// Returns { imported, skipped, failed: [{ row, error }] } so the caller can
// show an accurate summary and let failed rows be reviewed/downloaded --
// nothing silently disappears.
export async function importContacts(rows, { source = 'import' } = {}) {
  const orgId = await fetchMyOrgId()
  const { phones: existingPhones, emails: existingEmails } = await fetchExistingKeys(orgId)

  const seenPhones = new Set(existingPhones)
  const seenEmails = new Set(existingEmails)
  const toInsert = []
  let skipped = 0

  for (const row of rows) {
    const phone = normPhone(row.phone)
    const email = normEmail(row.email)
    const isDupe = (phone && seenPhones.has(phone)) || (email && seenEmails.has(email))
    if (isDupe) { skipped++; continue }
    if (phone) seenPhones.add(phone)
    if (email) seenEmails.add(email)
    toInsert.push({
      org_id: orgId,
      full_name: row.full_name?.trim() || null,
      company: row.company?.trim() || null,
      phone: phone || null,
      email: email || null,
      notes: row.notes?.trim() || null,
      source,
    })
  }

  let imported = 0
  const failed = []
  const CHUNK = 200
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    const chunk = toInsert.slice(i, i + CHUNK)
    const { error } = await supabase.from('contacts').insert(chunk)
    if (!error) { imported += chunk.length; continue }
    // The whole chunk failed -- retry one at a time so we know exactly
    // which rows failed and why, instead of losing the whole batch.
    for (const row of chunk) {
      const { error: rowErr } = await supabase.from('contacts').insert(row)
      if (rowErr) failed.push({ row, error: rowErr.message })
      else imported++
    }
  }

  return { imported, skipped, failed, totalParsed: rows.length }
}

// Builds a downloadable CSV of failed rows + their error, so a failed
// import doesn't just vanish -- the user can see exactly what to fix.
export function downloadFailedRows(failed) {
  const csv = Papa.unparse(failed.map(({ row, error }) => ({
    full_name: row.full_name || '', phone: row.phone || '', email: row.email || '',
    company: row.company || '', notes: row.notes || '', error,
  })))
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'failed-contacts.csv'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
