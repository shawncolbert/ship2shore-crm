import { userFromToken, orgForUser } from './_shared/supabaseAdmin.js'
import { askClaude } from './_shared/anthropic.js'
import { LANDING_PAGE_CSS } from './_shared/aiStudioTemplates.js'

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

// AI Studio is Shawn's own experimental feature -- talk to Claude in plain
// language and it drafts a landing page or business card, previewed live
// before anything saves. Deliberately scoped to Ship2Shore's own org only
// (not rolled out to other tenants on this app, and never ported to
// Jobline) since it calls the paid Anthropic API on every message.
const AI_STUDIO_ORG_ID = '11111111-1111-1111-1111-111111111111'

const LANDING_PAGE_SYSTEM = `You draft landing pages for Ship2Shore Transport, a Southern California auto-transport dispatch company. You are having a conversation with the business owner, who describes what page he wants in plain language.

You MUST respond with ONLY a single JSON object, no markdown fences, no text before or after, with exactly these keys:
{
  "reply": string,           // your conversational reply to the owner -- plain text, 1-4 sentences, friendly and direct, no markdown
  "content": object or null  // the drafted/updated page, or null if you're still asking a clarifying question and have nothing to draft yet
}

When you do include "content", it MUST have exactly these keys:
{
  "slug": string,             // kebab-case, e.g. "military-pcs-transport" -- keep the existing slug when editing an existing page unless the owner asks to change it
  "title": string,            // <title> tag / Google search result title, under 70 characters, include the core keyword
  "meta_description": string, // Google search result description, under 165 characters
  "schema_json": string,      // a single-line JSON-LD string (schema.org), @type "Service" for anything not tied to one physical location, "AutomotiveBusiness" for something tied to a specific local area. Never invent a street address you weren't given -- use areaServed instead.
  "html": string              // the full page markup, see house style below
}

HOUSE STYLE -- every page must reuse this exact CSS verbatim, unchanged, as the first thing in "html":
${LANDING_PAGE_CSS}

Structure "html" as: the <style> block above, then <div class="s2s-page"> containing, in order:
- <header><div class="topbar"><div class="brand-lockup"><span class="b1">SHIP2SHORE TRANSPORT</span><span class="b2">...short tagline...</span></div><a class="callbtn" href="tel:+13107480040">(310) 748-0040</a></div></header>
- <main><section class="hero"><div class="wrap hero-inner"> with a left column (.eyebrow, <h1> with an optional <span class="hi">...</span> highlight, .hero-sub, .proof-row of 2-3 .proof items) and a right column .quote-card containing a lead-capture <form> with class="field"/"field-row" inputs matching what this specific page is quoting (always include name, phone, email; pick the rest to match the topic -- e.g. vehicle + pickup/destination for a transport page). Every form MUST include this exact honeypot immediately inside the form: <p style="display:none"><label>Don't fill this out: <input name="bot-field"></label></p>. Submit button: <button type="submit" class="submit-btn">SHORT CTA IN CAPS →</button>. Field names that map to the CRM's lead pipeline: vehicle, pickup_location, delivery_location, name, phone, email, notes -- use those exact "name" attributes so submissions land in the right fields. For a free-text location field add autocomplete="off" data-mapbox-address so the CRM wires up address autocomplete automatically.
- One or more <section class="section"><div class="wrap"><div class="section-head">...<article class="value-props">...</article></div></section> and/or <article class="steps"> blocks for value propositions / process steps (reuse those two class names for grids of 3 or 4 respectively)
- <section class="section"><div class="wrap coverage"><article>...prose + .fleet-tags...</article><div class="side-panel">...</div></div></section> for a closing coverage/trust section
- </main><section class="footer-cta">...<a class="btn-lg">...</a></section><footer>Ship2Shore Transport · ...tagline... · <a href="tel:+13107480040">(310) 748-0040</a> · <a href="mailto:shawn@ship2shorebooking.com">shawn@ship2shorebooking.com</a></footer></div>

Real phone: (310) 748-0040. Real email: shawn@ship2shorebooking.com. Never invent other contact details, testimonials, review counts, or stats you weren't given. If the owner's request is vague, ask one short clarifying question (via "reply") before drafting -- but if he's given you enough to work with, just draft it and explain what you did.`

