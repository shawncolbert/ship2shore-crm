import { useQuery } from '@tanstack/react-query'
import { fetchMyOrg } from '../lib/supabase'

const card = 'rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]'
const h2 = 'font-[family-name:var(--font-display)] text-lg font-bold text-ink'
const step = 'flex gap-3'
const stepNum = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-ink'

const SECTIONS = [
  {
    id: 'contacts',
    title: 'Contacts',
    nav: '/contacts',
    body: `Every customer and lead lives here. Search by name, phone, company, or email. Open a contact
      to see their full history — jobs, files, messages, and notes — all in one place. Add a new one with
      the "+ New contact" button, and optionally drop a booking straight onto the pipeline at the same time.`,
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    nav: '/pipeline',
    body: `Every job as a card, grouped by stage, left to right. Drag a card to move it forward (or back).
      Click a card to edit its title, value, scheduled date, or billing number right there. A badge on the
      "Pipeline" link in the sidebar tells you how many jobs are sitting in your intake stage and still need
      your attention — that's your first stop most mornings.`,
  },
  {
    id: 'pipeline-stages',
    title: 'Pipeline Stages',
    nav: '/settings/pipeline-stages',
    body: `The columns your Pipeline board shows are entirely yours to define — add, rename, recolor, reorder,
      or delete them for how your business actually works. Mark one "New work lands here": that's where a
      booking from your booking sidebar, public booking page, or a funnel gets dropped automatically,
      whatever you've named it.`,
  },
  {
    id: 'booking',
    title: 'Creating a booking',
    nav: '/',
    body: `The fastest way in: click "+ New Booking" on the Dashboard. Pick or create the customer, add one
      or more services from your own catalog (set that up under Services first), and it lands on your
      pipeline instantly. Check the boxes there to email the customer a delivery-order request and/or a
      payment link at the same time — both actually send, they're not just placeholders.`,
  },
  {
    id: 'services',
    title: 'Services',
    nav: '/services',
    body: `This is your price list — whatever you actually sell, one line each: a name and a default price.
      This is what shows up as the pickable list on your booking screen and on your public booking page, so
      set it up before you start taking bookings. Deactivate anything you've stopped offering instead of
      deleting it, so old jobs still show what was charged.`,
  },
  {
    id: 'business-card',
    title: 'Digital Business Cards',
    nav: '/settings/card-links',
    body: `One shareable page per driver — Call/Text/Email buttons, a "save to phone contacts" button, and
      a Book Now link that routes leads straight to that driver. Click "+ Add a card" → "Set up a new card
      here" and fill in one form (name, phone, email, which services they're allowed to offer, hours);
      everything — the card, the booking link, and lead-alert routing — gets created together. You'll land
      on a screen with one link to copy and hand the driver; that link is their whole card. Every card also
      has an on/off switch right in the list: flip it off and the whole card stops working — booking,
      contact buttons, everything — until you flip it back on (handy if you ever need to cut someone off).
      You can also track clicks on a card built somewhere else entirely (e.g. an old Netlify site), but the
      on/off switch and lead routing can't reach one of those — only cards set up here get the full
      protection. A separate "Business Card Builder" page lets you hand-edit any card's look (colors, logo,
      photo) directly. When a customer books a Vehicle Transport job through any card's Book Now link, the
      booking form automatically also asks for the vehicle's make/model/year/VIN and a photo — no setup
      needed, that kicks in on its own whenever that service is selected.`,
  },
  {
    id: 'business-card-builder',
    title: 'Business Card Builder',
    nav: '/settings/business-card',
    body: `The actual editor behind every card — branding colors, logo/photo upload, credential badges,
      and every field on the card. Cards created through Digital Business Cards show up here automatically;
      you don't need to start here unless you're fine-tuning how an existing card looks. A card only goes
      live once "Publish" is on, and unpublishing it here is the same kill switch as the on/off toggle on
      the Digital Business Cards page — either one fully takes the card down.`,
  },
  {
    id: 'landing-funnels',
    title: 'Landing Pages & Funnels',
    nav: '/landing-pages',
    body: `Landing Pages are single scrollable pages you build block by block (headline, image, text, a "Book
      Now" button) for ads or a link in your social bio. Funnels are short multi-step forms — a couple of
      quick questions before someone becomes a lead on your pipeline. Both are optional; Services and the
      Business Card are the two things worth setting up first.`,
  },
  {
    id: 'payments',
    title: 'Payment Settings',
    nav: '/payment-settings',
    body: `Enter your Zelle, Venmo, Cash App, and Apple Pay handles once. From then on, the 💲 button on any
      pipeline card sends that customer a payment request instantly — no separate app needed. None of these
      have a way to auto-confirm payment landed, so you'll still mark the job Paid yourself once it does.`,
  },
  {
    id: 'documents',
    title: 'Documents & Delivery Orders',
    nav: '/documents',
    body: `On any contact's page, "Request a Document" emails them a secure upload link — no login needed
      on their end. Pick what you're actually asking for (delivery order, doc receipt, gate pass, or any
      supporting document) and edit the subject/message before sending; the link itself is added
      automatically. Whatever they send back lands in that contact's file automatically — photos included,
      not just PDFs — and a "New files from customers" card shows up on your Dashboard the moment it
      arrives, so you're not stuck checking back manually. "DO / Contract Editor" is a separate on-device
      tool for redacting or correcting a delivery order, contract, or any other PDF/photo — editing itself
      stays on your device, and when you're done you can download it, print it (opens your normal print
      dialog), or use "Save to customer file" to file the corrected copy under whichever customer it's for.`,
  },
  {
    id: 'inbox',
    title: 'Inbox',
    nav: '/inbox',
    body: `Every email conversation with a contact, threaded like a messaging app. Replies you send here go
      out for real and log themselves back onto that contact's timeline.`,
  },
  {
    id: 'calendar',
    title: 'Calendar',
    nav: '/calendar',
    body: `A month view of every job with a scheduled date or time. Good for a quick "what's happening this
      week" glance without opening the full pipeline board.`,
  },
  {
    id: 'automations',
    title: 'Automations',
    nav: '/automations',
    body: `Rules that fire automatically when a job moves into a stage — send the customer an email, send a
      payment request, or just log it internally. Takes effect immediately, no code, and email templates can
      pull in the customer's name and job details automatically.`,
  },
  {
    id: 'agent',
    title: 'AI Assistant',
    nav: '/agent',
    body: `A chat assistant (with voice input) for quick, natural-language requests — "what's Sarah's deal
      worth", "move John's job to Scheduled", "quote a portrait session". It's a shortcut for things you
      could also do by clicking around; use whichever's faster in the moment.`,
  },
  {
    id: 'social',
    title: 'Social Posts',
    nav: '/social-posts',
    body: `A simple content calendar for drafting and scheduling social posts, separate from everything
      customer-facing above.`,
  },
]

