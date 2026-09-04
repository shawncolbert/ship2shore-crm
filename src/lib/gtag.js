import { useEffect } from 'react'

// Injects Google's gtag.js only on the public marketing page that calls
// this -- never at the app-shell level -- so a dispatcher's own daily use
// of Pipeline/Inbox/etc. never counts as "traffic" in the org's Analytics.
// Each org's tag id comes from organizations.ga4_measurement_id (Settings
// isn't built for this yet; set directly in the database for now), passed
// down through whichever public endpoint served the page.
export function useGtag(measurementId) {
  useEffect(() => {
    if (!measurementId) return
    if (document.querySelector(`script[data-gtag-id="${measurementId}"]`)) return // already loaded (e.g. fast nav back to this page)

    const loader = document.createElement('script')
    loader.async = true
    loader.dataset.gtagId = measurementId
    loader.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
    document.head.appendChild(loader)

    window.dataLayer = window.dataLayer || []
    function gtag() { window.dataLayer.push(arguments) }
    window.gtag = gtag
    gtag('js', new Date())
    gtag('config', measurementId)
  }, [measurementId])
}
