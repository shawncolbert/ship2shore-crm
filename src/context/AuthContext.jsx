import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Personal-use auto-login. This CRM has no login screen — instead of asking
// for a magic link, the app signs itself in with one fixed account so it
// loads straight into the dashboard. Credentials come from Netlify env vars
// (never committed) and are only present in the built client bundle, so treat
// this as a convenience, not a strong access barrier.
const AUTO_EMAIL = import.meta.env.VITE_AUTO_LOGIN_EMAIL
const AUTO_PASSWORD = import.meta.env.VITE_AUTO_LOGIN_PASSWORD

const AuthContext = createContext({ session: null, loading: true })

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    async function bootstrap() {
      const { data } = await supabase.auth.getSession()
      let current = data.session

      // Nobody signed in yet — silently sign in with the personal account so
      // the dashboard's data queries run authenticated (RLS stays enforced).
      if (!current && AUTO_EMAIL && AUTO_PASSWORD) {
        const { data: signInData, error } = await supabase.auth.signInWithPassword({
          email: AUTO_EMAIL,
          password: AUTO_PASSWORD,
        })
        if (error) console.error('Auto-login failed:', error.message)
        current = signInData?.session ?? null
      }

      if (active) {
        setSession(current)
        setLoading(false)
      }
    }

    bootstrap()

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
