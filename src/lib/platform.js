// The one place a pre-auth screen (Login, Reset Password) can show a name
// before we know which org the visitor belongs to -- every org shares the
// same sign-in URL today, so this can never be a tenant's own branding
// (that would show a random client's name on everyone else's login screen).
// Once a tenant's own domain routes here, this can be resolved per-domain
// instead -- rename this one constant when you land on what to call the
// product itself.
export const PLATFORM_NAME = 'Dispatch CRM'
