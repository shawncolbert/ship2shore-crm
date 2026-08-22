import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchConversations, fetchMessages, subscribeMessages, sendEmail, deleteConversation, deleteMessage, supabase, fetchMyOrg,
} from '../lib/supabase'

const fmtTime = (d) =>
  d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

// Every avatar is a gradient ring built from the org's own two theme
// accents (--color-accent / --color-brass) rather than a fixed hue -- it
// automatically reads as "signal amber on navy," "violet on near-black," or
// whatever preset/mode is active, instead of one hardcoded look.
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}
function Avatar({ name, email, size = 36 }) {
  const label = name || email || ''
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: 'linear-gradient(135deg, var(--color-accent), var(--color-brass))',
        boxShadow: '0 0 0 1px var(--color-line), 0 0 14px -3px var(--color-accent)',
      }}
    >
      {initials(label)}
    </span>
  )
}

function TrashIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m3 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7h14Z" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}
function XIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
function CheckCircleIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  )
}
function AlertIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 9v4M12 17h.01" /><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L14.7 3.86a2 2 0 0 0-3.4 0Z" />
    </svg>
  )
}
function MailIcon({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  )
}

// A small "live" ping -- a soft ring expanding outward from a solid accent
// dot. Uses Tailwind's built-in animate-ping (the app already globally
// disables all animation under prefers-reduced-motion, so this respects
// that for free).
function LiveDot({ size = 10 }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: 'var(--color-accent)' }} />
      <span className="relative inline-flex rounded-full" style={{ width: size, height: size, background: 'var(--color-accent)', boxShadow: '0 0 8px 0 var(--color-accent)' }} />
    </span>
  )
}

// Uppercase, letter-spaced, monospace -- the HUD/telemetry treatment used
// throughout for timestamps, channel tags, and other small metadata.
const hud = 'font-[family-name:var(--font-mono)] uppercase tracking-wider'

