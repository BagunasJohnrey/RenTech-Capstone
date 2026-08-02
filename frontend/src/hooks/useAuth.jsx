import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, setTokenGetter } from '../utils/api';
import { getAccessToken, setSession } from '../utils/authSession';
import { supabaseClient } from '../utils/supabaseClient';

const AuthContext = createContext(null);

setTokenGetter(getAccessToken);

export function AuthProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setProfile(null);
      setLoading(false);
      return;
    }
    try {
      const prof = await api.get('/auth/me');
      setProfile(prof);
    } catch {
      setSession(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const login = useCallback(async (email, password) => {
    const result = await api.post('/auth/login', { email, password });
    setSession(result.session);
    setProfile(result.user);
    return result.user;
  }, []);

  const signup = useCallback(async ({ email, password, name, phone, address, preferences } = {}) => {
    const result = await api.post('/auth/signup', { email, password, name, phone, address, preferences });
    setSession(result.session);
    setProfile(result.user);
    return result.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    setSession(null);
    setProfile(null);
  }, []);

  // Completes the Supabase OAuth (Google) redirect handshake. If the linked
  // profile already exists we log in; otherwise the backend returns
  // { needsDetails: true } and we pass the collected details on the next call
  // to create the account. The session is only persisted once a profile exists.
  const completeOAuth = useCallback(async (details) => {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data.session) {
      throw new Error('OAuth session not found');
    }
    const result = await api.post('/auth/oauth', {
      accessToken: data.session.access_token,
      details,
    });
    if (result.needsDetails) return result;
    setSession(data.session);
    setProfile(result.user);
    return result.user;
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
