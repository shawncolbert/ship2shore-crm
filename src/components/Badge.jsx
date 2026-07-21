const TONES = {
  broker: 'bg-sky-50 text-sky-700',
  dispatcher: 'bg-violet-50 text-violet-700',
  military: 'bg-emerald-50 text-emerald-700',
  transporter: 'bg-amber-50 text-amber-700',
  private: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-600',
}

export default function Badge({ segment }) {
  if (!segment) return null
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium capitalize ${TONES[segment] || TONES.other}`}>
      {segment}
    </span>
  )
}
