import { useEffect, useState } from 'react'
import { mapboxSuggest } from '../lib/mapbox'

// Shared address input with Mapbox suggest-as-you-type -- same component
// the pipeline card's Pickup/Drop-off fields use, factored out so any other
// form (e.g. the quick-add-from-text booking flow) gets identical behavior
// instead of a second copy drifting out of sync.
export default function AddressAutocompleteField({ label, value, onChange }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (value.trim().length < 3) { setSuggestions([]); return }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      mapboxSuggest(value, controller.signal).then(setSuggestions).catch(() => {})
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [value])

  return (
    <div className="relative">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</label>
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={`${label} address`}
        autoComplete="off"
        className="w-full rounded border border-line bg-canvas px-2 py-1 text-xs text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded border border-line bg-surface text-xs shadow-lg">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(s.place_name); setSuggestions([]); setOpen(false) }}
                className="block w-full px-2 py-1.5 text-left text-ink hover:bg-canvas"
              >
                {s.place_name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
