import { admin } from './_shared/supabaseAdmin.js'
import { requirePlatformAdmin } from './_shared/platformAdmin.js'
import { askClaude } from './_shared/anthropic.js'
import { LANDING_PAGE_CSS } from './_shared/aiStudioTemplates.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// AI Studio: platform-admin only (Shawn), works against any org he
// specifies -- including a brand-new client org he isn't a member of yet,
// so a landing page and business card can be pre-built before handing it
// over. Never rolled out as self-serve for a tenant's own users, and
// never ported to Jobline -- it calls the paid Anthropic API on every
// message, and cross-org access has to stay behind one trusted gate.

async function loadOrgContext(orgId) {
  const { data: org } = await admin
    .from('organizations').select('name, invoice_business_phone, invoice_business_website').eq('id', orgId).maybeSingle()
  const { data: card } = await admin
    .from('business_cards').select('phone, email, brand_name').eq('org_id', orgId).order('created_at', { ascending: true }).limit(1).maybeSingle()
  return {
    name: org?.name || card?.brand_name || null,
    phone: org?.invoice_business_phone || card?.phone || null,
    email: card?.email || null,
    website: org?.invoice_business_website || null,
  }
}

function contactLines(ctx) {
  const known = [
    ctx.name ? `Business name: ${ctx.name}` : null,
    ctx.phone ? `Phone: ${ctx.phone}` : null,
    ctx.email ? `Email: ${ctx.email}` : null,
    ctx.website ? `Website: ${ctx.website}` : null,
  ].filter(Boolean)
  return known.length
    ? known.join('\n')
    : '(No business name, phone, email, or website on file yet for this org.)'
}

function landingPageSystem(ctx) {
  return `You draft landing pages for a business using this CRM. You are having a conversation with the platform operator, who describes what page he wants in plain language -- possibly for a brand-new client org that hasn't been fully set up yet.

WHAT'S ON FILE FOR THIS ORG:
${contactLines(ctx)}

Use only real contact details from the list above -- never invent a phone number, email, or address. If something the page needs (like a phone number for a "call now" button) isn't on file, ask the operator for it via "reply" rather than inventing one or reusing an unrelated business's details.

You MUST respond with ONLY a single JSON object, no markdown fences, no text before or after, with exactly these keys:
{
  "reply": string,           // your conversational reply to the operator -- plain text, 1-4 sentences, friendly and direct, no markdown
  "content": object or null  // the drafted/updated page, or null if you're still asking a clarifying question and have nothing to draft yet
}

When you do include "content", it MUST have exactly these keys:
{
  "slug": string,             // kebab-case, e.g. "military-pcs-transport" -- keep the existing slug when editing an existing page unless asked to change it
  "title": string,            // <title> tag / Google search result title, under 70 characters, include the core keyword
  "meta_description": string, // Google search result description, under 165 characters
  "schema_json": string,      // a single-line JSON-LD string (schema.org), @type "Service" for anything not tied to one physical location, "LocalBusiness" or a more specific subtype for something tied to a specific local area. Never invent a street address you weren't given -- use areaServed instead.
  "html": string              // the full page markup, see house style below
}

HOUSE STYLE -- every page must reuse this exact CSS verbatim, unchanged, as the first thing in "html":
${LANDING_PAGE_CSS}

Structure "html" as: the <style> block above, then <div class="s2s-page"> containing, in order:
- <header><div class="topbar"><div class="brand-lockup"><span class="b1">THE BUSINESS NAME, ALL CAPS</span><span class="b2">...short tagline...</span></div>...and a <a class="callbtn" href="tel:+1XXXXXXXXXX">formatted phone</a> ONLY if a phone number is on file above; omit that link entirely otherwise, don't invent one...</div></header>
- <main><section class="hero"><div class="wrap hero-inner"> with a left column (.eyebrow, <h1> with an optional <span class="hi">...</span> highlight, .hero-sub, .proof-row of 2-3 .proof items) and a right column .quote-card containing a lead-capture <form> with class="field"/"field-row" inputs matching what this specific page is quoting. Every form MUST include this exact honeypot immediately inside the form: <p style="display:none"><label>Don't fill this out: <input name="bot-field"></label></p>. Submit button: <button type="submit" class="submit-btn">SHORT CTA IN CAPS →</button>. Field names that map to the CRM's lead pipeline: vehicle, pickup_location, delivery_location, name, phone, email, notes -- use those exact "name" attributes so submissions land in the right fields (always include name, phone, email; pick the rest to match the topic). For a free-text location field add autocomplete="off" data-mapbox-address so the CRM wires up address autocomplete automatically.
- One or more <section class="section"><div class="wrap"><div class="section-head">...<article class="value-props">...</article></div></section> and/or <article class="steps"> blocks for value propositions / process steps (reuse those two class names for grids of 3 or 4 respectively)
- <section class="section"><div class="wrap coverage"><article>...prose + .fleet-tags...</article><div class="side-panel">...</div></div></section> for a closing coverage/trust section
- </main><section class="footer-cta">...<a class="btn-lg">...</a></section><footer>business name · tagline, plus a tel: link and/or mailto: link for whichever of phone/email are on file above (omit whichever isn't)</footer></div>

Never invent testimonials, review counts, or stats you weren't given. If the operator's request is vague, ask one short clarifying question (via "reply") before drafting -- but if he's given you enough to work with, just draft it and explain what you did.`
}

