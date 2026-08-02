/* Prebuilt landing-page templates.
 *
 * Each one is a complete, designed page -- photographic hero, service grid,
 * proof, call to action, contact bar -- with real trade-appropriate copy.
 * Pick it, fill in the customer's details, publish.
 *
 * Tokens in {{double braces}} are replaced at creation time from the details
 * form, so the page never ships with a placeholder still showing. Anything the
 * form can't fill is left as a visible [BRACKETED PROMPT] so it's obvious what
 * still needs a human -- silent blanks are worse than loud ones.
 *
 * Two categories are deliberately left as prompts rather than prefilled:
 * headline numbers (years in business, jobs completed) and customer
 * testimonials. Those are claims about a real business and a real person's
 * words. Inventing them would put fabricated credentials and fake reviews on
 * a page the customer publishes under their own name, so the template asks
 * for them instead of guessing.
 *
 * These live in code rather than the database on purpose: they are always
 * available to every org, can't be deleted by accident, and a fix to one
 * benefits every future page.
 */

// Hero photography, generated for these templates. The renderer treats the
// image as a layer over a brand gradient and hides it on error, so a page
// whose image fails to load degrades to a clean dark hero rather than
// breaking. Swap any of these for the customer's own photography -- their
// real work will always outperform stock.
const IMG = 'https://d8j0ntlcm91z4.cloudfront.net/user_3Em41yWm3qImtZanUNHBaB0IPjN/'
const HERO = {
  photography: `${IMG}hf_20260802_070841_31aed9c0-52d1-481a-9a05-78b56fa9598c_min.webp`,
  welding: `${IMG}hf_20260802_070847_527c1317-666a-4fa6-949d-082ffc46d22c_min.webp`,
  realEstate: `${IMG}hf_20260802_070850_1cc22eed-fd7a-4b77-8c3e-b6789c5bc411_min.webp`,
  mortgage: `${IMG}hf_20260802_070855_a7a6c47a-2236-473e-a34c-9d3f3e4d88b9_min.webp`,
  social: `${IMG}hf_20260802_071020_31fd4178-d1d5-40e9-8f6c-b48e3c29c4e2_min.webp`,
  plumbing: `${IMG}hf_20260802_071025_08a218f4-0223-4c4a-abb8-d37edf71de83_min.webp`,
  hvac: `${IMG}hf_20260802_071029_860ed1f1-3772-4ec9-8b72-f1cb21a843c8_min.webp`,
  detailing: `${IMG}hf_20260802_071038_20828713-0164-4792-85aa-32b3f508d012_min.webp`,
  landscaping: `${IMG}hf_20260802_071042_03c8ad3c-da4f-4531-80c4-24e88e85261e_min.webp`,
  logistics: `${IMG}hf_20260802_071114_91a29b4f-ea7d-423b-ad7a-3600cf72a736_min.webp`,
}

const b = (type, extra) => ({ type, ...extra })

const hero = (image, eyebrow, heading, subheading, ctaLabel) =>
  b('hero', { image, eyebrow, heading, subheading, ctaLabel, ctaTarget: 'lead_form' })

const features = (title, items) => b('features', { title, items })

// Headline numbers are claims about a real business, so they ship as prompts.
const stats = (a, c, d) => b('stats', { items: [a, c, d] })

// Never prefilled with invented praise -- a fabricated review is a fake review.
const proof = (role) => b('testimonial', {
  quote: '[PASTE A REAL REVIEW FROM ONE OF YOUR CUSTOMERS HERE]',
  author: '[CUSTOMER NAME]',
  role,
})

const closer = (ctaLabel, blurb) => [
  b('heading', { text: 'Get a Free Quote' }),
  b('paragraph', { text: blurb }),
  b('cta', { label: ctaLabel, target: 'lead_form' }),
  b('spacer', { size: 'sm' }),
  b('contact', { business: '{{business}}', phone: '{{phone}}', email: '{{email}}', area: 'Serving {{city}} and surrounding areas' }),
]

