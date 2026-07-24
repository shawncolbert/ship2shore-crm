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
import PublicUpload from './pages/PublicUpload'
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
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="inbox" element={<Inbox />} />
                <Route path="contacts" element={<Contacts />} />
                <Route path="contacts/:id" element={<ContactDetail />} />
                <Route path="pipeline" element={<Pipeline />} />
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
