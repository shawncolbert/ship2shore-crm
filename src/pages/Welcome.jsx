import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { fetchMyOrg } from '../lib/supabase'

// The very first thing anyone sees after signing in, every time -- their
// own company name and logo, with one button in. Deliberately outside
// Layout (no sidebar) so it reads as a branded front door, not another CRM
// screen. Uses the same compact logo/name/tagline treatment as the
// sidebar's own Brand -- not a big empty hero -- since that's the
// established look this app already uses everywhere else. "Enter CRM"
// always lands on the Dashboard, same for every org including
// Ship2Shore's own.
export default function Welcome() {
  const navigate = useNavigate()
  const { data: org, isLoading } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand p-6">
      <div className="flex flex-col items-center">
        {isLoading ? (
          <p className="text-sm text-white/60">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              {org?.logo_url && (
                <img src={org.logo_url} alt="" className="h-12 w-12 rounded-lg object-contain" />
              )}
              <div>
                <div className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-white">
                  {org?.name || 'Your Business'}
                </div>
                {org?.tagline && (
                  <div className="text-xs uppercase tracking-[0.18em] text-accent">
                    {org.tagline}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={() => navigate('/dashboard')}
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