export const LANDING_TEMPLATES = [
  {
    id: 'photography',
    name: 'Photography',
    tagline: 'Portrait, event and commercial photographers',
    accent: '📷',
    blocks: [
      hero(HERO.photography, 'Photography in {{city}}',
        '{{business}}',
        'Portraits, events and commercial work. Natural light, honest editing, and galleries delivered in days — not months.',
        'Book a Session'),
      stats(
        { value: '[##]', label: 'Years shooting' },
        { value: '7 days', label: 'Gallery turnaround' },
        { value: '[###]', label: 'Sessions delivered' },
      ),
      features('What I Shoot', [
        { icon: '👤', title: 'Portraits', text: 'Headshots, seniors, families and personal branding — relaxed sessions that actually look like you.' },
        { icon: '🎉', title: 'Events', text: 'Weddings, receptions, corporate functions and parties, covered start to finish.' },
        { icon: '🏷️', title: 'Commercial', text: 'Product, real estate interiors, and team photos built for your website and socials.' },
      ]),
      b('heading', { text: 'How It Works' }),
      b('paragraph', {
        text: '1. We talk through what you need and where you want to shoot.\n2. Session day — most run 60 to 90 minutes and are genuinely relaxed.\n3. Your private online gallery arrives within 7 days, fully edited.\n4. Download anything you like, any size, print-ready.',
      }),
      proof('Portrait client'),
      ...closer('Book a Session', 'Tell me what you have in mind and I\'ll get back to you the same day with availability and pricing.'),
    ],
  },

  {
    id: 'welding',
    name: 'Welding / Metal Fabrication',
    tagline: 'Mobile welding, structural and custom fab shops',
    accent: '🔥',
    blocks: [
      hero(HERO.welding, 'Mobile & Shop Welding',
        '{{business}}',
        'Certified welding in {{city}}. We come to you with a fully equipped rig, or you bring it to the shop. Structural, ornamental and repair work — done right the first time.',
        'Get a Free Quote'),
      stats(
        { value: '[##]', label: 'Years in the trade' },
        { value: '24 hr', label: 'Quote turnaround' },
        { value: '[CERT]', label: 'Certifications held' },
      ),
      features('What We Weld', [
        { icon: '🚚', title: 'Mobile Repair', text: 'On-site welding for equipment, trailers, gates and structures that can\'t move. Fully equipped truck.' },
        { icon: '🏗️', title: 'Structural', text: 'Beams, columns, stairs and railings — fabricated and installed to spec.' },
        { icon: '⚒️', title: 'Custom Fab', text: 'Ornamental iron, racks, brackets, one-off parts. Bring a sketch or a broken original.' },
      ]),
      b('heading', { text: 'Materials & Processes' }),
      b('paragraph', {
        text: '• MIG, TIG and stick welding\n• Steel, stainless and aluminum\n• Cutting, bending and fitting\n• Emergency and after-hours repair available',
      }),
      proof('Shop owner'),
      ...closer('Get a Free Quote', 'Send a photo of the job and we\'ll come back with a number — usually the same day. No obligation.'),
    ],
  },

  {
    id: 'real-estate',
    name: 'Real Estate',
    tagline: 'Agents, brokers and listing teams',
    accent: '🏡',
    blocks: [
      hero(HERO.realEstate, 'Buying & Selling in {{city}}',
        '{{business}}',
        'Straight answers, real numbers, and an agent who picks up the phone. Whether it\'s your first home or your fifth investment property, you\'ll know exactly where you stand at every step.',
        'Get a Free Home Valuation'),
      stats(
        { value: '[##]', label: 'Years licensed' },
        { value: '[###]', label: 'Homes closed' },
        { value: '[##]', label: 'Avg days on market' },
      ),
      features('How I Help', [
        { icon: '🔑', title: 'Buyers', text: 'Off-market leads, honest walkthroughs, and negotiation that protects your budget — not the deal.' },
        { icon: '📈', title: 'Sellers', text: 'Pricing backed by real comps, professional photography, and a marketing plan you can actually see.' },
        { icon: '🏘️', title: 'Investors', text: 'Cash-flow analysis, rental comps, and honest talk about which properties aren\'t worth it.' },
      ]),
      b('heading', { text: 'What You Can Expect' }),
      b('paragraph', {
        text: '1. A no-pressure conversation about what you actually want.\n2. A written plan with real numbers — pricing, timeline, costs.\n3. Weekly updates, whether there\'s news or not.\n4. Someone in your corner through closing and after.',
      }),
      proof('Recent client'),
      ...closer('Get a Free Home Valuation', 'Curious what your home is worth, or what you can afford? Ask and I\'ll send real numbers — no sales pitch attached.'),
    ],
  },

  {
    id: 'mortgage',
    name: 'Mortgage / Lending',
    tagline: 'Loan officers and mortgage brokers',
    accent: '🏦',
    blocks: [
      hero(HERO.mortgage, 'Home Loans in {{city}}',
        '{{business}}',
        'Pre-approval in 24 hours. Real rates, explained in plain English, from someone who answers the phone after 5pm.',
        'Get Pre-Approved'),
      stats(
        { value: '24 hr', label: 'Pre-approval' },
        { value: '[##]', label: 'Years lending' },
        { value: '[###]', label: 'Families funded' },
      ),
      features('Loan Programs', [
        { icon: '🏠', title: 'Conventional & FHA', text: 'Low down payment options for first-time buyers, plus standard conventional financing.' },
        { icon: '🎖️', title: 'VA & USDA', text: 'Zero-down programs for veterans and eligible rural properties.' },
        { icon: '🔄', title: 'Refinance', text: 'Rate-and-term, cash-out, and honest math on whether refinancing is worth it for you.' },
      ]),
      b('heading', { text: 'The Process' }),
      b('paragraph', {
        text: '1. A 15-minute call — income, credit, goals. No hard pull.\n2. Pre-approval letter, usually within 24 hours.\n3. Shop with confidence; sellers take you seriously.\n4. We handle underwriting and keep you posted through closing.',
      }),
      proof('First-time buyer'),
      b('paragraph', { text: '[ADD YOUR NMLS NUMBER HERE — required on lending pages]' }),
      ...closer('Get Pre-Approved', 'Send your details and I\'ll come back with what you qualify for and what it actually costs per month.'),
    ],
  },

  {
    id: 'social-media',
    name: 'Social Media / Content Creator',
    tagline: 'Social managers, UGC creators and content studios',
    accent: '📱',
    blocks: [
      hero(HERO.social, 'Content That Converts',
        '{{business}}',
        'Not just posting. Content built to get your business found, followed and called — handled end to end so you can run the business instead of the feed.',
        'Book a Strategy Call'),
      stats(
        { value: '[##]', label: 'Brands served' },
        { value: '[##]x', label: 'Avg reach lift' },
        { value: '[##] hr', label: 'Saved per week' },
      ),
      features('What We Handle', [
        { icon: '🎬', title: 'Content Production', text: 'Short-form video, photo and graphics shot and edited on a schedule you can count on.' },
        { icon: '📅', title: 'Posting & Scheduling', text: 'Consistent publishing across Instagram, TikTok, Facebook and Google Business.' },
        { icon: '📊', title: 'Reporting', text: 'A plain-English monthly summary of what worked, what didn\'t, and what we\'re changing.' },
      ]),
      b('heading', { text: 'Packages' }),
      b('paragraph', { text: '[ADJUST PACKAGES AND ADD YOUR PRICING]\n\n• Starter — 8 posts a month, 1 content day per quarter\n• Growth — 16 posts a month, monthly content day, monthly reporting\n• Full service — everything above plus ads management and community replies' }),
      proof('Local business owner'),
      ...closer('Book a Strategy Call', 'Tell us about your business and we\'ll come back with a content plan and a price — no retainer talk until you\'ve seen it.'),
    ],
  },

  {
    id: 'plumbing',
    name: 'Plumbing',
    tagline: 'Residential and commercial plumbers',
    accent: '🔧',
    blocks: [
      hero(HERO.plumbing, 'Licensed Plumbers in {{city}}',
        '{{business}}',
        'Same-day service on most calls. Upfront pricing before we start — you approve the number, then we do the work. No hourly meter running while you watch.',
        'Request Service'),
      stats(
        { value: 'Same day', label: 'Most service calls' },
        { value: '[##]', label: 'Years licensed' },
        { value: '24/7', label: 'Emergency line' },
      ),
      features('What We Fix', [
        { icon: '🚿', title: 'Repairs', text: 'Leaks, clogs, running toilets, low pressure, burst pipes — diagnosed and fixed the same visit where possible.' },
        { icon: '🔥', title: 'Water Heaters', text: 'Repair, replacement and tankless conversions, including haul-away of the old unit.' },
        { icon: '🏗️', title: 'Repipe & Install', text: 'Whole-home repipes, fixture installs, and rough-in for remodels and additions.' },
      ]),
      b('heading', { text: 'How Pricing Works' }),
      b('paragraph', {
        text: '1. We diagnose the problem and show you what we found.\n2. You get a flat price for the fix, in writing, before any work starts.\n3. You approve it — or you don\'t, and you owe nothing beyond the trip fee.\n4. We clean up after ourselves. Every time.',
      }),
      proof('Homeowner'),
      ...closer('Request Service', 'Tell us what\'s going on and we\'ll get you on the schedule — usually today or tomorrow.'),
    ],
  },

  {
    id: 'hvac',
    name: 'HVAC',
    tagline: 'Heating, cooling and air quality contractors',
    accent: '❄️',
    blocks: [
      hero(HERO.hvac, 'Heating & Air in {{city}}',
        '{{business}}',
        'AC out in the heat? We do same-day diagnostics and carry the common parts on the truck, so most repairs are finished on the first visit.',
        'Schedule Service'),
      stats(
        { value: 'Same day', label: 'Diagnostics' },
        { value: '[##]', label: 'Years in business' },
        { value: '[##] yr', label: 'Install warranty' },
      ),
      features('Services', [
        { icon: '🛠️', title: 'Repair', text: 'Diagnostics on any brand, with common parts stocked on the truck for first-visit fixes.' },
        { icon: '📦', title: 'Installation', text: 'Right-sized systems with a load calculation — not a guess based on what was there before.' },
        { icon: '🌬️', title: 'Air Quality', text: 'Filtration, humidity control and duct sealing for homes that never quite feel right.' },
      ]),
      b('heading', { text: 'Maintenance Plans' }),
      b('paragraph', { text: '[ADD YOUR PLAN PRICING]\n\nTwo visits a year — heating before winter, cooling before summer. Members get priority scheduling and a discount on repairs.' }),
      proof('Homeowner'),
      ...closer('Schedule Service', 'Tell us what your system is doing and we\'ll get a tech out — same day when we can.'),
    ],
  },

  {
    id: 'auto-detailing',
    name: 'Auto Detailing / Mobile Mechanic',
    tagline: 'Mobile detailers and on-site mechanics',
    accent: '🚗',
    blocks: [
      hero(HERO.detailing, 'We Come to You',
        '{{business}}',
        'Mobile detailing and service throughout {{city}}. We bring water, power and everything else — you keep your day. Book at home or at the office.',
        'Book My Detail'),
      stats(
        { value: '100%', label: 'Mobile service' },
        { value: '[##]', label: 'Years detailing' },
        { value: '[###]', label: 'Vehicles done' },
      ),
      features('Packages', [
        { icon: '✨', title: 'Maintenance Wash', text: 'Hand wash, wheels, tires and interior vacuum — the every-few-weeks reset.' },
        { icon: '💎', title: 'Full Detail', text: 'Clay bar, machine polish, interior shampoo and leather conditioning. Paint that looks new again.' },
        { icon: '🛡️', title: 'Paint Protection', text: 'Ceramic coating and sealant with real durability — not a spray wax that lasts a week.' },
      ]),
      b('heading', { text: 'Pricing' }),
      b('paragraph', { text: '[ADD YOUR PRICING PER VEHICLE SIZE]\n\nPricing varies by vehicle size and condition. Send a photo and we\'ll quote it exactly.' }),
      proof('Repeat customer'),
      ...closer('Book My Detail', 'Send your vehicle and where you\'re parked, and we\'ll come back with a price and the next open slot.'),
    ],
  },

  {
    id: 'landscaping',
    name: 'Landscaping',
    tagline: 'Lawn care, maintenance and hardscape crews',
    accent: '🌿',
    blocks: [
      hero(HERO.landscaping, 'Landscaping & Lawn Care in {{city}}',
        '{{business}}',
        'Weekly maintenance that actually shows up, and design work that makes the whole property look intentional. Same crew every visit.',
        'Get a Free Estimate'),
      stats(
        { value: 'Weekly', label: 'Reliable service' },
        { value: '[##]', label: 'Years serving {{city}}' },
        { value: '[###]', label: 'Properties maintained' },
      ),
      features('What We Do', [
        { icon: '🌱', title: 'Lawn Maintenance', text: 'Mowing, edging, blowing and trimming on a set weekly or biweekly schedule.' },
        { icon: '🌸', title: 'Beds & Planting', text: 'Mulch, seasonal color, shrub shaping and cleanups that reset the whole yard.' },
        { icon: '🧱', title: 'Hardscape', text: 'Patios, walkways, retaining walls and borders built to last through the seasons.' },
      ]),
      b('heading', { text: 'How We Work' }),
      b('paragraph', {
        text: '1. We walk the property with you and listen to what bothers you about it.\n2. You get a written estimate — per visit and per season.\n3. Same crew every visit, so nobody has to be re-taught your property.\n4. We text when we\'re on the way and when we\'re done.',
      }),
      proof('Property owner'),
      ...closer('Get a Free Estimate', 'Tell us the address and what you\'re after — we\'ll walk it and send a written estimate.'),
    ],
  },

  {
    id: 'customs-logistics',
    name: 'Customs / Logistics',
    tagline: 'Freight forwarders, brokers and port services',
    accent: '🚢',
    blocks: [
      hero(HERO.logistics, 'Port & Freight Services',
        '{{business}}',
        'Customs clearance, drayage and port services out of {{city}}. We know the terminals, the paperwork and the people — so your freight moves instead of sitting.',
        'Request Clearance Support'),
      stats(
        { value: '[##]', label: 'Years at the port' },
        { value: '[###]', label: 'Shipments cleared' },
        { value: '24/7', label: 'Dispatch' },
      ),
      features('Services', [
        { icon: '📋', title: 'Customs Clearance', text: 'Entry filing, classification and duty handling — with the documentation right the first time.' },
        { icon: '🚛', title: 'Drayage & Trucking', text: 'Container pulls, hotshot runs and full load-and-unload from terminal to door.' },
        { icon: '🪪', title: 'TWIC Escort', text: 'Licensed escort for drivers and vendors without a TWIC card, in and out of secure areas.' },
      ]),
      b('heading', { text: 'Why It Matters' }),
      b('paragraph', {
        text: '• Demurrage and per-diem start fast — we move before the clock does.\n• One point of contact, not a ticket queue.\n• Real-time status, not "we\'ll check and call you back".\n• Licensed, bonded and insured.',
      }),
      proof('Freight client'),
      ...closer('Request Clearance Support', 'Send your BOL or container number and we\'ll tell you exactly what it takes to move it.'),
    ],
  },
]

