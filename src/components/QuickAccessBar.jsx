import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchMyOrg, fetchMyProfile } from '../lib/supabase'
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
  { to: '/documents', label: 'Documents', key: 'documents' },
  // A shortcut to the manager page, not to any external site itself -- so
  // this bar never has to carry a growing, org-specific list of load
  // boards/dashboards someone's added under Settings > Custom Links.
  { to: '/settings/custom-links', label: 'Custom Links', key: 'custom_links' },
]

export default function QuickAccessBar() {
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  const { data: profile } = useQuery({ queryKey: ['myProfile'], queryFn: fetchMyProfile, staleTime: 5 * 60 * 1000 })
  const filtered = BUBBLES.filter((b) => isFeatureEnabled(org, b.key))
  // AI Studio is platform-admin only (see AiStudio.jsx) -- kept out of the
  // generic FEATURES list on purpose, so it's appended here instead rather
  // than run through isFeatureEnabled, which defaults an unlisted key to
  // visible for every org.
  const bubbles = profile?.platform_admin
    ? [...filtered, { to: '/ai-studio', label: 'AI Studio' }]
    : filtered

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
