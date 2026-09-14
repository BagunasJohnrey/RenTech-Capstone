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

// Ops safeguard: which role does the configured service key actually carry?
// Decodes the JWT claims ONLY (never logs the secret). An anon key here
// silently degrades every service-role path — storage uploads fail RLS,
// auth.admin.* calls fail — with confusing downstream errors, so the boot
// log always prints this (see index.ts).
export function supabaseKeyRole(): string {
  try {
    const payload = JSON.parse(
      Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64').toString()
    );
    return `${payload.role ?? '?'} (ref ${payload.ref ?? '?'})`;
  } catch {
    return 'unreadable-key';
  }
}

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
