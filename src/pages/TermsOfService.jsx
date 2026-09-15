const card = 'mx-auto max-w-3xl px-5 py-12 sm:py-16'
const h2 = 'mt-8 font-[family-name:var(--font-display)] text-lg font-bold text-ink'
const p = 'mt-2 text-sm leading-6 text-muted'

export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className={card}>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent">Whaley Inc &middot; Ship2Shore Booking</p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-bold text-ink">Terms &amp; Conditions</h1>
        <p className="mt-2 text-sm text-muted">Last updated September 15, 2026</p>

        <p className={p}>
          These Terms &amp; Conditions govern your use of the booking and communication services offered by
          Whaley Inc, doing business as Ship2Shore Booking ("Ship2Shore," "we," "us," or "our"). By
          submitting a booking request, you agree to these terms.
        </p>

        <h2 className={h2}>Our services</h2>
        <p className={p}>
          Ship2Shore provides vehicle transport, port escort, and related logistics services. Bookings are
          scheduled based on availability, and confirmation of a requested time is not guaranteed until
          you receive a confirmation from us.
        </p>

        <h2 className={h2}>Payment</h2>
        <p className={p}>
          Pricing is provided at the time of booking or quote. Payment terms and accepted methods are
          communicated to you directly by our team.
        </p>

        <h2 className={h2}>SMS Terms</h2>
        <p className={p}>
          If you opt in to receive text messages from us — by checking the box on our booking form, or by
          replying to a message we send you — you consent to receive SMS messages related to your booking,
          including confirmations, scheduling updates, and delivery status notifications, from Whaley Inc
          / Ship2Shore Booking.
        </p>
        <p className={p}>
          Message frequency varies based on your booking activity. Message and data rates may apply. You
          can opt out of text messages at any time by replying <strong>STOP</strong> to any message. After
          you send STOP, we will send one final message confirming your removal, and you will not receive
          further texts unless you opt in again. For help at any time, reply <strong>HELP</strong> or
          contact us at info@whaleyinc.net. Carriers are not liable for delayed or undelivered messages.
        </p>

        <h2 className={h2}>Cancellations</h2>
        <p className={p}>
          If you need to cancel or reschedule a booking, contact us as soon as possible. Cancellation
          terms will be provided at the time of booking.
        </p>

        <h2 className={h2}>Limitation of liability</h2>
        <p className={p}>
          To the fullest extent permitted by law, Whaley Inc is not liable for indirect, incidental, or
          consequential damages arising from the use of our services.
        </p>

        <h2 className={h2}>Changes to these terms</h2>
        <p className={p}>
          We may update these Terms &amp; Conditions from time to time. Continued use of our services after
          changes are posted constitutes acceptance of the updated terms.
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
