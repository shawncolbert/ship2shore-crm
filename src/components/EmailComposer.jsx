import { useState } from 'react'
import { sendEmail } from '../lib/supabase'

// Compose + send an email to a contact through the Gmail-backed Netlify function.
export default function EmailComposer({ contact, onClose }) {
  const [to, setTo] = useState(contact?.email || '')
  const [subject, setSubject] = useState(`Ship2Shore - ${contact?.full_name || ''}`.trim())
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  async function send() {
    if (!to || !body.trim()) { setMsg({ ok: false, text: 'Add a recipient and a message.' }); return }
    setSending(true)
    setMsg(null)
    try {
      await sendEmail({ contactId: contact?.id, to, subject, body })
      setMsg({ ok: true, text: 'Sent ✓' })
      setTimeout(onClose, 800)
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  const field =
    'mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">
            Email {contact?.full_name || contact?.email}
          </h3>
          <button onClick={onClose} className="rounded p-1 text-muted hover:text-ink">✕</button>
        </div>
        <div className="px-5 py-4">
          <label className="block">
            <span className="text-sm font-medium text-ink">To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} className={field} />
          </label>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
          </label>
          <label className="mt-3 block">
            <span className="text-sm font-medium text-ink">Message</span>
            <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} autoFocus className={`${field} resize-none`} />
          </label>
          {msg && (
            <p className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-port'}`}>
              {msg.ok ? '✅' : '⚠️'} {msg.text}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium text-muted hover:bg-canvas hover:text-ink">Cancel</button>
          <button onClick={send} disabled={sending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50">
            {sending ? 'Sending…' : '✉️ Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