/* Replace {{tokens}} throughout a template's blocks. Any field left blank in
   the form falls back to a visible bracketed prompt rather than an empty gap,
   so an unfinished page is obvious at a glance instead of shipping with a
   dangling "Serving  and surrounding areas". */
const FILLABLE = ['text', 'label', 'alt', 'url', 'heading', 'subheading', 'eyebrow', 'ctaLabel',
  'title', 'quote', 'author', 'role', 'business', 'phone', 'email', 'area', 'value']

export function applyTemplate(template, details) {
  const map = {
    business: details.business?.trim() || '[YOUR BUSINESS NAME]',
    phone: details.phone?.trim() || '[YOUR PHONE]',
    city: details.city?.trim() || '[YOUR SERVICE AREA]',
    email: details.email?.trim() || '[YOUR EMAIL]',
  }
  const fill = (v) =>
    typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m)) : v

  const fillFields = (obj) => {
    const out = { ...obj }
    for (const key of FILLABLE) {
      if (typeof out[key] === 'string') out[key] = fill(out[key])
    }
    // Nested rows -- features cards and stat tiles carry their own copy.
    if (Array.isArray(out.items)) out.items = out.items.map(fillFields)
    return out
  }

  return template.blocks.map((blk) => fillFields({ id: crypto.randomUUID(), ...blk }))
}
