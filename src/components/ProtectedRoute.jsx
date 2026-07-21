// Auth requirement removed — this CRM is for personal use only and loads
// straight into the dashboard with no login gate. Kept as a pass-through
// wrapper so the route structure in main.jsx stays untouched.
export default function ProtectedRoute({ children }) {
  return children
}
