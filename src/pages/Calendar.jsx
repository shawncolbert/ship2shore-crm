import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchDefaultPipeline } from '../lib/supabase'

// Format time in Pacific timezone: "10:00 AM"
const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric', minute: '2-digit',
      })
    : null

// Get date portion in Pacific: YYYY-MM-DD
const getDateInPacific = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Create a localized date in Pacific timezone without offset issues
const getPacificDate = (iso) => {
  if (!iso) return null
  const d = new Date(iso)
  // Construct date using Pacific values, not UTC
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit'
  })
  const parts = formatter.formatToParts(d)
  const year = parts.find(p => p.type === 'year').value
  const month = parts.find(p => p.type === 'month').value
  const day = parts.find(p => p.type === 'day').value
  return new Date(`${year}-${month}-${day}`)
}

export default function Calendar() {
  const [month, setMonth] = useState(new Date())
  const { data, isLoading, error } = useQuery({
    queryKey: ['pipeline'],
    queryFn: fetchDefaultPipeline,
  })

  if (isLoading) return <div className="p-8 text-sm text-muted">Loading calendar…</div>
  if (error)
    return (
      <div className="p-8 text-sm text-port">
        Couldn't load the calendar. Make sure you're signed in.
      </div>
    )

  const opportunities = (data?.opportunities || []).filter((o) => o.scheduled_at)

  // Group opportunities by date
  const oppsByDate = {}
  opportunities.forEach((o) => {
    const date = getPacificDate(o.scheduled_at)
    if (!date) return
    const dateStr = date.toISOString().split('T')[0]
    if (!oppsByDate[dateStr]) oppsByDate[dateStr] = []
    oppsByDate[dateStr].push(o)
  })

  // Sort each day's opportunities by time
  Object.keys(oppsByDate).forEach((date) => {
    oppsByDate[date].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
  })

  return (
    <div className="flex h-full flex-col p-4 sm:p-6 lg:p-8">
      <header className="mb-5">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
          Calendar
        </h1>
        <p className="text-sm text-muted">View scheduled opportunities by date.</p>
      </header>

      <CalendarGrid month={month} onMonthChange={setMonth} oppsByDate={oppsByDate} />
    </div>
  )
}

function CalendarGrid({ month, onMonthChange, oppsByDate }) {
  const navigate = useNavigate()
  const year = month.getFullYear()
  const monthIdx = month.getMonth()

  // Get first day of month and days in month
  const firstDay = new Date(year, monthIdx, 1)
  const lastDay = new Date(year, monthIdx + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startingDayOfWeek = firstDay.getDay() // 0 = Sunday

  // Get previous month's days to fill grid
  const prevMonthDays = new Date(year, monthIdx, 0).getDate()
  const prevMonthFill = Array.from({ length: startingDayOfWeek }, (_, i) =>
    prevMonthDays - startingDayOfWeek + i + 1
  )

  // Current month days
  const currentMonthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1)

  // Next month days to fill grid
  const totalCells = prevMonthFill.length + currentMonthDays.length
  const nextMonthFill = Array.from({ length: 42 - totalCells }, (_, i) => i + 1)

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="flex flex-1 flex-col rounded-xl border border-line bg-surface">
      {/* Header with month/year and nav */}
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <h2 className="font-display text-lg font-bold text-ink">
          {month.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => onMonthChange(new Date(year, monthIdx - 1, 1))}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-canvas"
          >
            ← Prev
          </button>
          <button
            onClick={() => onMonthChange(new Date())}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-canvas"
          >
            Today
          </button>
          <button
            onClick={() => onMonthChange(new Date(year, monthIdx + 1, 1))}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-canvas"
          >
            Next →
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 border-b border-line">
        {weekDays.map((day) => (
          <div key={day} className="border-r border-line px-2 py-2 text-center text-xs font-semibold text-muted last:border-r-0">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 grid grid-cols-7 gap-0">
        {/* Previous month's days (grayed out) */}
        {prevMonthFill.map((day, i) => (
          <div key={`prev-${i}`} className="border-r border-b border-line bg-canvas/30 px-2 py-2 text-xs text-muted/50">
            {day}
          </div>
        ))}

        {/* Current month days */}
        {currentMonthDays.map((day) => {
          const dateStr = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayOpps = oppsByDate[dateStr] || []
          const isToday = new Date().toISOString().split('T')[0] === dateStr

          return (
            <div
              key={day}
              className={`border-r border-b border-line px-2 py-2 ${
                isToday ? 'bg-accent/10' : ''
              }`}
            >
              <div className={`mb-1 text-xs font-semibold ${isToday ? 'text-accent' : 'text-ink'}`}>
                {day}
              </div>
              <div className="space-y-1">
                {dayOpps.map((opp) => (
                  <CalendarEntry key={opp.id} opp={opp} onOpen={() => navigate(`/contacts/${opp.contact_id}`)} />
                ))}
              </div>
            </div>
          )
        })}

        {/* Next month's days (grayed out) */}
        {nextMonthFill.map((day, i) => (
          <div key={`next-${i}`} className="border-r border-b border-line bg-canvas/30 px-2 py-2 text-xs text-muted/50 last:border-r-0">
            {day}
          </div>
        ))}
      </div>
    </div>
  )
}

function CalendarEntry({ opp, onOpen }) {
  return (
    <button
      onClick={onOpen}
      className="block w-full truncate rounded bg-accent/20 px-1.5 py-0.5 text-left text-[10px] font-medium text-accent hover:bg-accent/30 transition-colors"
      title={`${opp.contacts?.full_name || 'Contact'} · ${opp.title || 'Job'} · ${fmtTime(opp.scheduled_at)}`}
    >
      <div className="font-semibold truncate">{fmtTime(opp.scheduled_at)}</div>
      <div className="truncate text-accent/80">{opp.contacts?.full_name || 'Contact'}</div>
      <div className="truncate text-accent/70">{opp.title || 'Job'}</div>
    </button>
  )
}
