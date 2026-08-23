import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchMyOrg } from '../lib/supabase'
import { isFeatureEnabled } from '../lib/features'

// Persistent row of one-tap shortcuts to the pages people live in all day,
// so a dispatcher never has to open the sidebar (or scroll it) to get
// somewhere and back. Sits at the top of every screen inside Layout's
// <main>, unlike the sidebar it never scrolls out of view.
const BUBBLES = [
  { to: '/dashboard', label: 'Dashboard', key: 'dashboard' },
  { to: '/pipeline', label: 'Pipeline', key: 'pipeline' },
  { to: '/invoices', label: 'Invoices', key: 'invoices' },
  { to: '/contacts', label: 'Contacts', key: 'contacts' },
  { to: '/inbox', label: 'Inbox', key: 'inbox' },
  { to: '/calendar', label: 'Calendar', key: 'calendar' },
]

export default function QuickAccessBar() {
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  const bubbles = BUBBLES.filter((b) => isFeatureEnabled(org, b.key))

  if (bubbles.length < 2) return null

  return (
    <nav
      aria-label="Quick access"
      className="sticky top-0 z-20 flex gap-2 overflow-x-auto border-b px-4 py-2.5 backdrop-blur"
      style={{ background: 'color-mix(in srgb, var(--color-surface) 92%, transparent)', borderColor: 'var(--color-line)' }}
    >
      {bubbles.map((b) => (
        <NavLink
          key={b.to}
          to={b.to}
          className="shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors"
          style={({ isActive }) =>
            isActive
              ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-text)', borderColor: 'transparent' }
              : { background: 'var(--color-canvas)', color: 'var(--color-ink)', borderColor: 'var(--color-line)' }
          }
        >
          {b.label}
        </NavLink>
      ))}
    </nav>
  )
}
