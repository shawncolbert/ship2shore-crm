import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchMyOrg } from '../lib/supabase'

// The very first thing anyone sees after signing in, every time -- their
// own company name and logo, with one button in. Deliberately outside
// Layout (no sidebar) so it reads as a branded front door, not another CRM
// screen. "Enter CRM" always lands on Pipeline, the actual day-to-day
// dispatch board, same for every org including Ship2Shore's own.
export default function Welcome() {
  const navigate = useNavigate()
  const { data: org, isLoading } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand p-6">
      <div className="flex flex-col items-center text-center">
        {isLoading ? (
          <p className="text-sm text-white/60">Loading…</p>
        ) : (
          <>
            {org?.logo_url ? (
              <img src={org.logo_url} alt="" className="mb-6 h-24 w-24 rounded-2xl bg-white/5 object-contain p-2" />
            ) : (
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-white/20 text-xs font-semibold text-white/40">
                LOGO
              </div>
            )}
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-white">
              {org?.name || 'Your Business'}
            </h1>
            <button
              onClick={() => navigate('/pipeline')}
              className="mt-8 rounded-md bg-accent px-8 py-3 text-sm font-semibold uppercase tracking-[0.15em] text-ink transition-colors hover:bg-accent-600"
            >
              Enter CRM
            </button>
          </>
        )}
      </div>
    </div>
  )
}
