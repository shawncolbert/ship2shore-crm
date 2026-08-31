import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyOrg, fetchMyOrgId, fetchLandingPages, updateLandingPage, fetchDispatcherContacts } from '../lib/supabase'
import {
  fetchDispatchRotationCandidates, addToDispatchRotation, removeFromDispatchRotation, saveAutoAssignLeads,
  generateTelegramLinkCode, unlinkTelegramChat, saveTelegramBotUsername,
} from '../lib/dispatchRotation'
import { pushSupported, isPushSubscribed, subscribeToPush } from '../lib/pushNotifications'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'

export default function DispatchAssignment() {
  const qc = useQueryClient()
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })
  const { data: candidates, isLoading } = useQuery({ queryKey: ['dispatchRotationCandidates'], queryFn: fetchDispatchRotationCandidates })
  const [savingAuto, setSavingAuto] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['dispatchRotationCandidates'] })

  const toggleAutoAssign = async () => {
    setSavingAuto(true)
    try {
      const orgId = await fetchMyOrgId()
      await saveAutoAssignLeads(orgId, !org.auto_assign_leads)
      qc.invalidateQueries({ queryKey: ['myOrg'] })
    } finally {
      setSavingAuto(false)
    }
  }

  const inRotationCount = candidates?.filter((d) => d.inRotation).length || 0

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Dispatch Assignment</h1>
        <p className="max-w-xl text-sm text-muted">
          Pick which dispatchers can receive leads, and whether new leads from your booking funnel get
          handed to them automatically or wait for you to assign them by hand on Pipeline.
        </p>
      </header>

      <PushNotificationSettings />

      <div className={`${card} mb-4 flex items-center justify-between gap-3`}>
        <div>
          <p className="text-sm font-semibold text-ink">Auto-assign new funnel leads</p>
          <p className="text-xs text-muted">
            {org?.auto_assign_leads
              ? 'On — new leads round-robin across everyone marked "in rotation" below and get emailed automatically.'
              : 'Off — new leads land unassigned on Pipeline; you pick who gets each one.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!org?.auto_assign_leads}
          onClick={toggleAutoAssign}
          disabled={savingAuto || !org}
          className="shrink-0"
        >
          <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${org?.auto_assign_leads ? 'bg-accent' : 'bg-slate-300'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${org?.auto_assign_leads ? 'translate-x-6' : 'translate-x-1'}`} />
          </span>
        </button>
      </div>

      <TelegramBotSettings org={org} />

      <div className={card}>
        <h2 className="mb-1 text-sm font-semibold text-ink">Dispatchers</h2>
        <p className="mb-4 text-xs text-muted">
          These are your contacts tagged as dispatchers. Check the ones who should be in the auto-assign
          rotation — {inRotationCount === 0 ? "none marked yet" : `${inRotationCount} marked`}. Anyone
          left unchecked can still be assigned to a job by hand on Pipeline, just not automatically.
          Link each one's own Telegram chat below so their leads stop posting to the shared group.
        </p>

        {isLoading && <p className="text-sm text-muted">Loading…</p>}
        {!isLoading && candidates?.length === 0 && (
          <p className="text-sm text-muted">No contacts tagged as dispatchers yet. Set a contact's segment to "Dispatcher" on their contact page to see them here.</p>
        )}

        <div className="space-y-2">
          {candidates?.map((d) => (
            <DispatcherRow key={d.id} dispatcher={d} botUsername={org?.telegram_bot_username} onChanged={refresh} />
          ))}
        </div>
      </div>

      <div className={`${card} mt-4`}>
        <h2 className="mb-1 text-sm font-semibold text-ink">Landing pages</h2>
        <p className="mb-4 text-xs text-muted">
          Point a specific page's leads straight at one dispatcher instead of the round-robin above --
          TWIC/Hotshot/Semi-Container/Military leads still always go to you regardless of what's set here.
        </p>
        <LandingPageRouting />
      </div>
    </div>
  )
}

// Gets Shawn's phone buzzing directly from the CRM -- separate from
// Telegram entirely. Once subscribed, check-unfollowed-leads.js can push a
// notification straight to this device when a lead assigned to Val or Paul
// has sat 10+ minutes with no reply and no movement. Per-device (a phone
// and a laptop are two separate subscriptions), so this only ever
// describes THIS browser's own state, not the account's as a whole.
function PushNotificationSettings() {
  const [status, setStatus] = useState('checking') // checking | unsupported | off | on | denied
  const [error, setError] = useState('')

  useEffect(() => {
    if (!pushSupported()) { setStatus('unsupported'); return }
    if (Notification.permission === 'denied') { setStatus('denied'); return }
    isPushSubscribed().then((on) => setStatus(on ? 'on' : 'off'))
  }, [])

  const enable = async () => {
    setError('')
    try {
      await subscribeToPush()
      setStatus('on')
    } catch (e) {
      setStatus(Notification.permission === 'denied' ? 'denied' : 'off')
      setError(e.message || 'Could not enable notifications.')
    }
  }

  if (status === 'unsupported') return null // e.g. desktop Safari -- nothing useful to show

  return (
    <div className={`${card} mb-4`}>
      <h2 className="mb-1 text-sm font-semibold text-ink">Notifications on this device</h2>
      <p className="mb-3 text-xs text-muted">
        Get a push notification right on your phone when a lead assigned to Val or Paul has gone 10+
        minutes with no reply. Only affects this browser/device — enable it separately on your phone and
        your computer if you want both.
      </p>
      {status === 'on' && (
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/40">
          Enabled on this device
        </span>
      )}
      {status === 'off' && (
        <button
          type="button"
          onClick={enable}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink"
        >
          Enable notifications
        </button>
      )}
      {status === 'denied' && (
        <p className="text-xs text-muted">
          Notifications are blocked for this site in your browser settings — enable them there, then
          reload this page.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// One-time org setting -- the bot's own @username, shown next to every
// "Get link code" button below so Shawn (or whoever's on this page) never
// has to go dig it out of BotFather to tell a dispatcher who to message.
function TelegramBotSettings({ org }) {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedValue, setSavedValue] = useState('')

  useEffect(() => {
    if (org?.telegram_bot_username) {
      setValue(org.telegram_bot_username)
      setSavedValue(org.telegram_bot_username)
    }
  }, [org?.telegram_bot_username])

  const save = async () => {
    setSaving(true)
    try {
      const orgId = await fetchMyOrgId()
      await saveTelegramBotUsername(orgId, value)
      setSavedValue(value.trim().replace(/^@/, ''))
      qc.invalidateQueries({ queryKey: ['myOrg'] })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${card} mb-4`}>
      <h2 className="mb-1 text-sm font-semibold text-ink">Telegram bot</h2>
      <p className="mb-3 text-xs text-muted">
        The @username of the bot posting your lead alerts. Needed so the "Get link code" button below can
        tell a dispatcher exactly who to message.
      </p>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted">@</span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="YourBotUsername"
          className="w-56 rounded-md border border-line bg-canvas px-2 py-1.5 text-sm text-ink"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || value.trim().replace(/^@/, '') === savedValue}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// Two rounds of "search @username and send this code" went unused by both
