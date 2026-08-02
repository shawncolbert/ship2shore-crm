/* Prebuilt landing-page templates.
 *
 * Each one is a complete, ready-to-send page with real trade-appropriate copy
 * -- pick it, fill in the customer's details, publish. The point is that a
 * client page takes two minutes, not an afternoon of writing from scratch.
 *
 * Tokens in {{double braces}} are replaced at creation time from the details
 * form, so the page never ships with a placeholder still showing. Anything the
 * form can't fill is left as a visible [BRACKETED PROMPT] so it's obvious what
 * still needs a human -- silent blanks are worse than loud ones.
 *
 * These live in code rather than the database on purpose: they are always
 * available to every org, can't be deleted by accident, and a fix to one
 * benefits every future page.
 */

const b = (type, extra) => ({ type, ...extra })

// Shared closer: services list -> divider -> call to action.
const closer = (ctaLabel, target = 'lead_form') => [
  b('divider', {}),
  b('heading', { text: 'Get a Free Quote' }),
  b('paragraph', {
    text: 'Tell us what you need and we\'ll get back to you the same day. No obligation, no pressure.',
  }),
  b('cta', { label: ctaLabel, target }),
  b('spacer', { size: 'sm' }),
  b('paragraph', { text: '{{business}}  ·  {{phone}}  ·  Serving {{city}} and surrounding areas' }),
]

