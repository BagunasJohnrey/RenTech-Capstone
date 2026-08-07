import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Anon-key client used ONLY for the public signup endpoint. admin.createUser
// (service role) never triggers Supabase's confirmation email — only the
// public signUp flow does — so email-verified signups must go through this
// client to get the verification link sent.
export const supabaseSignUp = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);
