const card = 'mx-auto max-w-3xl px-5 py-12 sm:py-16'
const h2 = 'mt-8 font-[family-name:var(--font-display)] text-lg font-bold text-ink'
const p = 'mt-2 text-sm leading-6 text-muted'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className={card}>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Whaley Inc &middot; Ship2Shore Booking</p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted">Last updated September 15, 2026</p>

        <p className={p}>
          This Privacy Policy explains how Whaley Inc, doing business as Ship2Shore Booking ("Ship2Shore,"
          "we," "us," or "our"), collects, uses, and protects the personal information of customers who use
          our vehicle transport and port escort booking services.
        </p>

        <h2 className={h2}>Information we collect</h2>
        <p className={p}>
          When you request a quote or book a service through our website, we collect the information you
          provide directly, including your name, email address, phone number, pickup and drop-off
          addresses, and any notes about your shipment. If you contact us by phone, email, or text, we
          keep a record of that communication to service your booking.
        </p>

        <h2 className={h2}>How we use your information</h2>
        <p className={p}>
          We use your information to schedule and dispatch your booking, communicate with you about your
          service (including confirmations, scheduling updates, and delivery status), process payment,
          and provide customer support. We do not use your information for any purpose unrelated to
          fulfilling your booking without your consent.
        </p>

        <h2 className={h2}>SMS / text messaging</h2>
        <p className={p}>
          If you check the box to receive text updates about your booking, we will send you SMS messages
          related to that booking — such as confirmations, scheduling changes, and delivery status
          notifications — using the mobile number you provide. Message frequency varies by booking.
          Message and data rates may apply. You may opt out at any time by replying STOP, and you can
          reply HELP for assistance. We do not sell or share your SMS opt-in data with third parties for
          marketing purposes.
        </p>

        <h2 className={h2}>How we share your information</h2>
        <p className={p}>
          We share your booking details only with the driver or carrier assigned to your job, and with
          service providers who help us operate our business (such as payment processors and our
          scheduling/communications platform). We do not sell your personal information to third parties.
        </p>

        <h2 className={h2}>Data retention</h2>
        <p className={p}>
          We retain booking and communication records for as long as needed to provide our services,
          meet legal and accounting obligations, and resolve disputes.
        </p>

        <h2 className={h2}>Your choices</h2>
        <p className={p}>
          You can opt out of text messages at any time by replying STOP to any message from us. You may
          request access to, correction of, or deletion of your personal information by contacting us
          using the information below.
        </p>

        <h2 className={h2}>Contact us</h2>
        <p className={p}>
          Whaley Inc &middot; Ship2Shore Booking<br />
          444 W Ocean Blvd Ste 800, Long Beach, CA 90802<br />
          info@whaleyinc.net
        </p>
      </div>
    </div>
  )
}
