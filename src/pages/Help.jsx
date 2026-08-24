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
      saved, "Save to Phone Contacts" hands it straight to your phone's own Add Contact screen. Open any
      contact and scroll to "Known Connections" to link them to referrals, coworkers, or family already in
      your contacts, with an optional note — this is what powers Prospecting (below).

      To bring your whole phone contact list in at once instead of one at a time: on an iPhone, open
      Contacts → Lists → All Contacts → Select → Select All → Share → Save to Files (this makes one .vcf file
      with everyone in it); on Android/Google, go to contacts.google.com on a computer, select the contacts
      you want, and Export → vCard format. Either file uploads straight into the vCard import above.`,
  },
  {
    id: 'prospecting',
    title: 'Prospecting',
    nav: '/prospecting',
    body: `Before you cold-call a list of leads, paste it in here — one prospect per line as
      "Name, Phone, Email" (phone and email are optional). Click "Check for warm leads" and anyone who
      matches an existing contact by name, phone, or email gets flagged 🔥 Warm with a link straight to
      that contact. Click the ▸ next to a warm row to see who that contact is already linked to (via Known
      Connections on their contact page) — useful context before the call. An exact phone or email match
      is almost certainly the same person, so only the link to their existing record shows; a match on
      name alone might be a different, related person, so those rows also get "+ Add as new contact,
      linked" — creates a separate contact and connects the two automatically. Everyone with no match at
      all shows as a plain "New lead" with a one-click "+ Add contact" to bring them into your Contacts list.`,
  },
  {
    id: 'lead-finder',
    title: 'Lead Finder',
    nav: '/lead-finder',
    body: `Also has "Verify a DOT or MC number" at the top — separate from lead-finding, and pulling from a
      different, more authoritative FMCSA source (their official QCMobile lookup, not the bulk state-search
      file below it). Someone claims they're running under a given DOT and/or MC number, you type in
      whichever they gave you (plus optionally the name they claimed), and it shows exactly who's
      registered to those numbers, plus whether their operating authority is currently active. Enter both
      numbers together to check the stricter thing — that they actually point at the same company, not
      just that each one exists somewhere on its own. A mismatch (or a number that comes back empty) is
      flagged clearly — worth checking before handing anything over, since claiming someone else's DOT/MC
      authority is a real, common move in freight fraud. A blank MC number on a real, active DOT isn't
      necessarily a red flag by itself — only for-hire carriers need one; a private fleet hauling its own
      goods doesn't.

      Once a carrier's found, "Check insurance & operating authority" pulls a second, separate FMCSA source
      (their newer Motus registration system) — company officials, business address/phone, and their actual
      filed insurance (insurer name, policy number, coverage amount) and operating-authority status. This is
      the real thing to check before trusting someone's authority on a load, not just that a DOT/MC number
      exists. The insurance/authority fields show up as raw data labels rather than a polished form for
      now — the values are real, the presentation is still first-pass.

      Finds brand-new leads, unlike Prospecting (which checks people you already have). Pick a state
      and search — this pulls straight from FMCSA's public carrier/broker registry, no signup required.
      Try a cargo keyword like "Motor Vehicles" to narrow results to car haulers specifically. Already have
      a company's name from a call and just need their DOT number? Type it into the "Company name" box
      instead — state is optional when searching by name. Results come 50 at a time with Previous/Next at
      the bottom, so a big state pull doesn't dump everything on one page.

      FMCSA doesn't publish company websites, social media, or emails — click "Find website & social media"
      on any result (or in the verify box above, once a carrier's found) and it searches the web for their
      site plus Facebook, Instagram, TikTok, and LinkedIn pages, filtering out directory/review sites that
      tend to outrank a small company's own page. A found website auto-fills the website box below it.

      Then run "Audit & draft pitch" — it pulls any email address it can find on that company's homepage or
      an obvious Contact page, and separately has Claude read the site to call out a couple of concrete
      operational weaknesses (no online quote form, no dispatch tracking, that kind of thing) and draft a
      short personalized cold email you can copy and send yourself (nothing sends automatically). If no
      email turns up, that means the site genuinely doesn't show one anywhere Lead Finder checked — worth a
      quick manual look at their site yourself before giving up on it.

      "Check against my contacts" runs the same warm/cold check as Prospecting, so you don't cold-pitch
      someone you already know. Click "Save" on anything worth tracking (or "Save as lead" in the verify
      box) — it moves to Saved Leads below with a status you can update (New → Contacted → Added to
      Contacts, or Dismissed) any time, keeping whatever website/social/email were found. That status is
      just a note to yourself, though — for an actual Contacts record (so they show up everywhere else in
      the CRM), click "+ Add to Contacts" on the saved lead itself; it's pre-filled from whatever name,
      phone, and email were found. Needs your Claude
      API key set up on the server side (ask whoever set up your account if audits come back with an
      error); a Firecrawl key is required for both the website/social search and improves the audit step on
      JavaScript-heavy sites.`,
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    nav: '/pipeline',
    body: `Every job as a card, grouped by stage, left to right. Drag a card to move it forward (or back).
      Click a card to edit its title, value, scheduled date, or billing number right there. A badge on the
      "Pipeline" link in the sidebar tells you how many jobs are sitting in your intake stage and still need
      your attention — that's your first stop most mornings. Hover a card for its quick actions: the invoice
      icon opens (or starts, prefilled from the job) that customer's invoice — see Invoices for the payment
      options you can put on it — and the pencil opens the full editor.

      If you book loads through Central Dispatch, Super Dispatch, or similar boards, the editor also has a
      "Source" field (plus a board order # once you pick one) — tag a job with where it came from and it
      shows as a small badge on the card. Neither board offers API access on the plans available to us, so
      this is manual for now — worth doing anyway since it means every job lives on this one board instead
      of scattered across board account and CRM, and you can always see where your revenue's actually coming
      from. Both boards are also one click away from the sidebar (see Custom Links) to book/check a load.

      Click a card's "Open job details" pencil and it opens as a full page instead of a small popup — pickup/
      drop-off, price estimator, vehicle, port, source, assigned dispatcher, invoices, and a stage stepper you
      can click straight to any stage, all visible at once. Save only saves — it never closes the page on you,
      so you can always see it actually went through; Close (with a back arrow) is the one thing that exits,
      back to the board exactly where you were.

      The Vehicle section on that page auto-detects the vehicle as you type: enter a 17-character VIN and it
      decodes year/make/model plus a type (sedan, SUV, truck, van, coupe, or small) straight from the
      government's own VIN database, including a set of common JDM import names (Skyline, Silvia, Chaser, and
      similar) it recognizes by name alone. No VIN? Type Year/Make/Model instead — it checks what's already
      been seen before, and falls back to its best guess from the model name (clearly flagged as a guess) if
      it's genuinely new. Every vehicle you confirm teaches the system, so the same year/make/model is instant
      the next time anyone books it. Vehicle type and condition (Stock/Raised/Lowered, plus Extended/long-bed
      for trucks) drive a live Suggested price — "Confirm price" is what actually applies it to Amount;
      nothing changes the invoice on its own.

      "Audio Brief" at the top of the page lets you just talk a job in instead of typing it: hit the mic,
      say the pickup, drop-off, vehicle, and price the way you'd say it out loud to a person, hit it again to
      stop, then "Process Audio Brief" — it fills in Title/Pickup/Drop-off/Vehicle/Price from whatever it
      caught, and reads back what it understood out loud so you know it actually heard you right, without
      needing to look at the screen. Nothing saves on its own — you still review and hit Save same as always.

      Below that, "Price estimator" prices the actual run itself using Val's exact locked formula, off real
      driving distance the moment pickup and drop-off are both in (type miles by hand if you'd rather skip
      the address lookup). It auto-fills the vehicle size (Sedan/SUV/Truck) from what's already decoded above
      — pick Luxury or Exotic yourself if it's one of those, since there's no automatic way to detect that
      yet — and the season surcharge from the job's scheduled date. Rural destination is always your call,
      so set that before reading the quote. Luxury/Exotic ships enclosed-only (a separate, higher rate table
      Val locked in specifically for those, and the Open/Enclosed pick disappears since there's no other
      option); everything else gives you the Open/Enclosed choice. Either way it shows two numbers, Low
      ($150 broker fee) and High ($250 fee) — pick whichever you're quoting and click Confirm on that one;
      neither fills Amount by itself.

      One exception: a run that starts at the Long Beach or Wilmington port AND stays inside California,
      under 300 miles, automatically switches to a separate flat California local rate instead — 0–75 mi
      is $275/$475, 75–100 mi is $475/$575, and 100–300 mi is $600/$725, no vehicle/season/rural adjustment
      on any of those. The vehicle/rural/enclosed pickers hide themselves when this kicks in since none of
      them apply. Past 300 miles (or a drop-off outside California, or a pickup that isn't a CA port), it's
      back to Val's general locked formula above.

      "Assigned driver (in-house)" is separate from Assigned dispatcher above — dispatcher hands the whole job
      off to another business (Warrior Auto Transport, Team Auto Transport/Dispatch); driver is one of your own
      people, sorted by whoever currently has the fewest open jobs so the suggestion is an honest signal, not a
      guess. Only shows people whose own business card has "In-house driver" checked on it. "Text route" sends
      them the pickup/drop-off/vehicle details through your phone's own share sheet — it never claims they're
      actually available, that's still a phone call you make yourself before promising anything to the customer.

      Each job also shows Deposit and Final payment badges — red for unpaid, blue for paid, click either to
      flip it — independent of each other and of the invoice status badges next to them, so you can tell at a
      glance what's actually come in versus what's still outstanding.

      Once there's a customer, a vehicle, and a dollar amount on the job, hitting Save automatically builds
      both invoice drafts for you — a Deposit invoice for the Deposit amount, and a Balance invoice for
      whatever's left once that's subtracted from the total — correct customer, correct amount, correct
      vehicle/route on each, Zelle always included. Nothing gets emailed on its own: they're just sitting
      there ready under "Deposit invoice"/"Balance invoice" so opening one is reviewing and hitting Send,
      not starting from a blank form.

      "Send contract" emails the customer a booking agreement (their price, deposit, vehicle, and pickup/
      drop-off, plus standard transport terms) with a link to review and sign — type name, check "I agree,"
      done, no login needed on their end. The moment they sign, their deposit invoice is created and emailed
      automatically — one connected flow instead of two separate things to remember to send — and you get an
      internal alert both when the contract goes out and when it comes back signed, so you're not stuck
      checking the board to find out.`,
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
    nav: '/dashboard',
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
      out with it: the Stripe pay-now link, and/or your Venmo/Cash App/Apple Pay handles from Payment
      Settings. There's also Wave Checkout — Wave's payment links work without needing Wave's paid API tier
      and are reusable, so build a small library of them once under Payment Settings (name each one, e.g.
      "Escort - $85"), then just pick the right one from a dropdown when checking the Wave Checkout box on
      an invoice. Zelle is the one exception — it's always included on every invoice (deposit invoices
      created automatically from a signed contract too), checkbox locked on, the safest payment route —
      everything else only shows up if you check it.

      Zelle payments get matched automatically, too: every 15 minutes the app checks your connected Gmail
      for "you received a Zelle payment" notification emails and, when the amount and sender name line up
      with exactly one open invoice, marks it paid and flips that job's Deposit/Final badge on its own —
      you'll get an alert in your own inbox either way. If it's not sure (two open invoices at the same
      amount, or the name doesn't clearly match), it shows up under "Zelle payments needing review" at the
      top of this page instead of guessing — pick the right invoice and click Confirm paid, or Dismiss if it
      wasn't actually a match.

      If a customer emails saying they've already paid, that's a claim, not proof — only a bank's own Zelle
      notification counts as that. So instead of marking anything paid, a customer saying "I paid it" pops
      up as a banner at the bottom of the screen while you're in the app (plus an alert in your own inbox),
      telling you to go check your bank before marking it paid yourself. Dismiss it once you've checked.

      "Payment reminders" is its own section, off by default — check "Auto-remind if unpaid" and pick 3
      days, 7 days, or a custom number, and it'll email the customer that reminder every time that many days
      passes while the invoice is still unpaid, starting from when you sent it. It stops the instant the
      invoice is marked Paid, and nothing goes out at all unless you've checked the box.

      Once a job is actually done — the vehicle's picked up, the service performed — click "Mark job done" up
      top (separate from marking it Paid, since a job can be finished before payment clears). That stamps a
      completion date on the invoice, and drops a note into that customer's own Timeline on their Contact
      page — the same place delivery orders and other paperwork already show up — so you can always look up a
      customer and see exactly when their job wrapped. See Completed Jobs for the full list.`,
  },
  {
    id: 'completed-jobs',
    title: 'Completed Jobs',
    nav: '/completed-jobs',
    body: `A spreadsheet-style list of every job you've clicked "Mark job done" on (see Invoices) — customer,
      invoice number, the date it was completed, payment status, when it was paid, and the amount, all in one
      table. Click the status cell on any row to change it right there (marking Paid asks how, the same as on
      the invoice itself) — no need to open each invoice one at a time just to update where it stands.`,
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
    body: `Enter your Zelle, Venmo, Cash App, and Apple Pay handles once. From then on they're available as
      check-off options in a job's invoice (see Invoices) and in the "send a payment request" automation
      action (see Automations) — no separate app needed. Zelle is automatically included on every invoice
      from then on, no checkbox needed — the other three stay optional. None of these have a way to
      auto-confirm payment landed, so you'll still mark it paid yourself once it does.

      This page also holds your Wave Checkout links — Wave has no API to generate one automatically, so you
      build a link by hand in Wave (the "Create a new Wave Checkout" button jumps you straight there once
      you've saved your Wave dashboard URL) and save it here with a label. They're reusable, so save as many
      as you want and just pick the right one from a dropdown when building an invoice.`,
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
      above works identically no matter which layout is active.

      Also here: an optional idle timeout, off by default. Turn it on and pick a number of minutes, and the
      screen resets to your branded "Enter CRM" front door after that long with no mouse/keyboard/touch
      activity — handy if this runs on a shared or kiosk-style dispatch terminal. Your company name, logo,
      and tagline shown there (and in the sidebar) are set under Invoices → "Business info."`,
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
  {
    id: 'document-requests',
    title: 'Document Requests',
    nav: '/settings/document-requests',
    body: `Sets up the options that show up when you click "Request a Document" on a contact's Files & Photos
      section — each one is a starting name, subject, and message, all still editable before you actually
      send it. Every organization starts with one generic "Supporting Documents" preset — add your own
      (a signed contract, a deposit receipt, a model release, whatever your business actually needs from
      customers) or edit/remove the default. "Custom" is always available too, for a one-off request that
      doesn't fit any saved preset. Use {{first_name}} in your message and it's swapped for the contact's
      first name automatically.`,
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
              <p className="text-sm text-muted">Go to <a href="/payment-settings" className="text-accent hover:underline">Payment Settings</a> and enter your Zelle/Venmo/Cash App/Apple Pay handles, and/or save your Wave Checkout links there too. Any of these can be checked on an invoice when you send it.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>4</span>
            <div>
              <p className="text-sm font-semibold text-ink">Set up your invoice header</p>
              <p className="text-sm text-muted">Go to <a href="/invoices" className="text-accent hover:underline">Invoices</a> and click "Business info" to set your name/address/phone/logo/EIN — this is what prints on every invoice you send, separate from your booking business info.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>5</span>
            <div>
              <p className="text-sm font-semibold text-ink">Connect Gmail</p>
              <p className="text-sm text-muted">Go to <a href="/inbox" className="text-accent hover:underline">Inbox</a> and click "Connect Gmail," then sign in with Google. This is required — automated payment/document-request emails, replies, and mail sync all use your own connected account, not a shared one, and won't work at all until this is done.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>6</span>
            <div>
              <p className="text-sm font-semibold text-ink">Connect your Calendly</p>
              <p className="text-sm text-muted">Go to <a href="/settings/scheduling" className="text-accent hover:underline">Scheduling</a> and paste in your own Calendly link. This is required too — until it's set, the "Book" button and scheduler on a contact's page stay hidden rather than showing anyone else's calendar.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>7</span>
            <div>
              <p className="text-sm font-semibold text-ink">Set up your (or your drivers') digital business cards</p>
              <p className="text-sm text-muted">Go to <a href="/settings/card-links" className="text-accent hover:underline">Digital Business Cards</a>, click "+ Add a card" → "Set up a new card here," fill in one form, and copy the link it gives you at the end.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>8</span>
            <div>
              <p className="text-sm font-semibold text-ink">Bring in your existing contacts</p>
              <p className="text-sm text-muted">Go to <a href="/contacts" className="text-accent hover:underline">Contacts</a> → "Import" to bring in your whole phone/CRM contact list at once (CSV or vCard), or use "Scan card" any time to add someone one photographed business card at a time.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>9</span>
            <div>
              <p className="text-sm font-semibold text-ink">Create a test booking</p>
              <p className="text-sm text-muted">From the <a href="/dashboard" className="text-accent hover:underline">Dashboard</a>, click "+ New Booking" and walk through it once so you know what a customer's job looks like on your pipeline.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>10</span>
            <div>
              <p className="text-sm font-semibold text-ink">Make it look like your business</p>
              <p className="text-sm text-muted">Go to <a href="/settings/appearance" className="text-accent hover:underline">Appearance</a> and pick one of seven dashboard layouts (plus light/dark mode) — applies for your whole organization, changes any time.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>11</span>
            <div>
              <p className="text-sm font-semibold text-ink">Connect TikTok (optional)</p>
              <p className="text-sm text-muted">Only needed if you want to auto-publish social posts. Go to <a href="/social-posts" className="text-accent hover:underline">Social Posts</a> and click "Connect TikTok." Skip this if you'll only ever draft posts and post them yourself.</p>
            </div>
          </li>
          <li className={step}>
            <span className={stepNum}>12</span>
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
