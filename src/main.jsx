import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Contacts from './pages/Contacts'
import ContactDetail from './pages/ContactDetail'
import Pipeline from './pages/Pipeline'
import Dashboard from './pages/Dashboard'
import Inbox from './pages/Inbox'
import Documents from './pages/Documents'
import Automations from './pages/Automations'
import PaymentSettings from './pages/PaymentSettings'
import Services from './pages/Services'
import AdminOrgs from './pages/AdminOrgs'
import DeliveryOrderFix from './pages/DeliveryOrderFix'
import LandingPages from './pages/LandingPages'
import LandingPageEditor from './pages/LandingPageEditor'
import PublicUpload from './pages/PublicUpload'
import PublicBooking from './pages/PublicBooking'
import LandingPagePublic from './pages/LandingPagePublic'
import PublicBusinessCard from './pages/PublicBusinessCard'
import BusinessCardSettings from './pages/BusinessCardSettings'
import Calendar from './pages/Calendar'
import Funnels from './pages/Funnels'
import PublicFunnel from './pages/PublicFunnel'
import SocialPosts from './pages/SocialPosts'
import Agent from './pages/Agent'
import Help from './pages/Help'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
})

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
      {/* Public funnels — no auth gate */}
      <Route path="/funnel/:slug" element={<PublicFunnel />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="help" element={<Help />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="contacts" element={<Contacts />} />
                <Route path="contacts/:id" element={<ContactDetail />} />
                <Route path="pipeline" element={<Pipeline />} />
                <Route path="calendar" element={<Calendar />} />
                <Route path="documents" element={<Documents />} />
                <Route path="do-fix" element={<DeliveryOrderFix />} />
                <Route path="automations" element={<Automations />} />
                <Route path="payment-settings" element={<PaymentSettings />} />
                <Route path="services" element={<Services />} />
                <Route path="settings/business-card" element={<BusinessCardSettings />} />
                <Route path="landing-pages" element={<LandingPages />} />
                <Route path="landing-pages/:id" element={<LandingPageEditor />} />
                <Route path="funnels" element={<Funnels />} />
                <Route path="social-posts" element={<SocialPosts />} />
                <Route path="agent" element={<Agent />} />
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
