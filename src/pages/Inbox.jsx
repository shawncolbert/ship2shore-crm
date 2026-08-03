import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchConversations, fetchMessages, subscribeMessages, sendEmail,
} from '../lib/supabase'

const fmtTime = (d) =>
  d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function Inbox() {
  const qc = useQueryClient()
  const [activeId, setActiveId] = useState(null)

  const { data: convos, isLoading, error } = useQuery({
    queryKey: ['conversations'],
    queryFn: fetchConversations,
  })

  // Live refresh on any new message
  useEffect(() => {
    const unsub = subscribeMessages(() => {
      qc.invalidateQueries({ queryKey: ['conversations'] })
      if (activeId) qc.invalidateQueries({ queryKey: ['messages', activeId] })
    })
    return unsub
  }, [qc, activeId])

  const active = convos?.find((c) => c.id === activeId)

  return (
    <div className="flex h-full">
      {/* Conversation list — full width on mobile; hidden once a thread is open */}
      <div className={`${active ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-line bg-surface md:w-80`}>
        <div className="border-b border-line px-4 py-3">
          <h1 className="font-[family-name:var(--font-display)] text-lg font-bold text-ink">Inbox</h1>
          <p className="text-xs text-muted">Email conversations. SMS lane is dormant until a compliant Ship2Shore number is set up.</p>
        </div>
        <div className="flex-1 overflow-auto">
          {isLoading && <p className="p-4 text-sm text-muted">Loading…</p>}
          {error && <p className="p-4 text-sm text-port">Couldn’t load conversations.</p>}
          {!isLoading && !error && convos?.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm font-medium text-ink">No conversations yet</p>
              <p className="mt-1 text-sm text-muted">
                Once Gmail sync runs, emails to and from your contacts show up here.
              </p>
            </div>
          )}
          {convos?.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`flex w-full items-start gap-2 border-b border-line px-4 py-3 text-left hover:bg-canvas ${
                activeId === c.id ? 'bg-canvas' : ''
              }`}
            >
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: c.unread ? 'var(--color-accent)' : 'transparent' }} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-ink">
                    {c.contacts?.full_name || c.contacts?.email || 'Unknown'}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">{fmtTime(c.last_message_at)}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <ChannelTag channel={c.channel} />
                  <span className="truncate text-xs text-muted">{c.contacts?.company || c.contacts?.email}</span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      {active ? (
        <Thread conversation={active} onBack={() => setActiveId(null)} />
      ) : (
        <div className="hidden flex-1 items-center justify-center text-sm text-muted md:flex">
          Select a conversation.
        </div>
      )}
    </div>
  )
}

function ChannelTag({ channel }) {
  const email = channel === 'email'
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
      email ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500'
    }`}>
      {channel}
    </span>
  )
}

function Thread({ conversation, onBack }) {
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
        subject: lastSubject || `Ship2Shore - ${conversation.contacts?.full_name || ''}`.trim(),
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
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-3 md:px-5">
        <button
          onClick={onBack}
          aria-label="Back to inbox"
          className="-ml-1 rounded p-1 text-muted hover:text-ink md:hidden"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{conversation.contacts?.full_name || conversation.contacts?.email}</div>
          <div className="truncate text-xs text-muted">{conversation.contacts?.email}</div>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-auto bg-canvas px-5 py-4">
        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {messages?.length === 0 && <p className="text-sm text-muted">No messages in this thread yet.</p>}
        {messages?.map((m) => {
          const out = m.direction === 'outbound'
          return (
            <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                out ? 'bg-ink text-white' : 'bg-surface text-ink border border-line'
              }`}>
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className={`mt-1 text-[10px] ${out ? 'text-white/50' : 'text-muted'}`}>
                  {m.ai_generated ? 'AI · ' : ''}{fmtTime(m.created_at)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-line bg-surface p-3">
        {err && <p className="mb-2 text-xs text-port">{err}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send() }}
            rows={2}
            placeholder="Write a reply…  (⌘/Ctrl + Enter to send)"
            className="flex-1 resize-none rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
          <button
            onClick={send}
            disabled={sending || !body.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