function businessCardSystem(ctx) {
  return `You draft digital business cards for people connected to this CRM's network (drivers, dispatchers, vendors, referral partners, or a brand-new client org's own owner). You are having a conversation with the platform operator, who describes what he wants in plain language.

WHAT'S ALREADY ON FILE FOR THIS ORG:
${contactLines(ctx)}

You MUST respond with ONLY a single JSON object, no markdown fences, no text before or after, with exactly these keys:
{
  "reply": string,           // your conversational reply -- plain text, 1-4 sentences, no markdown
  "content": object or null  // the drafted/updated card fields, or null if you're still asking a clarifying question
}

When you do include "content", use only these keys (omit any you have no basis for -- never invent a phone number, email, or address you weren't given; use what's on file above when it fits, or ask the operator for it):
{
  "slug": string,                // kebab-case, e.g. "fernando-carvalho" -- keep the existing slug when editing an existing card unless asked to change it
  "brand_name": string,
  "full_name": string,
  "title": string,               // their role/job title
  "company_line": string,        // short line under their name, e.g. a specialty
  "phone": string,
  "email": string,
  "primary_bg": string,          // hex color, the card's main background
  "panel_bg": string,            // hex color, slightly offset panel background
  "accent_color": string,        // hex color, used for links/highlights
  "cta_color": string,           // hex color, the primary button background
  "primary_cta_label": string,
  "footer_tagline": string,      // short brand tagline
  "hours_line": string
}

Pick a color palette that fits the trade and the name/tagline described (e.g. a knight/warrior brand reads as deep red + bronze; a photography brand reads as warm neutrals; a transport dispatcher reads as navy + aqua). Keep contrast readable -- primary_bg and panel_bg should be dark or light together, not one of each, and cta_color/accent_color need to stand out against primary_bg. If the request is vague (no name, no trade, nothing to go on), ask one short clarifying question instead of guessing invented details.`
}

function buildPrompt({ messages, currentContent }) {
  const convo = (messages || [])
    .slice(-12)
    .map((m) => `${m.role === 'assistant' ? 'You' : 'Operator'}: ${m.content}`)
    .join('\n\n')
  const draftBlock = currentContent
    ? `CURRENT DRAFT (edit this based on the conversation, keep everything the operator didn't ask to change):\n${JSON.stringify(currentContent)}\n\n`
    : ''
  return `${draftBlock}CONVERSATION SO FAR:\n${convo}\n\nRespond with the JSON object described in your instructions.`
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const caller = await requirePlatformAdmin(token)
  if (!caller) return json(403, { error: 'Not a platform admin' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { kind, orgId, messages, currentContent } = body
  if (!orgId) return json(400, { error: 'Missing orgId' })
  if (kind !== 'landing_page' && kind !== 'business_card') {
    return json(400, { error: 'Unknown kind -- expected "landing_page" or "business_card".' })
  }
  if (!Array.isArray(messages) || !messages.length) return json(400, { error: 'Missing messages.' })

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  if (lastUserMsg && String(lastUserMsg.content || '').length > 4000) {
    return json(400, { error: 'That message is too long -- try breaking it up.' })
  }

  const ctx = await loadOrgContext(orgId)
  const system = kind === 'landing_page' ? landingPageSystem(ctx) : businessCardSystem(ctx)

  let raw
  try {
    raw = await askClaude({
      system,
      prompt: buildPrompt({ messages, currentContent }),
      maxTokens: kind === 'landing_page' ? 8000 : 1500,
    })
  } catch (e) {
    return json(502, { error: 'Could not reach the AI service: ' + String(e.message || e) })
  }

  let parsed
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return json(502, { error: "That draft didn't come back clean -- try rephrasing, or ask again." })
  }

  if (!parsed || typeof parsed !== 'object' || typeof parsed.reply !== 'string') {
    return json(502, { error: "That draft didn't come back clean -- try rephrasing, or ask again." })
  }

  return json(200, { reply: parsed.reply, content: parsed.content || null })
}
