// Resolves which payment options should actually appear on a given invoice,
// combining a per-invoice Wave Checkout URL (pasted in manually -- Wave has
// no API to mint one per invoice) and the org's own Zelle/Venmo/Cash App/
// Apple Pay handles from payment_settings. `invoice.payment_options` (jsonb:
// { wave, zelle, venmo, cashapp, apple_pay } -- stripe retired 2026-09-01,
// never actually turned on for anyone) records which of these a dispatcher
// actually checked for *this* invoice -- an option only shows up if it's
// both checked AND actually configured (a handle on file, or a URL pasted in).
const money = (n) => `$${Number(n || 0).toFixed(2)}`

function venmoLink(handle, amount) {
  const clean = String(handle || '').replace(/^@/, '').trim()
  return `https://venmo.com/u/${encodeURIComponent(clean)}?amount=${encodeURIComponent(Number(amount) || 0)}`
}
function cashAppLink(handle, amount) {
  const clean = String(handle || '').replace(/^\$/, '').trim()
  return `https://cash.app/$${encodeURIComponent(clean)}/${encodeURIComponent(Number(amount) || 0)}`
}

const HANDLE_METHODS = [
  { key: 'zelle', field: 'zelle_handle', label: 'Zelle', asLink: false },
  { key: 'venmo', field: 'venmo_handle', label: 'Venmo', asLink: true },
  { key: 'cashapp', field: 'cashapp_handle', label: 'Cash App', asLink: true },
  { key: 'apple_pay', field: 'apple_pay_handle', label: 'Apple Pay', asLink: false },
]

// Returns [{ method, label, kind: 'link'|'handle', url?, handle? }], in a
// fixed, sensible display order (Wave first since it's one-tap, then the
// handle-style methods).
export function resolveInvoicePaymentOptions({ invoice, paymentSettings }) {
  const opts = invoice.payment_options || {}
  const amount = invoice.amount_due ?? invoice.total
  const list = []

  if (opts.wave && invoice.wave_checkout_url) {
    list.push({ method: 'wave', label: 'Wave Checkout', kind: 'link', url: invoice.wave_checkout_url })
  }
  for (const m of HANDLE_METHODS) {
    const handle = paymentSettings?.[m.field]
    if (!opts[m.key] || !handle) continue
    if (m.asLink) {
      const url = m.key === 'venmo' ? venmoLink(handle, amount) : cashAppLink(handle, amount)
      list.push({ method: m.key, label: m.label, kind: 'link', url })
    } else {
      list.push({ method: m.key, label: m.label, kind: 'handle', handle })
    }
  }
  return list
}

// Plain-HTML block for the invoice-sent email (not React) -- inline-styled
// so it renders consistently in Gmail/Outlook/Apple Mail.
export function buildInvoicePaymentOptionsHtml(paymentOptions, amount) {
  if (!paymentOptions.length) return ''

  const buttons = paymentOptions
    .filter((o) => o.kind === 'link')
    .map((o) => `
      <a href="${o.url}" style="display:inline-block;margin:4px 6px 4px 0;background:#059669;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px;">
        Pay ${money(amount)} with ${o.label}
      </a>`)
    .join('')

  const handles = paymentOptions
    .filter((o) => o.kind === 'handle')
    .map((o) => `<li style="margin:2px 0;"><strong>${o.label}:</strong> ${o.handle}</li>`)
    .join('')

  return `
    ${buttons ? `<p style="margin:20px 0 4px;">${buttons}</p>` : ''}
    ${handles ? `<p style="margin:12px 0 0;font-size:14px;color:#374151;">Or send it yourself:</p><ul style="margin:4px 0 0;padding-left:18px;font-size:14px;color:#374151;">${handles}</ul>` : ''}
  `
}
