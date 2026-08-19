// Shared by every address-autocomplete field in the app -- PublicBooking.jsx's
// pickup/dropoff fields, the pipeline card's editable Pickup/Drop-off, and
// anywhere else that wants the same suggest-as-you-type behavior.
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export async function mapboxSuggest(query, signal) {
  if (!MAPBOX_TOKEN || query.trim().length < 3) return []
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&country=us&types=address,place&limit=5`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const data = await res.json()
  return data.features || []
}