export default function Inbox() {
  const qc = useQueryClient()
  const [activeId, setActiveId] = useState(null)

  const { data: convos, isLoading, error } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  })
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })

  const { data: gmailStatus } = useQuery({
    queryKey: ['gmailStatus'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/gmail-status', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      if (!res.ok) return { connected: false }
      return res.json()
    },
    staleTime: 60 * 1000,
  })

  const [connectNotice, setConnectNotice] = useState(null)

  // Landed back here after Google's own consent screen (see gmail-oauth-callback).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('gmail')
    if (!result) return
    if (result === 'connected') setConnectNotice({ type: 'success', text: 'Gmail account connected.' })
    else setConnectNotice({ type: 'error', text: params.get('msg') || 'Could not connect Gmail.' })
    qc.invalidateQueries({ queryKey: ['gmailStatus'] })
    window.history.replaceState({}, '', window.location.pathname)
  }, [qc])

  const [connecting, setConnecting] = useState(false)
  const handleConnectGmail = async () => {
    setConnecting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/.netlify/functions/gmail-oauth-start', {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      })
      const data = await res.json()
      if (!res.ok) { setConnectNotice({ type: 'error', text: data.error || 'Could not start Gmail connection' }); return }
      window.location.href = data.authorize_url
    } finally {
      setConnecting(false)
    }
  }

  // Live refresh on any new message
  useEffect(() => {
    const unsub = subscribeMessages(() => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (activeId) qc.invalidateQueries({ queryKey: ['messages', activeId] })
    })
    return unsub
  }, [qc, activeId])

  const active = convos?.find((c) => c.id === activeId)

  const removeConversation = async (c) => {
    const who = c.contacts?.full_name || c.contacts?.email || 'this conversation'
    if (!confirm(`Delete the thread with ${who}? This can't be undone.`)) return
    await deleteConversation(c.id)
    if (activeId === c.id) setActiveId(null)
    qc.invalidateQueries({ queryKey: ['conversations'] })
  }

  return (
    <div className="flex h-full">
      {/* Conversation list — full width on mobile; hidden once a thread is open */}
      <div className={`${active ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-line bg-surface/85 backdrop-blur-xl md:w-80`}>
        <div className="border-b border-line px-4 py-3">
          <h1
            className="font-[family-name:var(--font-display)] text-lg font-bold"
            style={{
              backgroundImage: 'linear-gradient(90deg, var(--color-accent), var(--color-brass))',
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}
          >
            Inbox
          </h1>
          <p className="text-xs text-muted">Email conversations. SMS lane is dormant until a compliant business number is set up.</p>
        </div>

        {connectNotice && (
          <div
            className={`mx-4 mt-3 flex items-start gap-2 rounded-[var(--radius-card)] border-l-2 bg-surface/80 px-3 py-2.5 text-xs shadow-[var(--shadow-card)] backdrop-blur ${connectNotice.type === 'success' ? 'text-ink' : 'text-red-400'}`}
            style={{ borderColor: connectNotice.type === 'success' ? 'var(--color-accent)' : 'var(--color-port)' }}
          >
            {connectNotice.type === 'success' ? <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-accent)' }} /> : <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-port)' }} />}
            <span>{connectNotice.text}</span>
          </div>
        )}

        {gmailStatus && !gmailStatus.connected && gmailStatus.appConfigured && (
          <div className="mx-4 mt-3 rounded-[var(--radius-card)] border-l-2 bg-surface/80 px-3 py-2.5 text-xs text-ink shadow-[var(--shadow-card)] backdrop-blur" style={{ borderColor: 'var(--color-brass)' }}>
            <p className="mb-2 flex items-start gap-2"><AlertIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-brass)' }} /><span>No Gmail account connected. Connect one so emails sync in and replies send from your own address.</span></p>
            <button
              onClick={handleConnectGmail}
              disabled={connecting}
              className="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-btn)] px-3 py-1.5 text-xs font-semibold text-white transition-shadow hover:shadow-[0_0_16px_-2px_var(--color-accent)] disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-600))' }}
            >
              <MailIcon className="h-3.5 w-3.5" />
              {connecting ? 'Redirecting…' : 'Connect Gmail'}
            </button>
          </div>
        )}

        {gmailStatus && !gmailStatus.connected && !gmailStatus.appConfigured && (
          <div className="mx-4 mt-3 flex items-start gap-2 rounded-[var(--radius-card)] border-l-2 bg-surface/80 px-3 py-2.5 text-xs text-ink shadow-[var(--shadow-card)] backdrop-blur" style={{ borderColor: 'var(--color-brass)' }}>
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-brass)' }} />
            <span>Gmail isn't set up on this site yet — an admin needs to create a Google Cloud OAuth app and set
            GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET before a "Connect Gmail" button can appear here.</span>
          </div>
        )}

        {gmailStatus?.connected && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-[var(--radius-card)] border-l-2 bg-surface/80 px-3 py-2.5 text-xs text-muted shadow-[var(--shadow-card)] backdrop-blur" style={{ borderColor: 'var(--color-starboard)' }}>
            <CheckCircleIcon className="h-4 w-4 shrink-0" style={{ color: 'var(--color-starboard)' }} />
            <span>Gmail connected{gmailStatus.email ? ` as ${gmailStatus.email}` : ''}.</span>
          </div>
        )}

        <div className="flex-1 overflow-auto">
          {isLoading && <p className="p-4 text-sm text-muted">Loading…</p>}
          {error && <p className="p-4 text-sm text-port">Couldn’t load conversations.</p>}
          {!isLoading && !error && convos?.length === 0 && (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)', color: 'var(--color-accent)' }}>
                <MailIcon className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-ink">No conversations yet</p>
              <p className="text-sm text-muted">
                Once Gmail sync runs, emails to and from your contacts show up here.
              </p>
            </div>
          )}
          {convos?.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setActiveId(c.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveId(c.id) }}
              className="group relative flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
              style={activeId === c.id ? { background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)' } : undefined}
            >
              {activeId === c.id && (
                <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: 'linear-gradient(180deg, var(--color-accent), var(--color-brass))', boxShadow: '0 0 8px 0 var(--color-accent)' }} />
              )}
              <span className="relative shrink-0">
                <Avatar name={c.contacts?.full_name} email={c.contacts?.email} />
                {c.unread && (
                  <span className="absolute -right-0.5 -top-0.5">
                    <LiveDot size={10} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${c.unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
                    {c.contacts?.full_name || c.contacts?.email || 'Unknown'}
                  </span>
                  <span className={`${hud} shrink-0 text-[10px] text-muted`}>{fmtTime(c.last_message_at)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <ChannelTag channel={c.channel} />
                  <span className="truncate text-xs text-muted">{c.contacts?.company || c.contacts?.email}</span>
                </span>
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); removeConversation(c) }}
                title="Delete this conversation"
                className="shrink-0 rounded-full p-1.5 text-muted opacity-0 hover:bg-red-500/10 hover:text-red-400 group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Thread */}
      {active ? (
        <Thread conversation={active} orgName={org?.name} onBack={() => setActiveId(null)} onDelete={() => removeConversation(active)} />
      ) : (
        <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-canvas/60 text-sm text-muted md:flex">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface/80 backdrop-blur" style={{ boxShadow: 'var(--shadow-card), 0 0 24px -6px var(--color-accent)' }}>
            <MailIcon className="h-6 w-6" style={{ color: 'var(--color-accent)' }} />
          </span>
          Select a conversation.
        </div>
      )}
    </div>
  )
}

