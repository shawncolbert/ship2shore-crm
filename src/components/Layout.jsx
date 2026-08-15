import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { fetchMyProfile, fetchMyOrg, fetchNewBookingCount } from '../lib/supabase'
import { fetchCustomLinks } from '../lib/customLinks'
import { isFeatureEnabled } from '../lib/features'
import { applyTheme, cacheTheme } from '../lib/theme'
import IdleTimeout from './IdleTimeout'

// `group` only matters for the Aurora layout's sectioned sidebar (see
// NavItems below) -- every other layout renders this same list flat, in
// this same order, exactly as before.
const nav = [
  { to: '/help', label: 'Help / Getting Started', key: 'help', group: 'Overview' },
  { to: '/agent', label: 'AI Assistant', key: 'ai_assistant', group: 'Overview' },
  { to: '/dashboard', label: 'Dashboard', key: 'dashboard', group: 'Overview' },
  { to: '/settings/card-links', label: 'Digital Business Cards', key: 'digital_business_cards', group: 'Marketing' },
  { to: '/inbox', label: 'Inbox', key: 'inbox', group: 'Clients & Bookings' },
  { to: '/contacts', label: 'Contacts', key: 'contacts', group: 'Clients & Bookings' },
  { to: '/pipeline', label: 'Pipeline', key: 'pipeline', group: 'Clients & Bookings' },
  { to: '/settings/pipeline-stages', label: 'Pipeline Stages', key: 'pipeline_stages', group: 'Clients & Bookings' },
  { to: '/calendar', label: 'Calendar', key: 'calendar', group: 'Clients & Bookings' },
  { to: '/documents', label: 'Documents', key: 'documents', group: 'Production' },
  { to: '/do-fix', label: 'DO / Contract Editor', key: 'do_fix', group: 'Production' },
  { to: '/automations', label: 'Automations', key: 'automations', group: 'Production' },
  { to: '/services', label: 'Services', key: 'services', group: 'Money' },
  { to: '/invoices', label: 'Invoices', key: 'invoices', group: 'Money' },
  { to: '/completed-jobs', label: 'Completed Jobs', key: 'completed_jobs', group: 'Money' },
  { to: '/settings/business-card', label: 'Business Card Builder', key: 'business_card_builder', group: 'Marketing' },
  { to: '/payment-settings', label: 'Payments', key: 'payments', group: 'Money' },
  { to: '/settings/appearance', label: 'Appearance', key: 'appearance', group: 'Settings' },
  { to: '/settings/custom-links', label: 'Custom Links', key: 'custom_links', group: 'Settings' },
  { to: '/settings/scheduling', label: 'Scheduling', key: 'scheduling', group: 'Clients & Bookings' },
  { to: '/landing-pages', label: 'Landing Pages', key: 'landing_pages', group: 'Marketing' },
  { to: '/funnels', label: 'Funnels', key: 'funnels', group: 'Marketing' },
  { to: '/social-posts', label: 'Social Posts', key: 'social_posts', group: 'Marketing' },
]

// Group display order for the sectioned-sidebar layouts (Aurora, Dispatch Suite).
const GROUP_ORDER = ['Overview', 'Clients & Bookings', 'Money', 'Production', 'Marketing', 'Settings']

// Layouts whose sidebar groups nav under labeled sections instead of one
// flat list -- every other layout renders `nav` flat, unchanged.
const GROUPED_LAYOUTS = ['aurora', 'dispatch_suite']

// Dispatch Suite's reference demo used its own group names for the ones
// that map onto real Ship2Shore features (its "Rates & Services"/"Escort
// Calendar" etc. don't exist as separate nav items here, so only the
// section labels carry over, not fictional pages). Marketing has no
// equivalent group in the demo -- kept under its existing label.
const GROUP_LABELS = {
  dispatch_suite: { 'Clients & Bookings': 'Dispatch & Clients', Settings: 'System' },
}

// Falls back to the Ship2Shore identity while the org loads or if branding
// isn't set — white-label orgs override this via their organizations row
// (name, logo_url).
function Brand() {
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  const name = org?.name || 'Your Business'

  return (
    <div className="flex items-center gap-2">
      {org?.logo_url && (
        <img src={org.logo_url} alt="" className="h-7 w-7 rounded object-contain" />
      )}
      <div>
        <div className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white">
          {name}
        </div>
        {org?.tagline && (
          <div className="text-[11px] uppercase tracking-[0.18em] text-accent">
            {org.tagline}
          </div>
        )}
      </div>
    </div>
  )
}

const COLLAPSED_GROUPS_KEY = 'sidebarCollapsedGroups'

function loadCollapsedGroups() {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || '{}') } catch { return {} }
}

