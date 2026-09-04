// The name a pre-auth screen (Login, Reset Password) shows before we know
// which org the visitor belongs to. 2026-09-04: each client now gets their
// own Netlify site + build (VITE_APP_NAME, set in Netlify -> Site settings
// -> Environment -- see vite.config.js and README -> "Setting up a new
// client's own site"), so that whole site only ever serves one org and it's
// safe to show its real name here. Unset -- today's shared Ship2Shore site,
// and local dev -- falls back to a neutral name rather than hardcoding
// "Ship2Shore" for every visitor regardless of which org's build this is.
export const PLATFORM_NAME = import.meta.env.VITE_APP_NAME || 'Dispatch CRM'
