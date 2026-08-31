import React, { Suspense, lazy } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import FeatureGate from './components/FeatureGate'
import Layout from './components/Layout'

// Core dispatch loop (Login -> Dashboard -> Pipeline -> Contacts -> Inbox ->
// Calendar) stays a normal, eager import -- these are the screens loaded on
// every single session, dispatcher or customer-facing, often on a phone on
// cellular. Everything else (settings, marketing tools, admin, and every
// public single-purpose page a customer/driver only ever hits once) is
// React.lazy() below so the initial bundle doesn't carry code nobody on
// that screen needs yet. Per the 2026-08-30 audit: this app shipped one
// ~1.1MB JS file to every device regardless of which page it landed on.
import Login from './pages/Login'
import Welcome from './pages/Welcome'
import Dashboard from './pages/Dashboard'
import Pipeline from './pages/Pipeline'
import Contacts from './pages/Contacts'
import ContactDetail from './pages/ContactDetail'
import Inbox from './pages/Inbox'
import Calendar from './pages/Calendar'
import QuickQuote from './pages/QuickQuote'

const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const ImportContacts = lazy(() => import('./pages/ImportContacts'))
const Prospecting = lazy(() => import('./pages/Prospecting'))
const LeadFinder = lazy(() => import('./pages/LeadFinder'))
const Documents = lazy(() => import('./pages/Documents'))
const Automations = lazy(() => import('./pages/Automations'))
const PaymentSettings = lazy(() => import('./pages/PaymentSettings'))
const Appearance = lazy(() => import('./pages/Appearance'))
const CustomLinks = lazy(() => import('./pages/CustomLinks'))
const DocumentPresets = lazy(() => import('./pages/DocumentPresets'))
const Scheduling = lazy(() => import('./pages/Scheduling'))
const DispatchAssignment = lazy(() => import('./pages/DispatchAssignment'))
const PricingSettings = lazy(() => import('./pages/PricingSettings'))
const Services = lazy(() => import('./pages/Services'))
const Invoices = lazy(() => import('./pages/Invoices'))
const CompletedJobs = lazy(() => import('./pages/CompletedJobs'))
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'))
const PublicInvoice = lazy(() => import('./pages/PublicInvoice'))
const ContractSign = lazy(() => import('./pages/ContractSign'))
const PipelineStages = lazy(() => import('./pages/PipelineStages'))
const AdminOrgs = lazy(() => import('./pages/AdminOrgs'))
const DeliveryOrderFix = lazy(() => import('./pages/DeliveryOrderFix'))
const LandingPages = lazy(() => import('./pages/LandingPages'))
const LandingPageEditor = lazy(() => import('./pages/LandingPageEditor'))
const PublicUpload = lazy(() => import('./pages/PublicUpload'))
const PublicBooking = lazy(() => import('./pages/PublicBooking'))
const LandingPagePublic = lazy(() => import('./pages/LandingPagePublic'))
const PublicBusinessCard = lazy(() => import('./pages/PublicBusinessCard'))
const DriverTracking = lazy(() => import('./pages/DriverTracking'))
const CarrierQuotePublic = lazy(() => import('./pages/CarrierQuotePublic'))
const BusinessCardSettings = lazy(() => import('./pages/BusinessCardSettings'))
const ExternalCardLinks = lazy(() => import('./pages/ExternalCardLinks'))
const GoRedirect = lazy(() => import('./pages/GoRedirect'))
const Funnels = lazy(() => import('./pages/Funnels'))
const PublicFunnel = lazy(() => import('./pages/PublicFunnel'))
const SocialPosts = lazy(() => import('./pages/SocialPosts'))
const Agent = lazy(() => import('./pages/Agent'))
const AiStudio = lazy(() => import('./pages/AiStudio'))
const Help = lazy(() => import('./pages/Help'))

import { bootstrapTheme } from './lib/theme'
import './index.css'

// Apply any cached theme before the first paint, so a returning user's
// dashboard doesn't flash light/classic for a frame while the org loads.
bootstrapTheme()

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

