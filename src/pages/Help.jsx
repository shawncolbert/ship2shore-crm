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
      to see their full history — jobs, files, messages, and notes — all in one place. Every file you upload
      to a contact (a delivery order, a photographer's edited photos, a signed real estate contract —
      whatever your business stores) can be renamed any time by clicking "Rename" next to it, so it's clear
      at a glance what it is when you come back to that customer later — this doesn't touch the actual
      file, just what it's called. Photos get their own thumbnail grid automatically — a real customer
      portfolio you can browse — while everything else (PDFs, contracts) stays in a plain list below it;
      the same Upload button handles both, no separate step. Edit photos in whatever outside tool you
      already use (add it as a Custom Link below for one-tap access), then drag the finished files in here
      — that's what stays attached to the customer permanently, viewable from any computer, not just
      the one they were edited on. Add a new one with
      the "+ New contact" button, and optionally drop a booking straight onto the pipeline at the same time.
      Already have a list? Click "Import" to bring in a CSV export (from Google/Outlook/another CRM — you'll
      map its columns to name/phone/email/company/notes before anything's saved) or a vCard (.vcf) file
      (a single contact, or an iPhone "export all contacts" file with everyone in it — see below for exactly
      how to export one from your phone). Either way, anyone already in your org — matched by phone or email
      — is skipped automatically, so it's safe to re-import the same file without creating duplicates. Got a
      physical business card instead of a phone full of contacts? Click "Scan card": take a photo (or upload
      one), and AI reads off the name, company, title, phone, email, address, and website for you. You review
      and correct anything before it saves — nothing goes in automatically — and if that person's already in
      your contacts it'll ask whether to update their existing record instead of creating a second one. Once
      saved, "Save to Phone Contacts" hands it straight to your phone's own Add Contact screen.

      To bring your whole phone contact list in at once instead of one at a time: on an iPhone, open
      Contacts → Lists → All Contacts → Select → Select All → Share → Save to Files (this makes one .vcf file
      with everyone in it); on Android/Google, go to contacts.google.com on a computer, select the contacts
      you want, and Export → vCard format. Either file uploads straight into the vCard import above.`,
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
    id: 'invoices',
    title: 'Invoices',
    nav: '/invoices',
    body: `Bill a customer and get paid, without needing Wave or any other outside invoicing tool. Click "+
      New invoice," pick a contact (auto-fills their Bill To info) or type it in manually, add line items —
      pull from your own Services list or type a custom one — and the totals and a live preview update as you
      go. "Save draft" keeps it editable; "Send invoice" locks in the amount, emails the customer from your
      connected Gmail account with a link to their own invoice page, and (once Stripe is connected) generates
      a real "Pay Now" button that marks the invoice paid automatically the moment they pay. Before your first
      invoice, click "Business info" on this page to set your name/address/phone/logo/EIN for the invoice
      header — that's separate from your booking business info. Payment didn't come through Stripe (cash,
      check, Venmo in person)? Open the invoice and click "Mark as Paid" to record it manually — nothing gets
      stuck showing a balance forever just because it wasn't paid online. Connecting Stripe itself isn't
      self-serve yet (it's a secret key an admin adds to the deployment) — until it's connected, invoices
      still send and customers can still view them, there's just no live Pay Now button yet.

      Every invoice has its own "Payment options" section where you check off which ways to pay actually go
      out with it: the Stripe pay-now link, and/or your Zelle/Venmo/Cash App/Apple Pay handles from Payment
      Settings. There's also a Wave Checkout box — Wave's simple payment links work without needing Wave's
      paid API tier, but each one is single-use, so generate a fresh link in Wave for this invoice's exact
      amount, paste it in, and check the box. Only the options you check are shown to the customer; nothing
      is included by default except Stripe.`,
  },
  {
    id: 'scheduling',
    title: 'Scheduling',
    nav: '/settings/scheduling',
    body: `Connects your own Calendly account to the "Book" button and the embedded scheduler on every
      contact's page. Paste in your Calendly link here once and every contact's Book button opens your
      calendar with their name/email/phone already filled in. Every organization sharing this system has
      its own — if this isn't set, Book and the scheduler stay hidden rather than defaulting to anyone
      else's calendar.`,
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
      Now" button) for ads or a link in your social bio — pick from ready-made, industry-specific templates
      (photography, welding, real estate, plumbing, and more) with the copy already written, or start blank.
      Funnels are short multi-step forms — a couple of quick questions before someone becomes a lead on your
      pipeline. Both are optional; Services and the Business Card are the two things worth setting up first.
      Every landing page and funnel also has its own accent color — six options (Classic Amber, Ocean Blue,
      Crimson, Forest Teal, Aurora, Slate) — picked separately for each one in its own settings/editor, so a
      photography-themed page and a logistics-themed page you're running at the same time don't have to look
      alike. This is independent of your dashboard's own look below.`,
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
    body: `Every email conversation with a contact, threaded like a messaging app. This needs your own Gmail
      account connected before anything shows up — click "Connect Gmail" at the top of this page and sign in
      with Google once. After that, mail to and from your contacts starts syncing in on its own (checked every
      10-15 minutes), and every reply you send from here — plus every automated payment/document-request
      email the system sends on your behalf — goes out from your own connected address, not a shared one.
      Nothing in this app can send email on your behalf until this is connected.`,
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
    body: `A content calendar for drafting and scheduling social posts, separate from everything customer-
      facing above. Drafting and scheduling work with no setup. To have a post actually go out on its own at
      the scheduled time instead of just sitting there as a draft, click "Connect TikTok" at the top of the
      page and authorize your TikTok account once — after that, checking "Auto-publish to TikTok" on a post
      (with an image and a privacy level chosen) really does publish it at the scheduled time, no manual
      posting needed.`,
  },
  {
    id: 'appearance',
    title: 'Appearance',
    nav: '/settings/appearance',
    body: `Your dashboard doesn't have to look like everyone else's. Pick from seven layouts — Classic Amber
      (the default), Ocean Blue, Crimson, Forest Teal, Aurora, Slate, and Dispatch Suite — each with its own
      sidebar treatment, card shape, and accent color, plus a light/dark mode toggle (Dispatch Suite is
      always dark). Aurora and Dispatch Suite go further and reorganize the sidebar itself into labeled
      sections, and add a quick-action tile grid to the Dashboard. Whatever you pick applies to everyone
      signed into your organization — it's one shared setting, not a personal one — and takes effect the
      moment you hit "Save appearance," no reload needed. This only changes how things look; every feature
      above works identically no matter which layout is active.`,
  },
  {
    id: 'custom-links',
    title: 'Custom Links',
    nav: '/settings/custom-links',
    body: `A shortcut to any outside site you use alongside this CRM — a video-editing tool, your real estate
      listings site, whatever the case may be for your business. Click "+ Add a link," give it a name and a
      URL, and it shows up right in the sidebar next to Help, opening in a new tab. Add as many as you want,
      edit or remove them any time — applies to your whole organization, same as Appearance.`,
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
              <p className="text-sm font-semibold text-ink">Connect Gmail</p>
              <p className="text-sm text-muted">Go to <a href="/inbox" className="text-accent hover:underline">Inbox</a> and click "Connect Gmail," then sign in with Google. This is required — automated payment/document-request emails, replies, and mail sync all use your own connected account, not a shared one, and won't work at all until this is done.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>5</span>
            <div>
              <p className="text-sm font-semibold text-ink">Connect your Calendly</p>
              <p className="text-sm text-muted">Go to <a href="/settings/scheduling" className="text-accent hover:underline">Scheduling</a> and paste in your own Calendly link. This is required too — until it's set, the "Book" button and scheduler on a contact's page stay hidden rather than showing anyone else's calendar.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>6</span>
            <div>
              <p className="text-sm font-semibold text-ink">Set up your (or your drivers') digital business cards</p>
              <p className="text-sm text-muted">Go to <a href="/settings/card-links" className="text-accent hover:underline">Digital Business Cards</a>, click "+ Add a card" → "Set up a new card here," fill in one form, and copy the link it gives you at the end.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>7</span>
            <div>
              <p className="text-sm font-semibold text-ink">Bring in your existing contacts</p>
              <p className="text-sm text-muted">Go to <a href="/contacts" className="text-accent hover:underline">Contacts</a> → "Import" to bring in your whole phone/CRM contact list at once (CSV or vCard), or use "Scan card" any time to add someone one photographed business card at a time.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>8</span>
            <div>
              <p className="text-sm font-semibold text-ink">Create a test booking</p>
              <p className="text-sm text-muted">From the <a href="/" className="text-accent hover:underline">Dashboard</a>, click "+ New Booking" and walk through it once so you know what a customer's job looks like on your pipeline.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>9</span>
            <div>
              <p className="text-sm font-semibold text-ink">Make it look like your business</p>
              <p className="text-sm text-muted">Go to <a href="/settings/appearance" className="text-accent hover:underline">Appearance</a> and pick one of seven dashboard layouts (plus light/dark mode) — applies for your whole organization, changes any time.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>10</span>
            <div>
              <p className="text-sm font-semibold text-ink">Connect TikTok (optional)</p>
              <p className="text-sm text-muted">Only needed if you want to auto-publish social posts. Go to <a href="/social-posts" className="text-accent hover:underline">Social Posts</a> and click "Connect TikTok." Skip this if you'll only ever draft posts and post them yourself.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>11</span>
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
