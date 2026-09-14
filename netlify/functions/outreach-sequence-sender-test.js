// TEMP, manual-invocation-only test probe -- outreach-sequence-sender.js
// itself can't be called directly (Netlify blocks direct HTTP calls to any
// function declared with a `schedule` in netlify.toml, only its own
// scheduler can invoke it). This is the identical handler with no schedule
// entry, so it can be POSTed directly to confirm the send path actually
// works end to end. Delete this file once confirmed -- same convention as
// buffer-setup-probe.js.
export { handler } from './outreach-sequence-sender.js'