// Bare, theme-agnostic -- shown for well under a second on a warm cache, so
// it deliberately doesn't try to match Layout's sidebar/branding.
function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas">
      <p className="text-sm text-muted">Loading…</p>
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<RouteLoading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Public customer upload link — no auth gate */}
        <Route path="/u/:token" element={<PublicUpload />} />
        {/* Public native booking widget — no auth gate, additive to Calendly.
            /book keeps working with no slug (defaults to the original org);
            /book/:orgSlug is the per-org link white-label orgs get. */}
        <Route path="/book" element={<PublicBooking />} />
        <Route path="/book/:orgSlug" element={<PublicBooking />} />
        {/* Public landing pages — no auth gate */}
        <Route path="/pages/:slug" element={<LandingPagePublic />} />
        {/* Public digital business card — no auth gate */}
        <Route path="/card/:slug" element={<PublicBusinessCard />} />
        {/* Trackable link to an externally-hosted digital business card — no auth gate */}
        <Route path="/go/:slug" element={<GoRedirect />} />
        {/* Public driver tracking page — no auth gate, the link texted to a
            driver from Pipeline's "Text route" / "Text to another driver" */}
        <Route path="/track/:token" element={<DriverTracking />} />
        <Route path="/carrier-quote/:token" element={<CarrierQuotePublic />} />
        {/* Public funnels — no auth gate */}
        <Route path="/funnel/:slug" element={<PublicFunnel />} />
        {/* Public invoice page — no auth gate, this is the link a customer gets emailed */}
        <Route path="/invoice/:id" element={<PublicInvoice />} />
        {/* Public booking agreement page — no auth gate, the link sent by
            "Send contract" on a pipeline card */}
        <Route path="/contract/:id" element={<ContractSign />} />
        {/* Branded front door -- your own company name/logo, "Enter CRM" takes
            you to the Dashboard. Shown every time you land here, including
            right after signing in (see Login.jsx's post-auth redirect).
            Deliberately outside Layout -- no sidebar on this one screen. */}
        <Route path="/" element={<ProtectedRoute><Welcome /></ProtectedRoute>} />
        {/* One-tap Home Screen shortcut target -- a dedicated full-screen quote
            form, not a modal on top of another page. Signing in from here
            (see ProtectedRoute/Login's redirect-preservation) lands back on
            this exact URL, not the dashboard. */}
        <Route path="/quick-quote" element={<ProtectedRoute><QuickQuote /></ProtectedRoute>} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<FeatureGate featureKey="dashboard"><Dashboard /></FeatureGate>} />
                  <Route path="help" element={<FeatureGate featureKey="help"><Help /></FeatureGate>} />
                  <Route path="inbox" element={<FeatureGate featureKey="inbox"><Inbox /></FeatureGate>} />
                  <Route path="contacts" element={<FeatureGate featureKey="contacts"><Contacts /></FeatureGate>} />
                  <Route path="contacts/import" element={<FeatureGate featureKey="contacts"><ImportContacts /></FeatureGate>} />
                  <Route path="contacts/:id" element={<FeatureGate featureKey="contacts"><ContactDetail /></FeatureGate>} />
                  <Route path="prospecting" element={<FeatureGate featureKey="prospecting"><Prospecting /></FeatureGate>} />
                  <Route path="lead-finder" element={<FeatureGate featureKey="lead_finder"><LeadFinder /></FeatureGate>} />
                  <Route path="pipeline" element={<FeatureGate featureKey="pipeline"><Pipeline /></FeatureGate>} />
                  <Route path="calendar" element={<FeatureGate featureKey="calendar"><Calendar /></FeatureGate>} />
                  <Route path="documents" element={<FeatureGate featureKey="documents"><Documents /></FeatureGate>} />
                  <Route path="do-fix" element={<FeatureGate featureKey="do_fix"><DeliveryOrderFix /></FeatureGate>} />
                  <Route path="automations" element={<FeatureGate featureKey="automations"><Automations /></FeatureGate>} />
                  <Route path="payment-settings" element={<FeatureGate featureKey="payments"><PaymentSettings /></FeatureGate>} />
                  <Route path="settings/appearance" element={<FeatureGate featureKey="appearance"><Appearance /></FeatureGate>} />
                  <Route path="settings/custom-links" element={<FeatureGate featureKey="custom_links"><CustomLinks /></FeatureGate>} />
                  <Route path="settings/document-requests" element={<FeatureGate featureKey="document_requests"><DocumentPresets /></FeatureGate>} />
                  <Route path="settings/scheduling" element={<FeatureGate featureKey="scheduling"><Scheduling /></FeatureGate>} />
                  <Route path="settings/dispatch-assignment" element={<FeatureGate featureKey="dispatch_assignment"><DispatchAssignment /></FeatureGate>} />
                  <Route path="settings/pricing" element={<FeatureGate featureKey="pricing_settings"><PricingSettings /></FeatureGate>} />
                  <Route path="services" element={<FeatureGate featureKey="services"><Services /></FeatureGate>} />
                  <Route path="invoices" element={<FeatureGate featureKey="invoices"><Invoices /></FeatureGate>} />
                  <Route path="invoices/new" element={<FeatureGate featureKey="invoices"><InvoiceDetail /></FeatureGate>} />
                  <Route path="invoices/:id" element={<FeatureGate featureKey="invoices"><InvoiceDetail /></FeatureGate>} />
                  <Route path="completed-jobs" element={<FeatureGate featureKey="completed_jobs"><CompletedJobs /></FeatureGate>} />
                  <Route path="settings/pipeline-stages" element={<FeatureGate featureKey="pipeline_stages"><PipelineStages /></FeatureGate>} />
                  <Route path="settings/business-card" element={<FeatureGate featureKey="business_card_builder"><BusinessCardSettings /></FeatureGate>} />
                  <Route path="settings/card-links" element={<FeatureGate featureKey="digital_business_cards"><ExternalCardLinks /></FeatureGate>} />
                  <Route path="landing-pages" element={<FeatureGate featureKey="landing_pages"><LandingPages /></FeatureGate>} />
                  <Route path="landing-pages/:id" element={<FeatureGate featureKey="landing_pages"><LandingPageEditor /></FeatureGate>} />
                  <Route path="funnels" element={<FeatureGate featureKey="funnels"><Funnels /></FeatureGate>} />
                  <Route path="social-posts" element={<FeatureGate featureKey="social_posts"><SocialPosts /></FeatureGate>} />
                  <Route path="agent" element={<FeatureGate featureKey="ai_assistant"><Agent /></FeatureGate>} />
                  {/* No FeatureGate on purpose -- gated by profiles.platform_admin
                      inside AiStudio.jsx and the backend functions instead, not
                      the generic per-org toggle (which defaults new features to
                      "on" for every tenant). This is a cross-org admin tool, not
                      something any client org's own users get. */}
                  <Route path="ai-studio" element={<AiStudio />} />
                  <Route path="admin/orgs" element={<AdminOrgs />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </Suspense>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