export default function Help() {
  const { data: org } = useQuery({ queryKey: ['myOrg'], queryFn: fetchMyOrg, staleTime: 5 * 60 * 1000 })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-ink">
          Getting Started{org?.name ? ` — ${org.name}` : ''}
        </h1>
        <p className="max-w-2xl text-sm text-muted">
          Everything below lives inside your own account — nobody else using this system sees your data,
          your customers, or your settings. Bookmark this page; it's always here under Help in the sidebar.
        </p>
      </header>

      {/* Quick start */}
      <section className={`${card} mb-6`}>
        <h2 className={`${h2} mb-4`}>Quick start — do these first</h2>
        <ol className="space-y-4">
          <li className={step}>
            <span className={stepNum}>1</span>
            <div>
              <p className="text-sm font-semibold text-ink">Set up your pipeline stages</p>
              <p className="text-sm text-muted">Go to <a href="/settings/pipeline-stages" className="text-accent hover:underline">Pipeline Stages</a> and name the columns for how your business actually works — a starter template is offered if you haven't already.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>2</span>
            <div>
              <p className="text-sm font-semibold text-ink">Add what you sell</p>
              <p className="text-sm text-muted">Go to <a href="/services" className="text-accent hover:underline">Services</a> and list your services with prices. This drives your booking screen and your public booking page.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>3</span>
            <div>
              <p className="text-sm font-semibold text-ink">Add how you get paid</p>
              <p className="text-sm text-muted">Go to <a href="/payment-settings" className="text-accent hover:underline">Payment Settings</a> and enter your Zelle/Venmo/Cash App/Apple Pay handles.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>4</span>
            <div>
              <p className="text-sm font-semibold text-ink">Set up your (or your drivers') digital business cards</p>
              <p className="text-sm text-muted">Go to <a href="/settings/card-links" className="text-accent hover:underline">Digital Business Cards</a>, click "+ Add a card" → "Set up a new card here," fill in one form, and copy the link it gives you at the end.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>5</span>
            <div>
              <p className="text-sm font-semibold text-ink">Create a test booking</p>
              <p className="text-sm text-muted">From the <a href="/" className="text-accent hover:underline">Dashboard</a>, click "+ New Booking" and walk through it once so you know what a customer's job looks like on your pipeline.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>6</span>
            <div>
              <p className="text-sm font-semibold text-ink">Need a teammate added, or something changed?</p>
              <p className="text-sm text-muted">Adding additional users to your account isn't self-serve yet — reach out and we'll get them set up.</p>
            </div>
          </li>
        </ol>
      </section>

      {/* Per-feature reference */}
      <div className="mb-6 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink hover:border-accent">
            {s.title}
          </a>
        ))}
      </div>

      <div className="space-y-4">
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className={`${card} scroll-mt-6`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className={h2}>{s.title}</h2>
              <a href={s.nav} className="shrink-0 text-xs font-semibold text-accent hover:underline">Open →</a>
            </div>
            <p className="text-sm text-muted">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  )
}
