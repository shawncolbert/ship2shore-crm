/* The presentation layer for landing page blocks.
 *
 * Both the public page and the editor canvas render through this, so the
 * editor is a genuine preview rather than a lookalike that drifts. The editor
 * passes interactive={false} to keep buttons inert while you're arranging the
 * page.
 */
import { useEffect, useRef } from 'react'
import { toEmbedUrl, SPACER_SIZES } from '../lib/landingBlocks'
import { getPublicTheme, PUBLIC_INK } from '../lib/publicThemes'

// Same Mapbox geocoding endpoint PublicBooking.jsx's address autocomplete
// uses -- CustomHtml below wires this onto any input a pasted block marks
// with data-mapbox-address, so a custom page's pickup/dropoff fields get
// the same suggest-as-you-type behavior without needing their own copy of
// this logic baked into the page's raw HTML.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

async function mapboxSuggest(query, signal) {
  if (!MAPBOX_TOKEN || query.trim().length < 3) return []
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&country=us&types=address,place&limit=5`
  const res = await fetch(url, { signal })
  if (!res.ok) return []
  const data = await res.json()
  return data.features || []
}

// Prose blocks sit in a readable column; full-bleed ones handle their own width.
export const Prose = ({ children }) => (
  <div className="mx-auto max-w-3xl px-6 sm:px-8">{children}</div>
)

/* A hero whose photograph is a layer over a brand gradient rather than the
   background itself. If the image is missing, slow, or its host disappears,
   the hero is still a deliberate-looking dark gradient with legible type --
   it never collapses into unreadable text on white. */
function Hero({ block, onCta, accent, accentText }) {
  const hasImage = Boolean(block.image)
  return (
    <section
      className="relative isolate overflow-hidden"
      style={{ background: `linear-gradient(135deg, ${PUBLIC_INK} 0%, #123047 55%, #0a1b28 100%)` }}
    >
      {hasImage && (
        <img
          src={block.image}
          alt=""
          aria-hidden="true"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
          className="absolute inset-0 -z-10 h-full w-full object-cover opacity-45"
        />
      )}
      {/* Scrim: keeps contrast on the caption side no matter how bright the photo is. */}
      <div
        className="absolute inset-0 -z-10"
        style={{ background: 'linear-gradient(to top, rgba(6,20,30,0.92) 0%, rgba(6,20,30,0.55) 45%, rgba(6,20,30,0.35) 100%)' }}
      />
      <div className="mx-auto max-w-4xl px-6 py-20 text-center sm:px-8 sm:py-28">
        {block.eyebrow && (
          <p className="mb-4 text-xs font-bold uppercase tracking-[0.22em]" style={{ color: accent }}>
            {block.eyebrow}
          </p>
        )}
        {block.heading && (
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">
            {block.heading}
          </h1>
        )}
        {block.subheading && (
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">
            {block.subheading}
          </p>
        )}
        {block.ctaLabel && (
          <button
            type="button"
            onClick={() => onCta?.(block.ctaTarget)}
            className="mt-8 inline-block rounded-xl px-8 py-4 text-base font-bold shadow-lg transition hover:brightness-95"
            style={{ background: accent, color: accentText }}
          >
            {block.ctaLabel}
          </button>
        )}
      </div>
    </section>
  )
}