export const LANDING_TEMPLATES = [
  {
    id: 'photography',
    name: 'Photography',
    tagline: 'Portrait, event and commercial photographers',
    accent: '📷',
    blocks: [
      b('heading', { text: '{{business}} — Photography That Actually Looks Like You' }),
      b('paragraph', {
        text: 'Portraits, events and commercial work in {{city}}. Natural light, honest editing, and galleries delivered in days — not months.',
      }),
      b('image', { url: '', alt: 'Featured photograph' }),
      b('heading', { text: 'What I Shoot' }),
      b('paragraph', {
        text: '• Portraits — headshots, seniors, families, personal branding\n• Events — weddings, receptions, corporate functions, parties\n• Commercial — product, real estate interiors, team and staff photos\n• Content days — a half-day of images for your website and socials',
      }),
      b('heading', { text: 'How It Works' }),
      b('paragraph', {
        text: '1. We talk through what you need and where you want to shoot.\n2. Session day — most run 60 to 90 minutes and are genuinely relaxed.\n3. Your private online gallery arrives within 7 days, fully edited.\n4. Download anything you like, any size, print-ready.',
      }),
      ...closer('Book a Session'),
    ],
  },

  {
    id: 'welding',
    name: 'Welding / Metal Fabrication',
    tagline: 'Mobile welding, structural and custom fab shops',
    accent: '🔥',
    blocks: [
      b('heading', { text: '{{business}} — Mobile Welding & Custom Fabrication' }),
      b('paragraph', {
        text: 'Certified welding in {{city}}. We come to you with a fully equipped rig, or you bring it to the shop. Structural, ornamental and repair work — done right the first time.',
      }),
      b('image', { url: '', alt: 'Welding work in progress' }),
      b('heading', { text: 'Services' }),
      b('paragraph', {
        text: '• Mobile welding — on-site repairs, no towing needed\n• Structural — beams, columns, stairs, mezzanines, handrail\n• Custom fabrication — gates, railings, racks, brackets, trailer work\n• Aluminum & stainless — TIG work, food-grade and marine\n• Emergency repair — equipment down? Call, we\'ll prioritize it',
      }),
      b('heading', { text: 'Why Shops Call Us Back' }),
      b('paragraph', {
        text: '• Certified welders, not a guy with a machine\n• Clean welds that pass inspection\n• We show up when we say we will\n• Straight pricing quoted before we strike an arc',
      }),
      ...closer('Request a Quote'),
    ],
  },

  {
    id: 'real-estate',
    name: 'Real Estate',
    tagline: 'Agents, brokers and listing teams',
    accent: '🏡',
    blocks: [
      b('heading', { text: '{{business}} — Buying or Selling in {{city}}' }),
      b('paragraph', {
        text: 'Straight answers, real numbers, and an agent who picks up the phone. Whether it\'s your first home or your fifth investment property, you\'ll know exactly where you stand at every step.',
      }),
      b('image', { url: '', alt: 'Featured property' }),
      b('heading', { text: 'For Sellers' }),
      b('paragraph', {
        text: '• Free, no-obligation home valuation based on real comparable sales\n• Professional photography and staging guidance included\n• Listed across MLS, Zillow, Realtor.com and social\n• Weekly updates — you\'ll never wonder what\'s happening',
      }),
      b('heading', { text: 'For Buyers' }),
      b('paragraph', {
        text: '• Early access to listings before they hit the public sites\n• Honest assessments — I\'ll tell you when a house is a bad deal\n• Lender and inspector referrals I\'d use myself\n• Negotiation that protects your money, not the timeline',
      }),
      ...closer('Get a Free Home Valuation'),
    ],
  },

  {
    id: 'mortgage',
    name: 'Mortgage / Lending',
    tagline: 'Loan officers and mortgage brokers',
    accent: '🏦',
    blocks: [
      b('heading', { text: '{{business}} — Home Loans Without the Runaround' }),
      b('paragraph', {
        text: 'Pre-approval in 24 hours. Real rates, explained in plain English, from someone who answers the phone after 5pm.',
      }),
      b('heading', { text: 'Loan Programs' }),
      b('paragraph', {
        text: '• Conventional — as little as 3% down for qualified buyers\n• FHA — lower credit thresholds, 3.5% down\n• VA — $0 down for veterans and active duty\n• Jumbo — financing above conforming limits\n• Refinance — lower your rate, shorten your term, or pull cash out',
      }),
      b('heading', { text: 'What You\'ll Need' }),
      b('paragraph', {
        text: '• Two most recent pay stubs\n• Two years of W-2s or tax returns\n• Two months of bank statements\n• Photo ID\n\nThat\'s usually it to get started. We\'ll tell you early if something else is needed — no surprises a week before closing.',
      }),
      b('paragraph', {
        text: '[ADD YOUR NMLS NUMBER HERE — required on lending pages] · Equal Housing Lender',
      }),
      ...closer('Get Pre-Approved'),
    ],
  },

  {
    id: 'social-media',
    name: 'Social Media / Content Creator',
    tagline: 'Social managers, UGC creators and content studios',
    accent: '📱',
    blocks: [
      b('heading', { text: '{{business}} — Social Media That Brings In Customers' }),
      b('paragraph', {
        text: 'Not just posting. Content built to get your business found, followed and called — handled end to end so you can run the business instead of the feed.',
      }),
      b('heading', { text: 'What\'s Included' }),
      b('paragraph', {
        text: '• Content calendar planned a month ahead, approved by you\n• Short-form video — Reels, TikTok, Shorts — filmed and edited\n• Photo and graphic posts on brand\n• Captions, hashtags and posting at the right times\n• Comment and DM monitoring so leads don\'t sit unanswered\n• Monthly report on what actually moved the needle',
      }),
      b('heading', { text: 'Packages' }),
      b('paragraph', {
        text: 'Starter — 8 posts/month, 1 platform\nGrowth — 16 posts/month, 2 platforms, 4 short videos\nFull Service — daily posting, all platforms, video, ads management\n\n[ADJUST PACKAGES AND ADD YOUR PRICING]',
      }),
      ...closer('Book a Free Strategy Call'),
    ],
  },

  {
    id: 'plumbing',
    name: 'Plumbing',
    tagline: 'Residential and commercial plumbers',
    accent: '🔧',
    blocks: [
      b('heading', { text: '{{business}} — Licensed Plumbers in {{city}}' }),
      b('paragraph', {
        text: 'Same-day service on most calls. Upfront pricing before we start — you approve the number, then we do the work. No hourly meter running while you watch.',
      }),
      b('heading', { text: 'What We Handle' }),
      b('paragraph', {
        text: '• Emergency leaks and burst pipes — 24/7\n• Drain cleaning and hydro-jetting\n• Water heaters — repair, replacement, tankless conversion\n• Toilets, faucets, garbage disposals, fixtures\n• Sewer line camera inspection and repair\n• Repiping and remodel rough-in',
      }),
      b('heading', { text: 'Why Homeowners Call Us' }),
      b('paragraph', {
        text: '• Licensed, bonded and insured\n• Flat-rate pricing quoted before work begins\n• We put down drop cloths and clean up after ourselves\n• Workmanship warranty on every job',
      }),
      ...closer('Request Service'),
    ],
  },

  {
    id: 'hvac',
    name: 'HVAC',
    tagline: 'Heating, cooling and air quality contractors',
    accent: '❄️',
    blocks: [
      b('heading', { text: '{{business}} — Heating & Air Conditioning in {{city}}' }),
      b('paragraph', {
        text: 'AC out in the heat? We do same-day diagnostics and carry the common parts on the truck, so most repairs finish on the first visit.',
      }),
      b('heading', { text: 'Services' }),
      b('paragraph', {
        text: '• AC repair and installation\n• Furnace and heat pump service\n• Preventive maintenance plans — two visits a year, priority scheduling\n• Ductwork inspection, sealing and replacement\n• Indoor air quality — filtration, UV, humidity control\n• Thermostat upgrades and smart-home integration',
      }),
      b('heading', { text: 'Maintenance Plan' }),
      b('paragraph', {
        text: 'Spring and fall tune-ups, priority scheduling ahead of non-members, and a discount on any repair. Catching a failing capacitor in March costs a fraction of an emergency call in August.\n\n[ADD YOUR PLAN PRICING]',
      }),
      ...closer('Schedule Service'),
    ],
  },

  {
    id: 'auto-detailing',
    name: 'Auto Detailing / Mobile Mechanic',
    tagline: 'Mobile detailers and on-site mechanics',
    accent: '🚗',
    blocks: [
      b('heading', { text: '{{business}} — We Come to You' }),
      b('paragraph', {
        text: 'Mobile detailing and service throughout {{city}}. We bring water, power and everything else — you keep your day. Driveway, office lot, jobsite, doesn\'t matter.',
      }),
      b('image', { url: '', alt: 'Finished detail' }),
      b('heading', { text: 'Detailing Packages' }),
      b('paragraph', {
        text: 'Express — exterior wash, wheels, tires, windows, quick interior vacuum\nFull Detail — clay bar, machine polish, full interior shampoo, leather conditioning\nCeramic Coating — multi-year paint protection, gloss and easy washing\nEngine Bay — degreased, dressed, photo-ready\n\n[ADD YOUR PRICING PER VEHICLE SIZE]',
      }),
      b('heading', { text: 'Mobile Mechanic Services' }),
      b('paragraph', {
        text: '• Oil changes and scheduled maintenance\n• Brakes, rotors and pads\n• Batteries, alternators and starters\n• Diagnostics — check engine light scanned and explained\n• Pre-purchase inspection before you buy a used car',
      }),
      ...closer('Book Mobile Service'),
    ],
  },

  {
    id: 'landscaping',
    name: 'Landscaping',
    tagline: 'Lawn care, maintenance and hardscape crews',
    accent: '🌿',
    blocks: [
      b('heading', { text: '{{business}} — Landscaping & Lawn Care in {{city}}' }),
      b('paragraph', {
        text: 'Weekly maintenance that actually shows up, and design work that makes the neighbors ask who did it.',
      }),
      b('image', { url: '', alt: 'Completed landscaping project' }),
      b('heading', { text: 'Maintenance' }),
      b('paragraph', {
        text: '• Weekly or bi-weekly mowing, edging and blowing\n• Hedge and shrub trimming\n• Seasonal cleanups — leaves, storm debris, bed refresh\n• Fertilization and weed control programs\n• Irrigation repair and timer adjustment',
      }),
      b('heading', { text: 'Design & Install' }),
      b('paragraph', {
        text: '• Sod, seed and full lawn renovation\n• Planting — trees, shrubs, seasonal color\n• Mulch, rock and bed edging\n• Hardscape — pavers, patios, retaining walls, walkways\n• Drainage correction and grading\n• Landscape lighting',
      }),
      ...closer('Get a Free Estimate'),
    ],
  },

  {
    id: 'customs-logistics',
    name: 'Customs Broker / Logistics',
    tagline: 'Brokers, freight forwarders and port services',
    accent: '⚓',
    blocks: [
      b('heading', { text: '{{business}} — Customs Clearance & Port Logistics' }),
      b('paragraph', {
        text: 'Your cargo cleared, released and moving. We handle the filings, the holds and the port so your freight doesn\'t sit accruing demurrage while paperwork gets sorted out.',
      }),
      b('heading', { text: 'Services' }),
      b('paragraph', {
        text: '• Customs entry filing and clearance\n• ISF (10+2) filing before vessel departure\n• Duty, tariff and classification guidance\n• Bond arrangement — single entry and continuous\n• Exam and hold coordination with CBP\n• Delivery order correction and consignee changes\n• Drayage and final-mile delivery',
      }),
      b('heading', { text: 'Why It Matters' }),
      b('paragraph', {
        text: 'Every day a container sits past its last free date costs money. Most delays trace back to one of four things: customs not cleared, no original bill of lading on file, freight unpaid, or the wrong party named on the delivery order. We check all four before scheduling a pickup — not after.',
      }),
      ...closer('Request Clearance Support'),
    ],
  },
]

/* Replace {{tokens}} throughout a template's blocks. Any field left blank in
   the form falls back to a visible bracketed prompt rather than an empty gap,
   so an unfinished page is obvious at a glance instead of shipping with a
   dangling "Serving  and surrounding areas". */
export function applyTemplate(template, details) {
  const map = {
    business: details.business?.trim() || '[YOUR BUSINESS NAME]',
    phone: details.phone?.trim() || '[YOUR PHONE]',
    city: details.city?.trim() || '[YOUR SERVICE AREA]',
    email: details.email?.trim() || '[YOUR EMAIL]',
  }
  const fill = (v) =>
    typeof v === 'string' ? v.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m)) : v

  return template.blocks.map((blk) => {
    const out = { id: crypto.randomUUID(), ...blk }
    for (const key of ['text', 'label', 'alt', 'url']) {
      if (typeof out[key] === 'string') out[key] = fill(out[key])
    }
    return out
  })
}
