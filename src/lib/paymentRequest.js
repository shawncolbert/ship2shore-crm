// Shared metadata + message template for manual payment requests
// (Zelle / Venmo / Cash App / Apple Pay). None of these four have an API or
// webhook, so there's no way to auto-detect when a customer actually pays —
// the dispatcher still confirms and moves the card to Paid by hand.
//
// This same template logic is mirrored server-side in
// supabase/functions/stage-change-webhook/index.ts for the automation path
// (a stage move can't call the browser-only sendEmail() helper, since that
// needs the logged-in user's session token — see docs/payment-requests.md).

export const PAYMENT_METHODS = [
  { value: 'zelle', label: 'Zelle', handleField: 'zelle_handle' },
  { value: 'venmo', label: 'Venmo', handleField: 'venmo_handle' },
  { value: 'cashapp', label: 'Cash App', handleField: 'cashapp_handle' },
  { value: 'apple_pay', label: 'Apple Pay', handleField: 'apple_pay_handle' },
]

export const methodLabel = (value) => PAYMENT_METHODS.find((m) => m.value === value)?.label || value

const money = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0)

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Venmo and Cash App both support a pay-link that pre-fills the amount, so
// those render as a clickable button. Zelle and Apple Pay have no such
// link (the customer has to open their own banking/Apple Wallet app and key
// it in themselves), so those render as a plain, large, read-it-off card
// instead of a button that would falsely imply a one-tap payment.
function venmoLink(handle, amount) {
  const clean = String(handle || '').replace(/^@/, '').trim()
  return `https://venmo.com/u/${encodeURIComponent(clean)}?amount=${encodeURIComponent(Number(amount) || 0)}`
}
function cashAppLink(handle, amount) {
  const clean = String(handle || '').replace(/^\$/, '').trim()
  return `https://cash.app/$${encodeURIComponent(clean)}/${encodeURIComponent(Number(amount) || 0)}`
}

const hasPayLink = (method) => method === 'venmo' || method === 'cashapp'

// Method-specific "how to pay" instructions for the plain-text fallback.
// payeeName (when set in Payment Settings) is included on every method, not
// just Zelle -- a customer who's dealt with multiple transport companies
// shouldn't have to guess whose handle they're looking at.
function instructionsFor(method, handle, amount, jobRef, payeeName) {
  const amt = money(amount)
  const ref = jobRef ? ` — please include "${jobRef}" in the memo/note` : ''
  const to = payeeName ? `${payeeName} (${handle})` : handle
  switch (method) {
    case 'zelle':
      return `Please send ${amt} to ${to} via Zelle${ref}.`
    case 'venmo':
      return `Please send ${amt} via Venmo${ref}: ${venmoLink(handle, amount)}`
    case 'cashapp':
      return `Please send ${amt} via Cash App${ref}: ${cashAppLink(handle, amount)}`
    case 'apple_pay':
      return `Please send ${amt} to ${to} via Apple Pay (Apple Cash)${ref}.`
    default:
      return `Please send ${amt} to ${to}${ref}.`
  }
}

// Inline-styled, table-based HTML so it renders consistently in Gmail/Outlook/
// Apple Mail without relying on a <style> block. Amber accent matches the
// app's theme (--color-accent: #e8a317).
function buildHtmlBody({ method, handle, amount, contactFirstName, jobTitle, jobRef, orgName, payeeName }) {
  const amt = money(amount)
  const label = methodLabel(method)
  const greeting = escapeHtml(contactFirstName || 'there')
  const brand = orgName || 'Dispatch'
  const jobLine = jobTitle
    ? `For your ${escapeHtml(orgName || 'your')} job (${escapeHtml(jobTitle)}), the amount due is:`
    : 'The amount due is:'
  const refLine = jobRef
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;">Please include <strong>${escapeHtml(jobRef)}</strong> in the memo/note.</p>`
    : ''

  let actionBlock
  if (hasPayLink(method)) {
    const url = method === 'venmo' ? venmoLink(handle, amount) : cashAppLink(handle, amount)
    actionBlock = `
      <tr>
        <td align="center" style="padding:8px 0 4px;">
          <a href="${url}" style="display:inline-block;background:#e8a317;color:#1a1a1a;font-weight:700;font-size:16px;text-decoration:none;padding:14px 32px;border-radius:10px;">
            Pay ${amt} with ${escapeHtml(label)}
          </a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:6px 0 0;">
          <p style="margin:0;font-size:12px;color:#9ca3af;word-break:break-all;">${url}</p>
          ${payeeName ? `<p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">Recipient: ${escapeHtml(payeeName)}</p>` : ''}
        </td>
      </tr>`
  } else {
    actionBlock = `
      <tr>
        <td style="padding:8px 0 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6e8;border:2px solid #e8a317;border-radius:12px;">
            <tr>
              <td align="center" style="padding:22px 20px;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#8a6d1a;">
                  Send via ${escapeHtml(label)}
                </div>
                ${payeeName ? `<div style="margin-top:6px;font-size:15px;font-weight:600;color:#1a1a1a;">${escapeHtml(payeeName)}</div>` : ''}
                <div style="margin-top:8px;font-size:26px;font-weight:700;color:#1a1a1a;">
                  ${escapeHtml(handle)}
                </div>
                <div style="margin-top:6px;font-size:14px;color:#4b5563;">
                  Amount: <strong>${amt}</strong>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>`
  }

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <tr>
          <td style="background:#1a1a1a;padding:18px 28px;">
            <span style="color:#e8a317;font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">${escapeHtml(brand)}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 8px;">
            <p style="margin:0 0 4px;font-size:15px;color:#1a1a1a;">Hi ${greeting},</p>
            <p style="margin:0;font-size:15px;color:#1a1a1a;">${jobLine}</p>
            <p style="margin:6px 0 0;font-size:32px;font-weight:700;color:#1a1a1a;">${amt}</p>
          </td>
        </tr>
        <tr><td style="padding:4px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${actionBlock}</table>
          ${refLine ? `<div style="padding:0 0 0;">${refLine}</div>` : ''}
        </td></tr>
        <tr>
          <td style="padding:24px 28px 28px;">
            <p style="margin:0;font-size:13px;color:#9ca3af;">Thank you,<br>${escapeHtml(brand)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`
}

// Builds the subject/body/html for the payment-request email. `jobRef` is
// typically the ship billing number or job title, whichever is available.
// `body` is the plain-text fallback (still sent alongside `html` in a
// multipart message, for text-only clients and accessibility).
export function buildPaymentRequestEmail({ method, handle, amount, contactFirstName, jobTitle, jobRef, orgName, payeeName }) {
  const label = methodLabel(method)
  const amt = money(amount)
  const brand = orgName || 'Dispatch'
  const subject = `Payment request — ${amt}${jobTitle ? ` for ${jobTitle}` : ''}`
  const body =
    `Hi ${contactFirstName || 'there'},\n\n` +
    `${jobTitle ? `For your ${orgName || 'your'} job (${jobTitle}), the ` : 'The '}amount due is ${amt}.\n\n` +
    `${instructionsFor(method, handle, amount, jobRef, payeeName)}\n\n` +
    `${label}: ${handle}${payeeName ? ` (${payeeName})` : ''}\n\n` +
    `Thank you,\n${brand}`
  const html = buildHtmlBody({ method, handle, amount, contactFirstName, jobTitle, jobRef, orgName, payeeName })
  return { subject, body, html }
}