function ChannelTag({ channel }) {
  const email = channel === 'email'
  return (
    <span
      className={`${hud} rounded px-1.5 py-0.5 text-[9px] font-medium`}
      style={{
        color: email ? 'var(--color-accent)' : 'var(--color-muted)',
        background: email ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'color-mix(in srgb, var(--color-muted) 12%, transparent)',
        border: `1px solid ${email ? 'color-mix(in srgb, var(--color-accent) 35%, transparent)' : 'var(--color-line)'}`,
      }}
    >
      {channel}
    </span>
  )
}

// Removes one message from a thread (a duplicate send, a stray leftover
// draft) without deleting the whole conversation. Only shows on hover so it
// doesn't clutter every bubble.
function DeleteMessageButton({ messageId, conversationId }) {
  const qc = useQueryClient()
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!window.confirm('Delete this message? This only removes it here, not from the customer\'s own inbox if it was already sent.')) return
    setDeleting(true)
    try {
      await deleteMessage(messageId)
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      title="Delete message"
      className="shrink-0 rounded-full p-1.5 text-muted opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50 group-hover:opacity-100"
    >
      <XIcon className="h-3.5 w-3.5" />
    </button>
  )
}

function Thread({ conversation, orgName, onBack, onDelete }) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const endRef = useRef(null)

  const { data: messages, isLoading } = useQuery({
    queryKey: ['messages', conversation.id],
    queryFn: () => fetchMessages(conversation.id),
  })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!body.trim()) return
    setSending(true); setErr('')
    try {
      const lastSubject = messages?.findLast?.((m) => m.channel === 'email')?.subject
      await sendEmail({
        conversationId: conversation.id,
        contactId: conversation.contact_id,
        to: conversation.contacts?.email,
        subject: lastSubject || `${orgName || 'New message'} - ${conversation.contacts?.full_name || ''}`.trim(),
        body,
      })
      setBody('')
      qc.invalidateQueries({ queryKey: ['messages', conversation.id] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    } catch (e) {
      setErr(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-surface/85 px-4 py-3 backdrop-blur-xl md:px-5">
        <button
          onClick={onBack}
          aria-label="Back to inbox"
          className="-ml-1 rounded p-1 text-muted hover:text-ink md:hidden"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <Avatar name={conversation.contacts?.full_name} email={conversation.contacts?.email} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-ink">{conversation.contacts?.full_name || conversation.contacts?.email}</div>
          <div className="truncate text-xs text-muted">{conversation.contacts?.email}</div>
        </div>
        <button
          onClick={onDelete}
          title="Delete this conversation"
          className="rounded-full p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400"
        >
          <TrashIcon />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto bg-canvas/60 px-5 py-4">
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {messages?.length === 0 && <p className="text-sm text-muted">No messages in this thread yet.</p>}
        {messages?.map((m) => {
          const out = m.direction === 'outbound'
          return (
            <div key={m.id} className={`group flex items-center gap-1.5 ${out ? 'justify-end' : 'justify-start'}`}>
              {out && <DeleteMessageButton messageId={m.id} conversationId={conversation.id} />}
              <div
                className="max-w-[75%] rounded-2xl px-4 py-2 text-sm backdrop-blur"
                style={
                  out
                    ? { background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-600))', color: '#ffffff', boxShadow: '0 4px 20px -6px var(--color-accent)' }
                    : { background: 'color-mix(in srgb, var(--color-surface) 80%, transparent)', color: 'var(--color-ink)', border: '1px solid color-mix(in srgb, var(--color-brass) 25%, var(--color-line))' }
                }
              >
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className={`${hud} mt-1 text-[9px] ${out ? 'text-white/60' : 'text-muted'}`}>
                  {m.ai_generated ? 'AI · ' : ''}{fmtTime(m.created_at)}
                </div>
              </div>
              {!out && <DeleteMessageButton messageId={m.id} conversationId={conversation.id} />}
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line bg-surface/85 p-3 backdrop-blur-xl">
        {err && <p className="mb-2 text-xs text-port">{err}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
            rows={2}
            placeholder="Write a reply…  (⌘/Ctrl + Enter to send)"
            className="flex-1 resize-none rounded-[var(--radius-card)] border border-line bg-canvas/50 px-3 py-2 text-sm text-ink outline-none transition-shadow focus:border-transparent focus:shadow-[0_0_0_2px_var(--color-accent)]"
          />
          <button
            onClick={send}
            disabled={sending || !body.trim()}
            className="rounded-[var(--radius-btn)] px-4 py-2 text-sm font-semibold text-white transition-shadow hover:shadow-[0_0_18px_-3px_var(--color-accent)] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-600))' }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
