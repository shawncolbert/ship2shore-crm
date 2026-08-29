import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { fetchUnfollowedLeadAlerts } from '../lib/supabase'

const SNOOZE_KEY = 'unfollowedLeadSnoozes'
const SNOOZE_MS = 15 * 60 * 1000

function loadSnoozes() {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}') } catch { return {} }
}

function minutesAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 60) return `${mins} min`
  const hrs = Math.round(mins / 60)
  return `${hrs} hr${hrs === 1 ? '' : 's'}`
}

// A lead that's sat assigned for 20+ minutes with no reply from the
// dispatcher's own inbox and no movement on the card -- see
// unfollowed_lead_alerts (the view) and markAssigned (dispatchAssignment.js)
// for how "unfollowed" is actually decided. Per Shawn 2026-08-29, this is
// deliberately NOT a dismiss-once-and-forget popup like PaymentClaimToast:
// it keeps reappearing until the assigned dispatcher (or Shawn himself)
// actually does something -- replies, or moves the card. "Snooze" only
// hides it on this device for 15 minutes; it doesn't resolve anything
// server-side, so it comes right back if the lead is still sitting there.
export default function UnfollowedLeadToast() {
  const navigate = useNavigate()
  const [, forceRender] = useState(0)
  const { data: alerts } = useQuery({
    queryKey: ['unfollowedLeadAlerts'],
    queryFn: fetchUnfollowedLeadAlerts,
    refetchInterval: 30_000,
  })

  const snoozes = loadSnoozes()
  const now = Date.now()
  const visible = (alerts || []).filter((a) => !(snoozes[a.opportunity_id] > now))
  const alert = visible[0]
  if (!alert) return null

  const snooze = () => {
    const all = loadSnoozes()
    all[alert.opportunity_id] = now + SNOOZE_MS
    localStorage.setItem(SNOOZE_KEY, JSON.stringify(all))
    forceRender((n) => n + 1)
  }

  const open = () => navigate(`/pipeline?job=${alert.opportunity_id}`)

  // bottom-28 stacks this above PaymentClaimToast (bottom-0) so the two
  // never overlap on the rare occasion both have something to show.
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 shadow-lg">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-red-900">
            {alert.dispatcher_name || alert.dispatcher_company || 'A dispatcher'} hasn't followed up
            {visible.length > 1 ? ` — ${visible.length} leads waiting` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-red-800">
            {alert.customer_name || 'Customer'}{alert.title ? ` — ${alert.title}` : ''}
          </p>
          <p className="mt-1 text-xs text-red-700">Assigned {minutesAgo(alert.assigned_at)} ago, no reply yet.</p>
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          <button
            type="button"
            onClick={open}
            className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
          >
            View job
          </button>
          <button
            type="button"
            onClick={snooze}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100"
          >
            Snooze 15m
          </button>
        </div>
      </div>
    </div>
  )
}
