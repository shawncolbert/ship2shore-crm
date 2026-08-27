import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyOrg, fetchOrgPricingAdjustment, saveOrgPricingAdjustment } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'

export default function PricingSettings() {
  const qc = useQueryClient()
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg })
  const { data: adjustment } = useQuery({
    queryKey: ['orgPricingAdjustment', org?.id], queryFn: () => fetchOrgPricingAdjustment(org.id), enabled: !!org?.id,
  })
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (adjustment != null) setValue(String(adjustment)) }, [adjustment])

  const dirty = adjustment != null && Number(value || 0) !== Number(adjustment)

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await saveOrgPricingAdjustment(value)
      await qc.invalidateQueries({ queryKey: ['orgPricingAdjustment'] })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">Pricing</h1>
        <p className="max-w-xl text-sm text-muted">
          Val's locked formula (Price estimator, on every job card) stays exactly as-is for every route.
          This is the one number layered on top of it, for the one case that runs differently.
        </p>
      </header>

      <div className={card}>
        <h2 className="mb-1 text-sm font-semibold text-ink">Outbound-from-California adjustment</h2>
        <p className="mb-4 text-xs text-muted">
          Added on top of the formula's usual number only when the pickup is in California and the
          drop-off isn't — outbound (CA → Midwest/East Coast) runs higher than inbound in this lane.
          Leave at $0 to charge the same either direction. Never touches the Long Beach/Wilmington local
          rate brackets, which are their own separate thing.
        </p>
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Adjustment ($)</label>
            <input
              type="number" inputMode="decimal" min="0" step="1" value={value}
              onChange={(e) => { setValue(e.target.value); setSaved(false) }}
              placeholder="0"
              className="w-32 rounded-md border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
          </div>
          <button
            type="button" onClick={save} disabled={saving || !dirty}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-ink hover:bg-accent-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
