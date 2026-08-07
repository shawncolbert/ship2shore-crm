import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { fetchMyProfile, fetchMyOrg, fetchNewBookingCount } from '../lib/supabase'

const nav = [
  { to: '/help', label: 'Help / Getting Started' },
  { to: '/agent', label: 'AI Assistant' },
  { to: '/', label: 'Dashboard', end: true },
  { to: '/settings/card-links', label: 'Digital Business Cards' },
  { to: '/inbox', label: 'Inbox' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/settings/pipeline-stages', label: 'Pipeline Stages' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/documents', label: 'Documents' },
  { to: '/do-fix', label: 'DO / Contract Editor' },
  { to: '/automations', label: 'Automations' },
  { to: '/services', label: 'Services' },
  { to: '/settings/business-card', label: 'Business Card Builder' },
  { to: '/payment-settings', label: 'Payments' },
  { to: '/landing-pages', label: 'Landing Pages' },
  { to: '/funnels', label: 'Funnels' },
  { to: '/social-posts', label: 'Social Posts' },
]

// Falls back to the Ship2Shore identity while the org loads or if branding
// isn't set — white-label orgs override this via their organizations row
// (name, logo_url).
function Brand() {
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  const name = org?.name || 'Ship2Shore'

  return (
    <div className="flex items-center gap-2">
      {org?.logo_url && (
        <img src={org.logo_url} alt="" className="h-7 w-7 rounded object-contain" />
      )}
      <div>
        <div className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white">
          {name}
        </div>
        <div className="text-[11px] uppercase tracking-[0.18em] text-accent">
          Dispatch
        </div>
      </div>
    </div>
  )
}

function NavItems({ onNavigate }) {
  const { data: profile } = useQuery({ queryKey: ['myProfile'], queryFn: fetchMyProfile })
  const items = profile?.platform_admin ? [...nav, { to: '/admin/orgs', label: 'Organizations' }] : nav

  // Jobs sitting in "New Booking" that haven't been triaged yet -- catches
  // bookings that came in through the public booking widget or a funnel
  // while nobody was looking at the pipeline. Polled, not live, so it's at
  // most a minute stale.
  const { data: newBookingCount } = useQuery({
    queryKey: ['newBookingCount'],
    queryFn: fetchNewBookingCount,
    refetchInterval: 60_000,
  })

  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-accent text-ink'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          <span>{item.label}</span>
          {item.to === '/pipeline' && !!newBookingCount && (
            <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-ink">
              {newBookingCount}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout({ children }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSignOut = async () => {
    setMenuOpen(false)
    await signOut()
    navigate('/login')
  }

  const Account = () => (
    <div className="border-t border-white/10 px-4 py-4">
      <div className="truncate text-xs text-white/50">{session?.user?.email}</div>
      <button
        onClick={handleSignOut}
        className="mt-2 text-xs text-white/70 underline-offset-2 hover:text-accent hover:underline"
      >
        Sign out
      </button>
    </div>
  )

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Mobile top bar */}
      <header className="flex items-center justify-between bg-ink px-4 py-3 md:hidden">
        <Brand />
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-2 text-white/80 hover:bg-white/10"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* Mobile slide-over drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col bg-ink text-white/90 shadow-xl">
            <div className="flex items-center justify-between px-5 py-4">
              <Brand />
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-2 text-white/80 hover:bg-white/10"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <NavItems onNavigate={() => setMenuOpen(false)} />
            <Account />
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col bg-ink text-white/90 md:flex">
        <div className="px-5 py-6">
          <Brand />
        </div>
        <NavItems />
        <Account />
      </aside>

      {/* Main — min-w-0 lets it shrink in the flex row; overflow-x-hidden keeps
          any stray wide element from shifting the whole page sideways on phones */}
      <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</main>
    </div>
  )
}
