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

// Method-specific "how to pay" instructions. Kept short and literal — this is
// what goes straight into the customer's inbox.
function instructionsFor(method, handle, amount, jobRef) {
  const amt = money(amount)
  const ref = jobRef ? ` — please include "${jobRef}" in the memo/note` : ''
  switch (method) {
    case 'zelle':
      return `Please send ${amt} to ${handle} via Zelle${ref}.`
    case 'venmo':
      return `Please send ${amt} to ${handle} via Venmo${ref}.`
    case 'cashapp':
      return `Please send ${amt} to ${handle} via Cash App${ref}.`
    case 'apple_pay':
      return `Please send ${amt} to ${handle} via Apple Pay (Apple Cash)${ref}.`
    default:
      return `Please send ${amt} to ${handle}${ref}.`
  }
}

// Builds the subject/body for the payment-request email. `jobRef` is
// typically the ship billing number or job title, whichever is available.
export function buildPaymentRequestEmail({ method, handle, amount, contactFirstName, jobTitle, jobRef }) {
  const label = methodLabel(method)
  const amt = money(amount)
  const subject = `Payment request — ${amt}${jobTitle ? ` for ${jobTitle}` : ''}`
  const body =
    `Hi ${contactFirstName || 'there'},\n\n` +
    `${jobTitle ? `For your Ship2Shore job (${jobTitle}), the ` : 'The '}amount due is ${amt}.\n\n` +
    `${instructionsFor(method, handle, amount, jobRef)}\n\n` +
    `${label}: ${handle}\n\n` +
    `Thank you,\nShip2Shore Dispatch`
  return { subject, body }
}
