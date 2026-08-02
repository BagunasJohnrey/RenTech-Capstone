import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Browser client used ONLY to silently refresh expired sessions. We disable
// its own persistence/auto-refresh to keep a single source of truth in
// localStorage (managed by authSession.js).
export const supabaseClient = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
