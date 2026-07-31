# Manual payment requests (Zelle / Venmo / Cash App / Apple Pay)

One-click (or fully automatic on a stage move) payment requests for the four
handle-based apps that don't have a public API — Zelle, Venmo, Cash App, and
Apple Pay. **None of these platforms can tell any system when the money
actually lands**, so the one thing that stays manual no matter what is
confirming payment and moving the card to **Paid** yourself.

## Set up your handles (one time)

Sidebar → **Payments** → enter your Zelle phone/email, Venmo username, Cash
App $cashtag, and Apple Pay phone/email. Optionally pick a **default
method** — used by the stage-move automation (below) when a job hasn't had a
method requested yet.

## Sending a request from a job card

Every pipeline card has a **$** button (next to the 💵 Wave invoice button).
Click it, pick Zelle / Venmo / Cash App / Apple Pay from the dropdown — it
sends **immediately**, no draft or confirmation step. Options for methods
you haven't set a handle for are greyed out.

What happens on click:
1. Builds a message with the amount due (the job's `value`), the method's
   instructions, and your handle for it.
2. Emails it to the contact via the existing `send-email` function (Gmail).
3. Stamps `payment_requested_at` (now) and `payment_method_requested` (the
   method) on the opportunity — shown as a small badge on the card.

**Text messages**: the request is email-only for now. SMS isn't live yet
(A2P registration pending); once it is, the same message-building logic in
`src/lib/paymentRequest.js` gets a second send path — no redesign needed.

## Optional: auto-send on a stage move

In **Automations**, add a rule with action **Send payment request** — e.g.
"Any stage → Completed → Send payment request." Like every automation rule,
it's **off by default until you add and enable it** — nothing fires
automatically unless you explicitly turn it on.

When it fires, it uses:
1. Whichever method was **last requested** on that job (if you'd already
   clicked $ → a method manually), otherwise
2. Your **default method** from Payment Settings.

If neither is set (no prior request and no default), the rule is skipped for
that job — logged, not treated as an error — rather than guessing a method
or failing loudly.

## Where things live

- `payment_settings` table — your handles + default method (migration `0007`).
- `opportunities.payment_requested_at` / `payment_method_requested` — set on every send, manual or automatic.
- `src/pages/PaymentSettings.jsx` — the settings page.
- `src/lib/paymentRequest.js` — shared method metadata + email template (also mirrored server-side in `stage-change-webhook` for the automation path, since a stage move happens server-side and can't call the browser-only `send-email` flow the card button uses).
- `src/pages/Pipeline.jsx` — the $ button + dropdown on each card.
