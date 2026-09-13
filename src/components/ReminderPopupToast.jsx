import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchActiveReminders } from '../lib/supabase'

const SNOOZE_KEY = 'reminderRuleSnoozes'
const SNOOZE_MS = 60 * 60 * 1000

function loadSnoozes() {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') } catch { return {} }
}

const VIEW_PATH = {
  lead_not_followed_up: '/pipeline',
  invoice_unpaid: '/invoices',
}

// Platform-admin-configured pop-up reminders (System Controls > Reminder
// Rules) -- e.g. "a lead hasn't been touched in 3 days" or "an invoice is
// still unpaid after 7 days." Each rule's own custom message is written by
// Shawn per org, so this only supplies the matching records and the chrome
// around them. Snoozing hides that one rule on this device for an hour --
// same "doesn't resolve anything server-side" behavior as
// UnfollowedLeadToast, since the underlying record hasn't actually changed.
export default function ReminderPopupToast() {
  const navigate = useNavigate()
  const [, forceRender] = useState(0)
  const { data: results } = useQuery({
    queryKey: ['activeReminders'],
    queryFn: fetchActiveReminders,
    refetchInterval: 5 * 60_000,
  })

  const snoozes = loadSnoozes()
  const now = Date.now()
  const visible = (results || []).filter((r) => !(snoozes[r.rule.id] > now))
  const current = visible[0]
  if (!current) return null

  const { rule, matches } = current
  const shown = matches.slice(0, 3)
  const extra = matches.length - shown.length

  const snooze = () => {
    const all = loadSnoozes()
    all[rule.id] = now + SNOOZE_MS
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(all))
    forceRender((n) => n + 1)
  }

  const view = () => navigate(VIEW_PATH[rule.condition_type] || '/dashboard')

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-56 z-50 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {rule.message}
            {visible.length > 1 ? ` — ${visible.length} reminders active` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-amber-800">
            {shown.map((m) => m.label).join(', ')}{extra > 0 ? `, +${extra} more` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={view}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
          >
            View
          </button>
          <button
            type="button"
            onClick={snooze}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Snooze 1h
          </button>
        </div>
      </div>
    </div>
  )
}