// A section header you can click to fold its items away -- state persists
// across reloads (localStorage, not the DB) since it's a per-device display
// preference, not something that needs to sync across a dispatcher's
// different devices or be visible to other users in the org.
function CollapsibleGroup({ group, label, children }) {
  const [collapsed, setCollapsed] = useState(() => !!loadCollapsedGroups()[group])

  const toggle = () => {
    setCollapsed((was) => {
      const next = !was
      const all = loadCollapsedGroups()
      all[group] = next
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(all))
      return next
    })
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="mb-1 flex w-full items-center justify-between rounded px-3 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] hover:bg-white/5"
        style={{ color: 'var(--color-brass)' }}
      >
        <span>{label}</span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
          className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? '-rotate-90' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {!collapsed && <div className="space-y-0.5">{children}</div>}
    </div>
  )
}

function NavItems({ onNavigate }) {
  const { data: profile } = useQuery({ queryKey: ['myProfile'], queryFn: fetchMyProfile })
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  // Self-serve external shortcuts (a photographer's video editor, a real
  // estate agent's listings site) -- managed at Settings > Custom Links,
  // shown right after Help since that's the most-visited fixed point in
  // the sidebar regardless of which layout/grouping is active.
  const { data: customLinks } = useQuery({ queryKey: ['customLinks'], queryFn: fetchCustomLinks, staleTime: 5 * 60 * 1000 })
  // Platform-admin-only "Organizations" link is never gated by an org's own
  // feature flags -- it's how the platform admin manages every org,
  // including turning their own features on/off.
  const visible = nav.filter((item) => isFeatureEnabled(org, item.key))
  const withAdmin = profile?.platform_admin ? [...visible, { to: '/admin/orgs', label: 'Organizations' }] : visible

  const externalItems = (customLinks || []).map((l) => ({ external: true, to: l.url, label: l.label, group: 'Overview' }))
  const helpIdx = withAdmin.findIndex((it) => it.key === 'help')
  const items = helpIdx === -1
    ? [...withAdmin, ...externalItems]
    : [...withAdmin.slice(0, helpIdx + 1), ...externalItems, ...withAdmin.slice(helpIdx + 1)]

  // Jobs sitting in "New Booking" that haven't been triaged yet -- catches
  // bookings that came in through the public booking widget or a funnel
  // while nobody was looking at the pipeline. Polled, not live, so it's at
  // most a minute stale.
  const { data: newBookingCount } = useQuery({
    queryKey: ['newBookingCount'],
    queryFn: fetchNewBookingCount,
    refetchInterval: 60_000,
  })

  const item = (it) => {
    if (it.external) {
      return (
        <a
          key={it.to}
          href={it.to}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        >
          <span className="truncate">{it.label}</span>
          <span aria-hidden="true" className="text-white/40">↗</span>
        </a>
      )
    }
    return (
      <NavLink
        key={it.to}
        to={it.to}
        end={it.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center justify-between rounded-[var(--radius-btn)] px-3 py-2 text-sm font-medium transition-colors ${
            isActive ? '' : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`
        }
        style={({ isActive }) => (isActive ? { background: 'var(--nav-active-bg)', color: 'var(--nav-active-text)' } : undefined)}
      >
        <span>{it.label}</span>
        {it.to === '/pipeline' && !!newBookingCount && (
          <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-ink">
            {newBookingCount}
          </span>
        )}
      </NavLink>
    )
  }

  // Aurora and Dispatch Suite are the layouts modeled directly on reference
  // dashboards whose sidebar groups nav under labeled sections -- every
  // other layout keeps the flat list exactly as it always rendered.
  if (GROUPED_LAYOUTS.includes(org?.theme_preset)) {
    const labels = GROUP_LABELS[org.theme_preset] || {}
    const byGroup = GROUP_ORDER.map((g) => ({ group: g, items: items.filter((it) => (it.group || 'Overview') === g) }))
      .filter((g) => g.items.length)
    return (
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-2">
        {byGroup.map(({ group, items: groupItems }) => (
          <CollapsibleGroup key={group} group={group} label={labels[group] || group}>
            {groupItems.map(item)}
          </CollapsibleGroup>
        ))}
      </nav>
    )
  }

  return (
    <nav className="flex-1 space-y-1 px-3">
      {items.map(item)}
    </nav>
  )
}

export default function Layout({ children }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  // Applies the signed-in org's saved appearance and caches it so the next
  // load's synchronous bootstrap (main.jsx) can paint it without a flash.
  // Runs here (not in main.jsx) because it needs the authenticated org row.
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })
  useEffect(() => {
    if (!org) return
    applyTheme(org.theme_mode, org.theme_preset)
    cacheTheme(org.theme_mode, org.theme_preset)
  }, [org?.theme_mode, org?.theme_preset])

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
      <IdleTimeout />
      {/* Mobile top bar */}
      <header className="flex items-center justify-between px-4 py-3 md:hidden" style={{ background: 'var(--sidebar-bg)' }}>
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
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col text-white/90 shadow-xl" style={{ background: 'var(--sidebar-bg)' }}>
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

      {/* Desktop sidebar — kept narrow so wide content (like the Pipeline
          board's job cards, whose icon row gets cramped otherwise) has more
          room to breathe. */}
      <aside className="hidden w-48 shrink-0 flex-col text-white/90 md:flex" style={{ background: 'var(--sidebar-bg)' }}>
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
