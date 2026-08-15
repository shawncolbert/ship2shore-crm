// Per-org feature toggles -- lets a platform admin sell/hide entire chunks
// of the CRM per client org (e.g. a customer who only paid for the core
// pipeline doesn't see Landing Pages or Social Posts). Stored as
// organizations.enabled_features, a jsonb map of key -> boolean. A missing
// key means "on" -- so an empty/default {} keeps every existing org exactly
// as it already behaves, no backfill needed.
//
// Each entry's `path` must match the route it gates in main.jsx and the
// `to` used in Layout.jsx's sidebar nav -- one feature, one nav item, one
// route, kept in lockstep on purpose so there's no way for a hidden nav
// link and a still-reachable page to drift apart.
export const FEATURES = [
  { key: 'help', label: 'Help / Getting Started', path: '/help' },
  { key: 'ai_assistant', label: 'AI Assistant', path: '/agent' },
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'digital_business_cards', label: 'Digital Business Cards', path: '/settings/card-links' },
  { key: 'inbox', label: 'Inbox', path: '/inbox' },
  { key: 'contacts', label: 'Contacts', path: '/contacts' },
  { key: 'pipeline', label: 'Pipeline', path: '/pipeline' },
  { key: 'pipeline_stages', label: 'Pipeline Stages', path: '/settings/pipeline-stages' },
  { key: 'calendar', label: 'Calendar', path: '/calendar' },
  { key: 'documents', label: 'Documents', path: '/documents' },
  { key: 'do_fix', label: 'DO / Contract Editor', path: '/do-fix' },
  { key: 'automations', label: 'Automations', path: '/automations' },
  { key: 'services', label: 'Services', path: '/services' },
  { key: 'invoices', label: 'Invoices', path: '/invoices' },
  { key: 'completed_jobs', label: 'Completed Jobs', path: '/completed-jobs' },
  { key: 'business_card_builder', label: 'Business Card Builder', path: '/settings/business-card' },
  { key: 'payments', label: 'Payments', path: '/payment-settings' },
  { key: 'appearance', label: 'Appearance', path: '/settings/appearance' },
  { key: 'custom_links', label: 'Custom Links', path: '/settings/custom-links' },
  { key: 'scheduling', label: 'Scheduling', path: '/settings/scheduling' },
  { key: 'landing_pages', label: 'Landing Pages', path: '/landing-pages' },
  { key: 'funnels', label: 'Funnels', path: '/funnels' },
  { key: 'social_posts', label: 'Social Posts', path: '/social-posts' },
]

// Missing key = enabled. Only an explicit `false` turns a feature off.
export const isFeatureEnabled = (org, key) => org?.enabled_features?.[key] !== false