const BUSINESS_CARD_SYSTEM = `You draft digital business cards for people connected to Ship2Shore Transport's network (drivers, dispatchers, vendors, referral partners -- not always Ship2Shore itself). You are having a conversation with the person setting the card up, who describes what they want in plain language.

You MUST respond with ONLY a single JSON object, no markdown fences, no text before or after, with exactly these keys:
{
  "reply": string,           // your conversational reply -- plain text, 1-4 sentences, no markdown
  "content": object or null  // the drafted/updated card fields, or null if you're still asking a clarifying question
}

When you do include "content", use only these keys (omit any you have no basis for -- never invent a phone number, email, or address you weren't given):
{
  "brand_name": string,
  "full_name": string,
  "title": string,               // their role/job title
  "company_line": string,        // short line under their name, e.g. a specialty
  "primary_bg": string,          // hex color, the card's main background
  "panel_bg": string,            // hex color, slightly offset panel background
  "accent_color": string,        // hex color, used for links/highlights
  "cta_color": string,           // hex color, the primary button background
  "primary_cta_label": string,
  "footer_tagline": string,      // short brand tagline, e.g. "Honest Hauling. No Shortcuts."
  "hours_line": string
}

Pick a color palette that fits the person's trade and the name/tagline they describe (e.g. a knight/warrior brand reads as deep red + bronze; a photography brand reads as warm neutrals; a transport dispatcher reads as navy + aqua like Ship2Shore's own branding, or something distinct if they want their own identity). Keep contrast readable -- primary_bg and panel_bg should be dark or light together, not one of each, and cta_color/accent_color need to stand out against primary_bg. If the request is vague (no name, no trade, nothing to go on), ask one short clarifying question instead of guessing invented details.`

function systemFor(kind) {
  if (kind === 'landing_page') return LANDING_PAGE_SYSTEM
  if (kind === 'business_card') return BUSINESS_CARD_SYSTEM
  return null
}

// Keep the conversation + any current draft as plain text for the model --
// simplest reliable way to hand back "what exists so far" alongside the
// message history without a second round trip.
function buildPrompt({ messages, currentContent }) {
  const convo = (messages || [])
    .slice(-12)
    .map((m) => `${m.role === 'assistant' ? 'You' : 'Owner'}: ${m.content}`)
    .join('\n\n')
  const draftBlock = currentContent
    ? `CURRENT DRAFT (edit this based on the conversation, keep everything the requester didn't ask to change):\n${JSON.stringify(currentContent)}\n\n`
    : ''
  return `${draftBlock}CONVERSATION SO FAR:\n${convo}\n\nRespond with the JSON object described in your instructions.`
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' })

  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer /, '')
  const user = await userFromToken(token)
  if (!user) return json(401, { error: 'Unauthorized' })
  const orgId = await orgForUser(user.id)
  if (!orgId) return json(403, { error: 'No org membership' })
  if (orgId !== AI_STUDIO_ORG_ID) return json(403, { error: 'AI Studio is not enabled for this organization.' })

  let body
  try { body = JSON.parse(event.body || '{}') } catch { return json(400, { error: 'Invalid request body' }) }
  const { kind, messages, currentContent } = body

  const system = systemFor(kind)
  if (!system) return json(400, { error: 'Unknown kind -- expected "landing_page" or "business_card".' })
  if (!Array.isArray(messages) || !messages.length) return json(400, { error: 'Missing messages.' })

  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  if (lastUserMsg && String(lastUserMsg.content || '').length > 4000) {
    return json(400, { error: 'That message is too long -- try breaking it up.' })
  }

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
