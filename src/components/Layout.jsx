import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/inbox', label: 'Inbox' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/pipeline', label: 'Pipeline' },
]

function Brand() {
  return (
    <div>
      <div className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white">
        Ship2Shore
      </div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-accent">
        Dispatch
      </div>
    </div>
  )
}

function NavItems({ onNavigate }) {
  return (
    <nav className="flex-1 space-y-1 px-3">
      {nav.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-accent text-ink'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          {item.label}
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

      {/* Main */}
      <main className="min-h-0 flex-1 overflow-auto">{children}</main>
    </div>
  )
}
