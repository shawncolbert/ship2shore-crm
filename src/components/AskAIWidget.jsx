import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const OPEN_KEY = 'askAiOpen' // sessionStorage -- "remembers open/closed state per session" per the brief; a tab reload keeps it, a new tab starts closed

// Auto-detects the contact whose record page the widget was opened from
// (/contacts/:id), so "draft a follow-up to this person" works without the
// dispatcher re-typing who -- rather than every page having to remember to
// pass a contactId prop down into one globally-mounted widget.
function contactIdFromPath(pathname) {
  const m = pathname.match(/^\/contacts\/([^/]+)/)
  return m ? m[1] : null
}

async function askAi({ question, contactId }) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch('/.netlify/functions/ask-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
    body: JSON.stringify({ question, contactId: contactId || undefined }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Ask AI failed')
  return data
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch { /* clipboard permission denied -- nothing more we can do here */ }
      }}
      className="mt-2 rounded-md border px-2.5 py-1 text-[11px] font-semibold"
      style={{ borderColor: 'var(--color-line)', color: 'var(--color-accent-600)' }}
    >
      {copied ? 'Copied ✓' : '📋 Copy'}
    </button>
  )
}

function Bubble({ role, text, isDraft }) {
  if (role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--color-accent)', color: 'var(--color-ink)' }}>
        {text}
      </div>
    )
  }
  if (isDraft) {
    return (
      <div className="mr-auto max-w-[90%] rounded-lg border-2 px-3 py-2 text-sm" style={{ borderColor: 'var(--color-accent)', background: 'var(--color-canvas)', color: 'var(--color-ink)' }}>
        <div className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-accent-600)' }}>Draft — not sent</div>
        <div className="whitespace-pre-wrap">{text}</div>
        <CopyButton text={text} />
      </div>
    )
  }
  return (
    <div className="mr-auto max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', color: 'var(--color-ink)' }}>
      {text}
    </div>
  )
}

// Floating "Ask AI" assistant, mounted once (see Layout.jsx) so it's visible
// on every page. Deliberately lower-privilege than the full-page /agent
// assistant: this one only ever reports or drafts (see ask-ai.js's
// GUARDRAILS) -- never sends an email, moves a stage, or creates an
// invoice, regardless of how it's asked. That's what makes it safe to float
// on every screen instead of living behind its own dedicated page.
export default function AskAIWidget() {
  const location = useLocation()
  const contactId = contactIdFromPath(location.pathname)
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem(OPEN_KEY) === '1' } catch { return false }
  })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const listRef = useRef(null)

  useEffect(() => {
    try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* private browsing -- fine to just not persist */ }
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, busy])

  const send = async (e) => {
    e.preventDefault()
    const question = input.trim()
    if (!question || busy) return
    setInput('')
    setErr('')
    setMessages((m) => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const { answer, isDraft } = await askAi({ question, contactId })
      setMessages((m) => [...m, { role: 'assistant', text: answer, isDraft }])
    } catch (e2) {
      setErr(e2.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <div
          className="flex w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden"
          style={{
            height: 'min(560px, calc(100vh - 6rem))',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-line)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-card, 0 12px 32px -8px rgba(0,0,0,.25))',
          }}
        >
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--color-line)' }}>
            <div>
              <div className="text-sm font-bold" style={{ color: 'var(--color-ink)' }}>Ask AI</div>
              {contactId && <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Talking about this contact's record</div>}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-lg leading-none" style={{ color: 'var(--color-muted)' }}>×</button>
          </div>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {contactId
                  ? 'Ask a question about this contact, or ask me to draft a follow-up — I\'ll never send it myself, just hand you a draft to review.'
                  : 'Ask about leads, pipeline, or invoices — e.g. "how many new leads this week?" or "what\'s outstanding on invoices?"'}
              </p>
            )}
            {messages.map((m, i) => <Bubble key={i} {...m} />)}
            {busy && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>Thinking…</div>}
            {err && <p className="text-xs" style={{ color: '#c0392b' }}>{err}</p>}
          </div>

          <form onSubmit={send} className="flex gap-2 p-3" style={{ borderTop: '1px solid var(--color-line)' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={contactId ? 'Ask about this contact…' : 'Ask about your CRM…'}
              disabled={busy}
              className="flex-1 rounded-md px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--color-canvas)', border: '1px solid var(--color-line)', color: 'var(--color-ink)' }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-md px-3 py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-accent)', color: 'var(--color-ink)' }}
            >
              Send
            </button>
          </form>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? 'Close Ask AI' : 'Open Ask AI'}
        className="flex h-14 w-14 items-center justify-center rounded-full text-2xl"
        style={{ background: 'var(--color-accent)', color: 'var(--color-ink)', boxShadow: 'var(--shadow-card, 0 8px 20px -4px rgba(0,0,0,.3))' }}
      >
        {open ? '×' : '✨'}
      </button>
    </div>
  )
}
