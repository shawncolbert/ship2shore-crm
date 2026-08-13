import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  fileToResizedBase64, scanBusinessCard, findDuplicateContact, saveScannedContact, downloadContactVCard,
} from '../lib/cardScanner'

const btn = 'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)] border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-canvas disabled:opacity-50'
const btnAccent = 'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-btn)] bg-accent px-3 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50'
const input = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'
const fieldLabel = 'mb-1 block text-xs font-medium text-muted'

const EMPTY_FIELDS = { full_name: '', company: '', title: '', phone: '', email: '', address: '', website: '', notes: '' }

// Scan a physical business card with the camera, extract contact details via
// the Anthropic vision API, let the user review/correct them, then save as a
// CRM contact and optionally push straight into the phone's native contacts
// via a generated vCard. Used from both the Digital Business Cards page and
// the main Contacts page.
export default function BusinessCardScanner({ open, onClose }) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [step, setStep] = useState('capture') // capture | scanning | review | duplicate | saved
  const [imageData, setImageData] = useState(null) // { base64, mediaType, previewUrl }
  const [captureErr, setCaptureErr] = useState('')
  const [fields, setFields] = useState(EMPTY_FIELDS)
  const [duplicate, setDuplicate] = useState(null)
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedContact, setSavedContact] = useState(null)

  const reset = () => {
    setStep('capture'); setImageData(null); setCaptureErr(''); setFields(EMPTY_FIELDS)
    setDuplicate(null); setSaveErr(''); setSaving(false); setSavedContact(null)
  }

  useEffect(() => { if (open) reset() }, [open])
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    if (open) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const onPickFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setCaptureErr('')
    try {
      const resized = await fileToResizedBase64(file)
      setImageData(resized)
    } catch (err) {
      setCaptureErr(err.message || 'Could not load that image.')
    }
  }

  const retake = () => { setImageData(null); setCaptureErr('') }

  const skipToManual = () => { setFields(EMPTY_FIELDS); setStep('review') }

  const runScan = async () => {
    if (!imageData) return
    setStep('scanning'); setCaptureErr('')
    try {
      const extracted = await scanBusinessCard(imageData)
      setFields({ ...EMPTY_FIELDS, ...extracted })
      setStep('review')
    } catch (err) {
      setCaptureErr(err.message || 'Could not scan that card.')
      setStep('capture')
    }
  }

  const setField = (k) => (e) => setFields((f) => ({ ...f, [k]: e.target.value }))

  const canSave = (fields.full_name.trim() || fields.company.trim() || fields.phone.trim()) && !saving

  const doSave = async (existingId = null) => {
    setSaving(true); setSaveErr('')
    try {
      const contact = await saveScannedContact({ fields, existingId })
      setSavedContact(contact)
      setStep('saved')
      qc.invalidateQueries({ queryKey: ['contacts'] })
      qc.invalidateQueries({ queryKey: ['pipeline'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err) {
      setSaveErr(err.message || 'Could not save this contact.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = async () => {
    setSaveErr(''); setSaving(true)
    try {
      const dupe = await findDuplicateContact({ phone: fields.phone, email: fields.email })
      setSaving(false)
      if (dupe) { setDuplicate(dupe); setStep('duplicate'); return }
      await doSave(null)
    } catch (err) {
      setSaving(false)
      setSaveErr(err.message || 'Could not check for an existing contact.')
    }
  }

  const viewContact = () => { onClose(); navigate(`/contacts/${savedContact.id}`) }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog" aria-modal="true" aria-label="Scan business card"
        className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">Scan Business Card</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'capture' && (
            <div className="space-y-4">
              {!imageData ? (
                <>
                  <p className="text-sm text-muted">Photograph someone's business card to pull in their contact details automatically.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className={`${btnAccent} cursor-pointer`}>
                      📷 Take Photo
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onPickFile} />
                    </label>
                    <label className={`${btn} cursor-pointer`}>
                      🖼️ Choose Photo
                      <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
                    </label>
                  </div>
                  {captureErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {captureErr}</p>}
                  <button onClick={skipToManual} className="w-full text-center text-xs font-medium text-muted hover:text-accent hover:underline">
                    Skip — enter contact details manually
                  </button>
                </>
              ) : (
                <>
                  <img src={imageData.previewUrl} alt="Captured business card" className="max-h-72 w-full rounded-xl border border-line object-contain bg-canvas" />
                  {captureErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {captureErr}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={retake} className={btn}>Retake</button>
                    <button onClick={runScan} className={btnAccent}>Scan This Card</button>
                  </div>
                  <button onClick={skipToManual} className="w-full text-center text-xs font-medium text-muted hover:text-accent hover:underline">
                    Skip — enter contact details manually
                  </button>
                </>
              )}
            </div>
          )}

          {step === 'scanning' && (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="text-sm text-muted">Reading the card…</p>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <p className="text-xs text-muted">Review and correct anything before saving — OCR can misread a number or name.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><input value={fields.full_name} onChange={setField('full_name')} placeholder="Jane Doe" autoFocus className={input} /></Field>
                <Field label="Company"><input value={fields.company} onChange={setField('company')} placeholder="Acme Logistics" className={input} /></Field>
                <Field label="Title"><input value={fields.title} onChange={setField('title')} placeholder="Operations Manager" className={input} /></Field>
                <Field label="Phone"><input value={fields.phone} onChange={setField('phone')} placeholder="+13105551234" inputMode="tel" className={input} /></Field>
                <Field label="Email"><input type="email" value={fields.email} onChange={setField('email')} placeholder="jane@example.com" className={input} /></Field>
                <Field label="Website"><input value={fields.website} onChange={setField('website')} placeholder="https://example.com" className={input} /></Field>
                <Field label="Address" full><input value={fields.address} onChange={setField('address')} placeholder="123 Main St, Long Beach, CA" className={input} /></Field>
                <Field label="Notes" full><textarea value={fields.notes} onChange={setField('notes')} rows={2} className={input} /></Field>
              </div>
              {saveErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {saveErr}</p>}
            </div>
          )}

          {step === 'duplicate' && duplicate && (
            <div className="space-y-4">
              <p className="text-sm text-ink">This looks like someone already in your contacts:</p>
              <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-sm">
                <div className="font-medium text-ink">{duplicate.full_name || 'Unnamed contact'}</div>
                <div className="text-xs text-muted">{[duplicate.company, duplicate.phone, duplicate.email].filter(Boolean).join(' · ')}</div>
              </div>
              <p className="text-xs text-muted">Update their existing record with the scanned details, or save this as a separate new contact.</p>
              {saveErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-port">⚠️ {saveErr}</p>}
              <div className="space-y-2">
                <button onClick={() => doSave(duplicate.id)} disabled={saving} className={`${btnAccent} w-full`}>
                  {saving ? 'Saving…' : 'Update existing contact'}
                </button>
                <button onClick={() => doSave(null)} disabled={saving} className={`${btn} w-full`}>
                  Save as a new contact anyway
                </button>
                <button onClick={() => setStep('review')} disabled={saving} className="w-full text-center text-xs font-medium text-muted hover:text-ink">
                  ‹ Back to editing
                </button>
              </div>
            </div>
          )}

          {step === 'saved' && savedContact && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-emerald-700">✓ Saved {savedContact.full_name || 'contact'} to your CRM.</p>
              <button onClick={() => downloadContactVCard(savedContact)} className={`${btnAccent} w-full`}>
                📱 Save to Phone Contacts
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={reset} className={btn}>Scan another</button>
                <button onClick={viewContact} className={btn}>View contact</button>
              </div>
            </div>
          )}
        </div>

        {step === 'review' && (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:bg-canvas hover:text-ink">Cancel</button>
            <button onClick={handleSaveClick} disabled={!canSave} className={btnAccent}>
              {saving ? 'Checking…' : 'Save Contact'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, children, full }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className={fieldLabel}>{label}</span>
      {children}
    </label>
  )
}
