import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

const OPEN_KEY = 'askAiOpen' // sessionStorage -- remembers open/closed per session, same as a tab reload keeping it but a new tab starting closed

// Auto-detects the contact whose record page the widget was opened from
// (/contacts/:id), so "draft a follow-up to this person" works without
// re-typing who -- injected into the prompt as a hint (see send()) rather
// than a separate API field, since agent-controller.js resolves everything
// through its own tools (search_contacts, get_contact_opportunities), not
// a dedicated contactId parameter.
function contactIdFromPath(pathname) {
  const m = pathname.match(/^\/contacts\/([^/]+)/)
  return m ? m[1] : null
}

function Bubble({ role, text }) {
  if (role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--color-accent)', color: 'var(--color-ink)' }}>
        {text}
      </div>
    )
  }
  return (
    <div className="mr-auto max-w-[90%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', color: 'var(--color-ink)' }}>
      {text}
    </div>
  )
}

// Floating "Ask AI" bubble, mounted once (see Layout.jsx) so it's visible on
// every page. 2026-09-06: unified with the full-page /agent assistant on
// Shawn's explicit request ("I want them all to be equal... able to do
// anything") -- this calls the exact same agent-controller.js endpoint the
// /agent page does, so it has the same real capability: it can create/
// update/delete contacts and opportunities, move pipeline stages, send
// real customer emails, look up a carrier's FMCSA record, schedule an
// appointment, and draft/schedule a social post -- for real, with no
// separate review step, the same as /agent already could. There is no
// weaker version anymore; this is a second entry point into the identical
// assistant, not a separate lower-privilege one.
// Voice input: the browser's own SpeechRecognition (Chrome/Edge/Android,
// and Safari via the webkit- prefix) -- free, no server round-trip, and
// starting it from a click is what makes the browser show the mic
// permission prompt at all (it refuses to prompt without a user gesture).
const SpeechRecognitionCtor = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

export default function AskAIWidget() {
  const location = useLocation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const contactId = contactIdFromPath(location.pathname)
  const [open, setOpen] = useState(() => {
    try { return sessionStorage.getItem(OPEN_KEY) === '1' } catch { return false }
  })
  const [messages, setMessages] = useState([])
  const [conversationHistory, setConversationHistory] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [listening, setListening] = useState(false)
  const listRef = useRef(null)
  const recognitionRef = useRef(null)
  const finalTranscriptRef = useRef('')

  useEffect(() => {
    try { sessionStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* private browsing -- fine to just not persist */ }
  }, [open])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, busy])

  // Stop any in-progress recognition if the widget unmounts mid-listen.
  useEffect(() => () => recognitionRef.current?.stop(), [])

  const stopListening = () => {
    recognitionRef.current?.stop()
  }

  const startListening = () => {
    if (!SpeechRecognitionCtor) {
      setErr("Voice input isn't supported in this browser -- type your question instead.")
      return
    }
    if (listening || busy) return
    setErr('')
    finalTranscriptRef.current = ''
    setInput('')

    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'en-US'
    recognition.interimResults = true
    recognition.continuous = false

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) finalTranscriptRef.current = `${finalTranscriptRef.current} ${transcript}`.trim()
        else interim += transcript
      }
      setInput(`${finalTranscriptRef.current} ${interim}`.trim())
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setErr('Microphone access is blocked -- allow it for this site in your browser/phone settings to use voice.')
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setErr('Voice input had a problem -- try again or type your question.')
      }
    }
    recognition.onend = () => {
      setListening(false)
      const finalText = finalTranscriptRef.current.trim()
      if (finalText) sendQuestion(finalText)
    }

    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  const send = (e) => {
    e.preventDefault()
    sendQuestion(input.trim())
  }

  const sendQuestion = async (question) => {
    if (!question || busy) return
    setInput('')
    setErr('')
    setMessages((m) => [...m, { role: 'user', text: question }])
    setBusy(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const userPrompt = contactId
        ? `[Context: the user has this contact's record open right now -- contact_id "${contactId}". If the request is about "this contact"/"this person"/"them", use that ID directly instead of searching by name.]\n\n${question}`
        : question

      const res = await fetch('/.netlify/functions/agent-controller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ userPrompt, conversationHistory }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')

      setMessages((m) => [...m, { role: 'assistant', text: data.reply || 'Done' }])
      setConversationHistory(data.conversationHistory || [])

      for (const event of data.clientEvents || []) {
        if (event.type === 'REDIRECT') {
          navigate(event.route)
        } else {
          qc.invalidateQueries({ queryKey: ['contacts'] })
          qc.invalidateQueries({ queryKey: ['opportunities'] })
          qc.invalidateQueries({ queryKey: ['pipeline'] })
          qc.invalidateQueries({ queryKey: ['appointments'] })
          qc.invalidateQueries({ queryKey: ['socialPosts'] })
        }
      }
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
              {contactId && <div className="text-[11px]" style={{ color: 'var(--color-muted)' }}>This contact's record is in context</div>}
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-md p-1 text-lg leading-none" style={{ color: 'var(--color-muted)' }}>×</button>
          </div>

          <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {messages.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Same assistant as the full CRM Assistant page — it can create or update contacts and jobs, move pipeline
                stages, send customer emails, look up a carrier by DOT number, schedule an appointment, or draft/schedule a
                social post. Tap the mic and just talk — {contactId ? 'try "draft a follow-up to this person."' : 'try "how many new leads this week?"'}
              </p>
            )}
            {messages.map((m, i) => <Bubble key={i} {...m} />)}
            {busy && <div className="text-xs" style={{ color: 'var(--color-muted)' }}>Working…</div>}
            {err && <p className="text-xs" style={{ color: '#c0392b' }}>{err}</p>}
          </div>

          <form onSubmit={send} className="flex gap-2 p-3" style={{ borderTop: '1px solid var(--color-line)' }}>
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening())}
              disabled={busy}
              aria-label={listening ? 'Stop listening' : 'Speak your question'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg disabled:opacity-50"
              style={{
                background: listening ? '#c0392b' : 'var(--color-canvas)',
                border: '1px solid var(--color-line)',
                color: listening ? '#fff' : 'var(--color-ink)',
              }}
            >
              🎤
            </button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? 'Listening…' : (contactId ? 'Ask about or act on this contact…' : 'Ask your CRM anything…')}
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
        onClick={() => {
          if (listening) {
            stopListening()
          } else if (open) {
            setOpen(false)
          } else {
            setOpen(true)
            startListening()
          }
        }}
        aria-label={listening ? 'Stop listening' : (open ? 'Close Ask AI' : 'Talk to Ask AI')}
        className="flex h-14 w-14 items-center justify-center rounded-full text-2xl"
        style={{
          background: listening ? '#c0392b' : 'var(--color-accent)',
          color: listening ? '#fff' : 'var(--color-ink)',
          boxShadow: 'var(--shadow-card, 0 8px 20px -4px rgba(0,0,0,.3))',
        }}
      >
        {open ? (listening ? '🎤' : '×') : '✨'}
      </button>
    </div>
  )
}
