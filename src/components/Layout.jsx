import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const nav = [
  { to: '/', label: 'Dashboard', end: true, ready: true },
  { to: '/inbox', label: 'Inbox', ready: true },
  { to: '/contacts', label: 'Contacts', ready: true },
  { to: '/pipeline', label: 'Pipeline', ready: true },
]

export default function Layout({ children }) {
  const { session, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className="flex w-56 flex-col bg-ink text-white/90 shrink-0">
        <div className="px-5 py-6">
          <div className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-white">
            Ship2Shore
          </div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-accent">
            Dispatch
          </div>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {nav.map((item) =>
            item.ready ? (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
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
            ) : (
              <div
                key={item.to}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-white/35"
                title="Coming in the next phase"
              >
                {item.label}
                <span className="text-[10px] uppercase tracking-wide">soon</span>
              </div>
            )
          )}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="truncate text-xs text-white/50">
            {session?.user?.email}
          </div>
          <button
            onClick={handleSignOut}
            className="mt-2 text-xs text-white/70 underline-offset-2 hover:text-accent hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