function Features({ block }) {
  const items = (block.items || []).filter((i) => i.title || i.text)
  if (!items.length && !block.title) return null
  return (
    <section className="mx-auto max-w-5xl px-6 py-12 sm:px-8 sm:py-16">
      {block.title && (
        <h2 className="mb-10 text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
          {block.title}
        </h2>
      )}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-3 text-2xl" aria-hidden="true">{item.icon}</div>
            <h3 className="mb-2 text-base font-bold text-gray-900">{item.title}</h3>
            <p className="text-sm leading-relaxed text-gray-600">{item.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function Stats({ block, accent }) {
  const items = (block.items || []).filter((i) => i.value || i.label)
  if (!items.length) return null
  return (
    <section style={{ background: PUBLIC_INK }} className="px-6 py-10 sm:px-8 sm:py-12">
      <div className="mx-auto grid max-w-4xl gap-8 text-center sm:grid-cols-3">
        {items.map((item, i) => (
          <div key={i}>
            <div className="text-3xl font-extrabold sm:text-4xl" style={{ color: accent }}>{item.value}</div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-white/60">{item.label}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Testimonial({ block, accent }) {
  if (!block.quote) return null
  return (
    <section className="bg-gray-50 px-6 py-14 sm:px-8 sm:py-16">
      <figure className="mx-auto max-w-3xl text-center">
        <div className="mb-4 text-4xl leading-none" style={{ color: accent }} aria-hidden="true">❝</div>
        <blockquote className="text-lg font-medium leading-relaxed text-gray-800 sm:text-xl">
          {block.quote}
        </blockquote>
        {(block.author || block.role) && (
          <figcaption className="mt-5 text-sm text-gray-500">
            <span className="font-semibold text-gray-900">{block.author}</span>
            {block.author && block.role ? ' · ' : ''}
            {block.role}
          </figcaption>
        )}
      </figure>
    </section>
  )
}

function Contact({ block }) {
  const bits = [block.phone, block.email, block.area].filter(Boolean)
  if (!block.business && !bits.length) return null
  return (
    <footer style={{ background: PUBLIC_INK }} className="px-6 py-12 text-center sm:px-8">
      {block.business && (
        <div className="text-lg font-bold tracking-tight text-white">{block.business}</div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/70">
        {block.phone && <a href={`tel:${block.phone.replace(/[^\d+]/g, '')}`} className="hover:text-white">{block.phone}</a>}
        {block.email && <a href={`mailto:${block.email}`} className="hover:text-white">{block.email}</a>}
        {block.area && <span>{block.area}</span>}
      </div>
    </footer>
  )
}

// A full page section pasted in as raw HTML/CSS -- for a fully custom
// design (like a hand-built quote-request landing page) that doesn't fit
// the block system. Rendered via dangerouslySetInnerHTML -- safe here since
// this is trusted, org-authored content edited through the same auth-gated
// editor as every other block, not third-party or visitor-supplied input.
// <style> tags in injected HTML apply normally; <script> tags don't run
// (standard innerHTML behavior), so any <form> inside gets its submit
// wired up here instead, reading whatever field names the pasted markup
// uses and posting them straight into the same lead-capture endpoint every
// other block's CTA already uses. Only wires up when `slug` is provided
// (the public page) -- the editor canvas passes no slug, so its preview
// stays inert instead of actually creating leads while you're editing.
function CustomHtml({ block, slug }) {
  const ref = useRef(null)

  useEffect(() => {
    const container = ref.current
    const form = container?.querySelector('form')
    if (!container || !slug || !form) return

    const onSubmit = async (e) => {
      e.preventDefault()
      let submitBtn, originalLabel
      try {
        const data = Object.fromEntries(new FormData(form).entries())

        submitBtn = form.querySelector('button[type="submit"], input[type="submit"]')
        originalLabel = submitBtn?.textContent
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…' }

        // Honeypot is server-enforced (flagged for review, not dropped) --
        // mobile autofill / password managers can populate a hidden field
        // on a real visitor's form, so a client-side silent return here
        // would lose a genuine lead with zero trace. Always send it through.
        const res = await fetch('/.netlify/functions/public-landing-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit_lead', slug, ...data }),
        })
        const result = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(result.error || 'Submission failed')
        form.innerHTML = '<p style="padding:24px 8px;text-align:center;font-weight:600">Thanks — we\'ll be in touch shortly.</p>'
      } catch (err) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalLabel }
        alert(err.message || 'Something went wrong. Please try again.')
      }
    }

    form.addEventListener('submit', onSubmit)

    // Address autocomplete on any input the pasted markup marks with
    // data-mapbox-address -- e.g. a pickup/drop-off field. Built imperatively
    // against the plain DOM node (not React state) since this content isn't
    // React-owned; a tiny suggestion list is inserted right after each input
    // and torn down again in the cleanup below.
    const addressCleanups = Array.from(container.querySelectorAll('input[data-mapbox-address]')).map((input) => {
      let debounceTimer = null
      let controller = null
      const list = document.createElement('ul')
      list.className = 'mapbox-suggest-list'
      input.insertAdjacentElement('afterend', list)
      if (input.parentElement) input.parentElement.style.position = 'relative'

      const close = () => { list.style.display = 'none'; list.innerHTML = '' }

      const onInput = () => {
        clearTimeout(debounceTimer)
        controller?.abort()
        const value = input.value
        if (value.trim().length < 3) { close(); return }
        debounceTimer = setTimeout(async () => {
          controller = new AbortController()
          let features
          try { features = await mapboxSuggest(value, controller.signal) } catch { return }
          if (!features?.length) { close(); return }
          list.innerHTML = ''
          features.forEach((f) => {
            const li = document.createElement('li')
            li.textContent = f.place_name
            // mousedown (not click) fires before the input's blur, so the
            // suggestion is still in the DOM when the pick is registered.
            li.addEventListener('mousedown', (e) => {
              e.preventDefault()
              input.value = f.place_name
              close()
            })
            list.appendChild(li)
          })
          list.style.display = 'block'
        }, 250)
      }
      const onBlur = () => setTimeout(close, 150)

      input.addEventListener('input', onInput)
      input.addEventListener('blur', onBlur)
      return () => {
        input.removeEventListener('input', onInput)
        input.removeEventListener('blur', onBlur)
        list.remove()
      }
    })

    return () => {
      form.removeEventListener('submit', onSubmit)
      addressCleanups.forEach((cleanup) => cleanup())
    }
  }, [slug, block.html])

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: block.html || '' }} />
}

export default function LandingBlockView({ block, onCta, theme, slug }) {
  const { accent, accentText } = getPublicTheme(theme)
  switch (block.type) {
    case 'hero':
      return <Hero block={block} onCta={onCta} accent={accent} accentText={accentText} />
    case 'features':
      return <Features block={block} />
    case 'stats':
      return <Stats block={block} accent={accent} />
    case 'testimonial':
      return <Testimonial block={block} accent={accent} />
    case 'contact':
      return <Contact block={block} />
    case 'custom_html':
      return <CustomHtml block={block} slug={slug} />

    case 'heading':
      return (
        <Prose>
          <h2 className="mb-4 mt-2 text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">{block.text}</h2>
        </Prose>
      )
    case 'paragraph':
      return (
        <Prose>
          <p className="mb-4 whitespace-pre-wrap text-base leading-relaxed text-gray-700">{block.text}</p>
        </Prose>
      )
    case 'image':
      return block.url ? (
        <Prose>
          <img src={block.url} alt={block.alt || ''} className="mb-4 w-full rounded-2xl object-cover shadow-sm" />
        </Prose>
      ) : null
    case 'video': {
      const embedUrl = toEmbedUrl(block.url)
      return embedUrl ? (
        <Prose>
          <div className="mb-4 overflow-hidden rounded-2xl" style={{ aspectRatio: '16 / 9' }}>
            <iframe src={embedUrl} className="h-full w-full" allowFullScreen title="Video" />
          </div>
        </Prose>
      ) : null
    }
    case 'cta':
      return (
        <Prose>
          <button
            type="button"
            onClick={() => onCta?.(block.target)}
            className="mb-4 mt-2 rounded-xl px-8 py-4 text-base font-bold shadow-sm transition hover:brightness-95"
            style={{ background: accent, color: accentText }}
          >
            {block.label || 'Contact us'}
          </button>
        </Prose>
      )
    case 'divider':
      return <Prose><hr className="my-6 border-gray-200" /></Prose>
    case 'spacer':
      return <div style={{ height: SPACER_SIZES[block.size] || SPACER_SIZES.md }} />
    default:
      return null
  }
}
