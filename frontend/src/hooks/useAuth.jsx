import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';
import { setAuthed, clearImageCache } from '../utils/authSession';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    // Cookies are sent automatically (credentials: 'include' in api.js).
    // If the session is expired and the refresh cookie is valid, the 401
    // retry in api.js refreshes first and then retries /auth/me.
    try {
      const prof = await api.get('/auth/me');
      setProfile(prof);
      setAuthed(true);
    } catch {
      // Either no cookies, or refresh also failed → logged out.
      setProfile(null);
      setAuthed(false);
      clearImageCache();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  // Multi-tab sync: when another tab logs in/out, mirror that here so all
  // tabs converge on the same auth state. We use the rentech_authed flag
  // (NOT a token — tokens are httpOnly cookies) as the broadcast channel.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'rentech_authed') return;
      if (e.newValue === null) {
        // Logged out in another tab.
        setProfile(null);
      } else {
        // Logged in elsewhere — re-fetch profile (cookies are already shared).
        fetchProfile();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [fetchProfile]);

  const login = useCallback(async (email, password) => {
    const result = await api.post('/auth/login', { email, password });
    // W2.7: MFA challenge tokens are stored in a short-lived httpOnly cookie
    // (rt_mfa_pending); the verifyMfa call only needs the 6-digit code.
    if (result.requiresMfa) {
      return { requiresMfa: true, email: result.user.email };
    }
    // Normal login — cookies are set by the backend (Set-Cookie headers).
    setProfile(result.user);
    setAuthed(true);
    return result.user;
  }, []);

  // W2.7: Complete MFA challenge during login. The backend reads the pending
  // cookie for the access/refresh tokens; we only send the 6-digit code.
  // trustDevice: opt in to the 30-day rt_mfa_trusted cookie (skip the prompt
  // on this browser for the next 30 days).
  const verifyMfa = useCallback(async ({ code, trustDevice = false } = {}) => {
    const result = await api.post('/auth/login/mfa', { code, trustDevice });
    // Re-fetch profile to ensure we have the latest state (incl. role, MFA status).
    await fetchProfile();
    setAuthed(true);
    return profile;
  }, [fetchProfile, profile]);

  const signup = useCallback(async ({ email, password, name, phone, address, preferences } = {}) => {
    const result = await api.post('/auth/signup', { email, password, name, phone, address, preferences });
    setProfile(result.user);
    setAuthed(true);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    // Cookies are cleared by the backend; flag + profile cleared here.
    setProfile(null);
    setAuthed(false);
    clearImageCache();
  }, []);

  // Phase 3: Complete the server-side OAuth flow by submitting the profile
  // details. The access token is already in the rt_access cookie (set during
  // the OAuth callback), so we just POST the form data and the backend handles
  // the rest. No client-side token needed.
  const completeOAuth = useCallback(async (details) => {
    const result = await api.post('/auth/oauth/details', details);
    setAuthed(true);
    setProfile(result.user);
    return result.user;
  }, []);

  // Phase 3: Cancel an in-progress OAuth sign-up. Reads the access token
  // from the cookie on the backend side.
  const cancelOAuth = useCallback(async () => {
    await api.post('/auth/oauth/cancel');
    setAuthed(false);
    clearImageCache();
  }, []);

  const updateProfile = useCallback(async (data) => {
    const updated = await api.put('/auth/me', data);
    setProfile(updated);
    return updated;
  }, []);

  const value = {
    profile,
    loading,
    isLoggedIn: !!profile,
    role: profile?.role || null,
    login,
    signup,
    logout,
    updateProfile,
    fetchProfile,
     completeOAuth,
     cancelOAuth,
     verifyMfa,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
