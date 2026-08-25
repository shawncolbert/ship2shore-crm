import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import FeatureGate from './components/FeatureGate'
import Layout from './components/Layout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Contacts from './pages/Contacts'
import ImportContacts from './pages/ImportContacts'
import ContactDetail from './pages/ContactDetail'
import Prospecting from './pages/Prospecting'
import LeadFinder from './pages/LeadFinder'
import Pipeline from './pages/Pipeline'
import QuickQuote from './pages/QuickQuote'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Documents from './pages/Documents'
import Automations from './pages/Automations'
import PaymentSettings from './pages/PaymentSettings'
import Appearance from './pages/Appearance'
import CustomLinks from './pages/CustomLinks'
import DocumentPresets from './pages/DocumentPresets'
import Scheduling from './pages/Scheduling'
import DispatchAssignment from './pages/DispatchAssignment'
import Services from './pages/Services'
import Invoices from './pages/Invoices'
import CompletedJobs from './pages/CompletedJobs'
import InvoiceDetail from './pages/InvoiceDetail'
import PublicInvoice from './pages/PublicInvoice'
import ContractSign from './pages/ContractSign'
import PipelineStages from './pages/PipelineStages'
import AdminOrgs from './pages/AdminOrgs'
import DeliveryOrderFix from './pages/DeliveryOrderFix'
import LandingPages from './pages/LandingPages'
import LandingPageEditor from './pages/LandingPageEditor'
import PublicUpload from './pages/PublicUpload'
import PublicBooking from './pages/PublicBooking'
import LandingPagePublic from './pages/LandingPagePublic'
import PublicBusinessCard from './pages/PublicBusinessCard'
import BusinessCardSettings from './pages/BusinessCardSettings'
import ExternalCardLinks from './pages/ExternalCardLinks'
import GoRedirect from './pages/GoRedirect'
import Calendar from './pages/Calendar'
import Funnels from './pages/Funnels'
import PublicFunnel from './pages/PublicFunnel'
import SocialPosts from './pages/SocialPosts'
import Agent from './pages/Agent'
import AiStudio from './pages/AiStudio'
import Help from './pages/Help'
import Welcome from './pages/Welcome'
import { bootstrapTheme } from './lib/theme'
import './index.css'

// Apply any cached theme before the first paint, so a returning user's
// dashboard doesn't flash light/classic for a frame while the org loads.
bootstrapTheme()

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

function App() {
  return (
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
                {/* No FeatureGate on purpose -- scoped to Ship2Shore's own org by a
                    hardcoded org-id check inside AiStudio.jsx and the backend
                    function, not the generic per-org toggle (which defaults new
                    features to "on" for every tenant). */}
                <Route path="ai-studio" element={<AiStudio />} />
                <Route path="admin/orgs" element={<AdminOrgs />} />
              </Routes>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
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