// Paul and Val -- per Shawn 2026-09-01, a direct t.me/ link that opens
// straight into the bot's chat (no searching required) removes one whole
// step most people aren't used to doing. "Copy message" builds the same
// generic, no-name text Shawn asked for earlier so one button covers
// texting either dispatcher.
function LinkCodeInstructions({ code, botUsername, dispatcherName }) {
  const [copied, setCopied] = useState(false)
  const directLink = botUsername ? `https://t.me/${botUsername}` : null

  const copyMessage = async () => {
    const text = directLink
      ? `Tap this to message me on Telegram: ${directLink}\n\nThen send this code: ${code}\n\nTakes 10 seconds — this links your leads to show up automatically.`
      : `Message @${botUsername} on Telegram, then send this code: ${code}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this text:', text)
    }
  }

  return (
    <div className="space-y-1.5 text-xs text-muted">
      <p>
        {dispatcherName ? `For ${dispatcherName}: ` : ''}code <span className="font-mono font-semibold text-ink">{code}</span> — expires in 30 min.
      </p>
      {directLink && (
        <p>
          Direct link: <a href={directLink} target="_blank" rel="noreferrer" className="text-accent hover:underline">{directLink}</a>
        </p>
      )}
      <button
        type="button"
        onClick={copyMessage}
        className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:border-accent"
      >
        {copied ? 'Copied ✓' : '📋 Copy message to text them'}
      </button>
    </div>
  )
}

function LandingPageRouting() {
  const qc = useQueryClient()
  const { data: pages, isLoading } = useQuery({ queryKey: ['landingPages'], queryFn: fetchLandingPages })
  const { data: dispatchers } = useQuery({ queryKey: ['dispatcherContacts'], queryFn: fetchDispatcherContacts })
  const [savingId, setSavingId] = useState(null)

  const setDispatcher = async (pageId, dispatcherId) => {
    setSavingId(pageId)
    try {
      await updateLandingPage(pageId, { default_dispatcher_id: dispatcherId || null })
      qc.invalidateQueries({ queryKey: ['landingPages'] })
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (!pages?.length) return <p className="text-sm text-muted">No landing pages yet.</p>

  return (
    <div className="space-y-2">
      {pages.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-canvas/50 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{p.title || p.slug}</p>
            <p className="truncate text-xs text-muted">/{p.slug}</p>
          </div>
          <select
            value={p.default_dispatcher_id || ''}
            onChange={(e) => setDispatcher(p.id, e.target.value)}
            disabled={savingId === p.id}
            className="shrink-0 rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-ink"
          >
            <option value="">Round robin (default)</option>
            {dispatchers?.map((d) => (
              <option key={d.id} value={d.id}>{d.full_name || d.company}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}

function DispatcherRow({ dispatcher, botUsername, onChanged }) {
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(false)
  const [code, setCode] = useState(null)

  const toggle = async () => {
    setSaving(true)
    try {
      if (dispatcher.inRotation) {
        await removeFromDispatchRotation(dispatcher.id)
      } else {
        const orgId = await fetchMyOrgId()
        await addToDispatchRotation(orgId, dispatcher.id)
      }
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  const getCode = async () => {
    setLinking(true)
    try {
      setCode(await generateTelegramLinkCode(dispatcher.id))
    } finally {
      setLinking(false)
    }
  }

  const unlink = async () => {
    setLinking(true)
    try {
      await unlinkTelegramChat(dispatcher.id)
      setCode(null)
      onChanged()
    } finally {
      setLinking(false)
    }
  }

  const codeExpired = dispatcher.telegram_link_code_expires_at && new Date(dispatcher.telegram_link_code_expires_at) < new Date()
  const activeCode = code || (!codeExpired ? dispatcher.telegram_link_code : null)

  return (
    <div className="rounded-lg border border-line bg-canvas/50 px-3 py-2 hover:border-accent">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={dispatcher.inRotation}
          onChange={toggle}
          disabled={saving}
          className="h-4 w-4 rounded border-line text-accent focus:ring-accent"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{dispatcher.full_name || dispatcher.company}</p>
          <p className="truncate text-xs text-muted">{dispatcher.company && dispatcher.full_name ? `${dispatcher.company} · ` : ''}{dispatcher.email || 'No email on file'}</p>
        </div>
        {dispatcher.inRotation && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-ink ring-1 ring-inset ring-accent/40">In rotation</span>
        )}
      </label>

      <div className="mt-2 flex items-center gap-2 pl-7">
        {dispatcher.telegram_chat_id ? (
          <>
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-500/40">
              Telegram linked — private chat
            </span>
            <button type="button" onClick={unlink} disabled={linking} className="text-xs text-muted underline-offset-2 hover:underline">
              Unlink
            </button>
          </>
        ) : activeCode ? (
          <LinkCodeInstructions code={activeCode} botUsername={botUsername} dispatcherName={dispatcher.full_name || dispatcher.company} />
        ) : (
          <button
            type="button"
            onClick={getCode}
            disabled={linking || !botUsername}
            title={!botUsername ? 'Set the bot username above first' : undefined}
            className="rounded-md border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-ink hover:border-accent disabled:opacity-50"
          >
            {linking ? 'Generating…' : 'Get Telegram link code'}
          </button>
        )}
      </div>
    </div>
  )
}
