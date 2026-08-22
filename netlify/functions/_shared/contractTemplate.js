// Standard vehicle-transport service agreement, rendered to plain text with
// blank-line paragraph breaks (the frontend renders it with
// white-space:pre-line, same convention as address fields elsewhere in this
// app). This is a general-purpose template covering the terms any auto
// transport booking needs -- it is NOT a substitute for review by a lawyer
// licensed in the org's state before relying on it for real customers.
//
// Every render is a point-in-time snapshot: the caller stores the returned
// string on contracts.body and never re-renders it later, so a price edit or
// template change afterward can't silently alter what a customer already
// agreed to.

const money = (n) => `$${Number(n || 0).toFixed(2)}`
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'To be scheduled'

export function renderContract({
  orgName, customerName, vehicleDescription, vehicleVin,
  pickupAddress, dropoffAddress, scheduledAt, port,
  totalPrice, depositAmount, bookingNumber,
}) {
  const balance = Math.max(0, Number(totalPrice || 0) - Number(depositAmount || 0))
  const portLine = port ? `\nPort: ${port}` : ''
  const vinLine = vehicleVin ? ` (VIN ${vehicleVin})` : ''

  return `VEHICLE TRANSPORT SERVICE AGREEMENT

This agreement is between ${orgName} ("Carrier") and ${customerName || 'the customer'} ("Customer") for the transport of the vehicle described below. By typing your name and checking the agreement box on this page, you confirm you have read and agree to these terms and authorize Carrier to proceed with booking this shipment.

Booking Reference: ${bookingNumber || 'Pending'}

1. VEHICLE AND SHIPMENT DETAILS
Vehicle: ${vehicleDescription || 'As described at booking'}${vinLine}
Pickup location: ${pickupAddress || 'To be confirmed'}
Delivery location: ${dropoffAddress || 'To be confirmed'}
Requested pickup date: ${fmtDate(scheduledAt)}${portLine}

2. PRICE AND PAYMENT TERMS
Total transport price: ${money(totalPrice)}
Deposit due to secure this booking: ${money(depositAmount)}
Balance due at delivery: ${money(balance)}
The deposit is due upon signing this agreement and secures your position on the schedule. The remaining balance is due at the time of delivery, payable by the method(s) provided on your invoice. Deposits are non-refundable once a carrier has been dispatched or assigned to this shipment, except where cancellation is due to Carrier's failure to perform.

3. SCHEDULING
Pickup and delivery dates are estimates based on carrier availability, weather, road conditions, and other factors outside Carrier's control. Carrier will make commercially reasonable efforts to meet the requested dates but does not guarantee exact pickup or delivery times.

4. VEHICLE CONDITION AND INSPECTION
The vehicle will be inspected and its condition documented (via photos and/or a written inspection report) at both pickup and delivery. Customer or Customer's authorized representative should be present at pickup and delivery to review this documentation. Any damage claim must be noted on the delivery paperwork at the time of delivery; claims reported afterward may be more difficult to substantiate.

5. CANCELLATION
Customer may cancel this booking prior to a carrier being dispatched for a full refund of the deposit. Once a carrier has been assigned or dispatched, the deposit becomes non-refundable, as it compensates Carrier for securing transport capacity on Customer's behalf.

6. CARRIER RESPONSIBILITY AND INSURANCE
Vehicles are transported under the assigned carrier's cargo insurance policy in accordance with applicable federal and state motor carrier regulations. Carrier is not an insurer of the vehicle and is not responsible for mechanical failures, pre-existing conditions, or items left inside the vehicle during transport.

7. LIMITATION OF LIABILITY
Except for direct damage to the vehicle caused by the carrier's negligence during transport (as documented per Section 4), Carrier's liability under this agreement is limited to the total transport price stated above. Carrier is not liable for indirect, incidental, or consequential damages, including loss of use.

8. ENTIRE AGREEMENT
This agreement, together with the associated invoice, represents the entire understanding between the parties regarding this shipment and supersedes any prior verbal or written quotes for this booking.

By signing below, Customer acknowledges reading and agreeing to all terms above.`
}
