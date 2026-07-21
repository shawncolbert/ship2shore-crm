const SEGMENTS = [
  { key: null, label: 'All' },
  { key: 'broker', label: 'Brokers' },
  { key: 'dispatcher', label: 'Dispatchers' },
  { key: 'military', label: 'Military' },
  { key: 'transporter', label: 'Transporters' },
  { key: 'private', label: 'Private' },
]

export default function SegmentFilter({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2">
      {SEGMENTS.map((s) => {
        const active = value === s.key
        return (
          <button
            key={s.label}
            onClick={() => onChange(s.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-ink bg-ink text-white'
                : 'border-line bg-surface text-muted hover:border-ink/40 hover:text-ink'
            }`}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
