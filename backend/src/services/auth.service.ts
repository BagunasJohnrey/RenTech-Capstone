import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { env } from '../config/env.js';
import type { Role } from '@prisma/client';
import * as crypto from 'crypto';

export async function signupCustomer(data: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  address?: string;
  preferences?: string[];
}) {
  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: env.AUTH_EMAIL_CONFIRM,
  });

  if (error || !authData.user) {
    // C2: never echo the Supabase error — it reveals whether the email is
    // already registered (account enumeration). Log the real reason instead.
    console.error('[auth] signup failed:', error?.message ?? 'no user returned');
    throw new AppError(400, 'Unable to create account. Please try again.');
  }

  const profile = await prisma.profile.create({
    data: {
      userId: authData.user.id,
      email: data.email,
      role: 'Customer',
      name: data.name,
      phone: data.phone ?? null,
      address: data.address ?? null,
      preferences: Array.isArray(data.preferences) && data.preferences.length
        ? data.preferences.join(',')
        : null,
    },
  });

  const { data: sessionData } = await supabaseAdmin.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });

  return {
    session: {
      access_token: sessionData.session?.access_token ?? null,
      refresh_token: sessionData.session?.refresh_token ?? null,
      token_type: sessionData.session?.token_type ?? 'bearer',
      expires_in: sessionData.session?.expires_in ?? null,
    },
    user: profile,
    requiresMfa: false,
  };
}

export async function loginUser(email: string, password: string, trustedDevice = false) {
  // L3: uniform error for both "no account" and "wrong password" so the API
  // can't be used to enumerate registered emails. The sign-up CTA on the
  // login screen serves as the generic fallback for new users.
  const existing = await prisma.profile.findUnique({ where: { email } });
  if (!existing) {
    throw new AppError(401, 'Invalid email or password');
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new AppError(401, 'Invalid email or password');
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: data.user.id },
  });

  if (!profile) {
    throw new AppError(401, 'Profile not found');
  }

  // Phase 5: If MFA is enabled for this user, don't establish the session yet —
  // return the access_token as a challenge token so the frontend can prompt
  // for the TOTP code. Trusted devices (rt_mfa_trusted cookie verified by the
  // controller for this email) skip the prompt — this browser already proved
  // the second factor within the last 30 days.
  if (profile.mfaEnabled && profile.role === 'Admin' && !trustedDevice) {
    return {
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        token_type: data.session.token_type,
        expires_in: data.session.expires_in,
      },
      user: profile,
      requiresMfa: true,
    };
  }

  return {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
    },
    user: profile,
    requiresMfa: false,
  };
}

export async function oauthGetOrCreateProfile(
  accessToken: string,
  details?: { name?: string; phone?: string; address?: string; preferences?: string[] }
) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new AppError(401, 'Invalid OAuth token');
  }

  const email = user.email;
  if (!email) {
    throw new AppError(400, 'OAuth account has no email address');
  }

  // A profile may already exist (e.g., auto-created by a Supabase trigger or a
  // previous abandoned OAuth). Only treat it as "complete" if it has the
  // required fields; otherwise keep asking for details instead of logging in.
  const existing = await prisma.profile.findUnique({ where: { userId: user.id } });
  const isComplete = !!(existing && existing.name && existing.phone && existing.address);
  if (existing && isComplete) {
    return { user: existing, needsDetails: false };
  }

  // Email may already belong to a different account created via email/password.
  const existingByEmail = await prisma.profile.findUnique({ where: { email } });
  if (existingByEmail && existingByEmail.userId !== user.id) {
    throw new AppError(409, 'An account with this email already exists. Please sign in with your email and password.');
  }

  // No complete profile yet: if the client supplied the required details,
  // create (or finish) the account; otherwise ask for them before completing.
  const hasDetails = !!(details && details.name && details.phone && details.address);
  if (!hasDetails) {
    return { needsDetails: true, email };
  }

  const profileData = {
    userId: user.id,
    email,
    role: 'Customer' as Role,
    name: details!.name!,
    phone: details!.phone,
    address: details!.address,
    preferences:
      Array.isArray(details!.preferences) && details!.preferences.length
        ? details!.preferences.join(',')
        : null,
  };

  // Update an incomplete existing profile, otherwise create a new one.
  const profile = existing
    ? await prisma.profile.update({ where: { userId: user.id }, data: profileData })
    : await prisma.profile.create({ data: profileData });

  return { user: profile, needsDetails: false };
}

// Best-effort cleanup when a user abandons the Google sign-up (cancel). Removes
// any profile row and the Supabase auth user created during this OAuth session
// so no orphan account is left behind.
export async function oauthCancel(accessToken: string) {
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);
    if (error || !user) return;
    await prisma.profile.deleteMany({ where: { userId: user.id } });
    await supabaseAdmin.auth.admin.deleteUser(user.id);
  } catch {
    // best-effort: ignore failures (e.g. already cleaned up)
  }
}

export async function getProfile(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { id: userId } });
  if (!profile) {
    throw new AppError(404, 'Profile not found');
  }
  // Phase 5: never leak MFA secrets to the client. The frontend only needs the
  // boolean `mfaEnabled` to render the toggle — totpSecret + backupCodes must
  // stay server-side.
  const { totpSecret: _secret, backupCodes: _codes, ...safeProfile } = profile as any;
  return safeProfile;
}

export async function updateProfile(userId: string, data: {
  name?: string;
  phone?: string;
  address?: string;
  preferences?: string[];
  notifyPrefs?: Record<string, boolean>;
  styleNotes?: string | null;
}) {
  const updateData: {
    name?: string;
    phone?: string;
    address?: string;
    preferences?: string | null;
    notifyPrefs?: Record<string, boolean>;
    styleNotes?: string | null;
  } = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.preferences !== undefined) {
    updateData.preferences = data.preferences.length ? data.preferences.join(',') : null;
  }
  // Notification preferences (sms on/off), stored as JSON. Default (null) = all on.
  if (data.notifyPrefs !== undefined) updateData.notifyPrefs = data.notifyPrefs;
  // Saved measurements / style notes — lets the boutique pre-fill fittings and
  // personalize recommendations. Empty string clears it back to null.
  if (data.styleNotes !== undefined) updateData.styleNotes = data.styleNotes?.trim() || null;
  const profile = await prisma.profile.update({
    where: { id: userId },
    data: updateData,
  });
  return profile;
}

export async function createStaffAccount(adminId: string, data: {
  email: string;
  password: string;
  name: string;
  phone?: string;
}) {
  const admin = await prisma.profile.findUnique({ where: { id: adminId } });
  if (!admin || admin.role !== 'Admin') {
    throw new AppError(403, 'Only admins can create staff accounts');
  }

  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: env.AUTH_EMAIL_CONFIRM,
  });

  if (error || !authData.user) {
    // C2: same as signupCustomer — generic message, real reason logged only.
    console.error('[auth] create staff failed:', error?.message);
    throw new AppError(400, 'Unable to create account. Please try again.');
  }

  const profile = await prisma.profile.create({
    data: {
      userId: authData.user.id,
      email: data.email,
      role: 'Staff',
      name: data.name,
      phone: data.phone ?? null,
    },
  });

  return profile;
}

export async function listStaffAccounts() {
  return prisma.profile.findMany({
    where: { role: 'Staff' },
    select: { id: true, email: true, name: true, phone: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function removeStaffAccount(adminId: string, staffId: string) {
  const admin = await prisma.profile.findUnique({ where: { id: adminId } });
  if (!admin || admin.role !== 'Admin') {
    throw new AppError(403, 'Only admins can remove staff accounts');
  }

  const staff = await prisma.profile.findUnique({ where: { id: staffId } });
  if (!staff || staff.role !== 'Staff') {
    throw new AppError(404, 'Staff account not found');
  }

  await supabaseAdmin.auth.admin.deleteUser(staff.userId);
  await prisma.notification.deleteMany({ where: { profileId: staffId } });
  // Clear sentSms rows that reference this profile (both as recipient and as
  // the staff sender) so the profile delete doesn't hit FK constraints and
  // doesn't leave orphan history keyed to a removed account. The `profileId`
  // where already covers every sentSms row whose recipient OR sender is this
  // staff member, so two deletes are needed: one for rows they received, one
  // for rows they sent on behalf of other customers (which have a different
  // profileId and so are not caught by the first).
  await prisma.sentSms.deleteMany({ where: { profileId: staffId } });
  await prisma.sentSms.deleteMany({ where: { sentById: staffId } });
  await prisma.profile.delete({ where: { id: staffId } });
}

// Exchange a refresh token for a fresh access+refresh token pair via the
// Supabase admin client. Returns a trimmed session object suitable for
// setSessionCookies. Throws AppError(401) on invalid/expired refresh tokens
// so the caller can clear stale cookies.
export async function refreshWithRefreshToken(refreshToken: string) {
  const { data, error } = await supabaseAdmin.auth.refreshSession({
    refresh_token: refreshToken,
  });

  if (error || !data.session) {
    throw new AppError(401, 'Invalid or expired refresh token');
  }

  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    token_type: data.session.token_type ?? 'bearer',
    expires_in: data.session.expires_in ?? null,
    user: data.user,
  };
}

// Revoke a refresh token (session-scoped sign-out). The access token stays
// valid until its natural JWT expiry (stateless residual — documented), but
// the user can no longer obtain new tokens once it expires.
export async function revokeRefreshToken(refreshToken: string) {
  try {
    await supabaseAdmin.auth.admin.signOut(refreshToken);
  } catch {
    // Best-effort: if Supabase can't revoke (e.g. already rotated), we still
    // clear the cookies client-side.
  }
}

// W2.8: Revoke ALL refresh tokens for a user (forces re-login on every device).
// Supabase's admin signOut with scope 'global' takes a JWT and invalidates all
// sessions for that user. We need a valid access token to call it; if we don't
// have one, the password change itself will rotate refresh tokens and invalidate
// sessions.
export async function revokeAllUserSessions(userId: string, accessToken?: string) {
  if (!accessToken) return;
  try {
    await supabaseAdmin.auth.admin.signOut(accessToken, 'global');
  } catch {
    // Best-effort: sessions will naturally expire.
  }
}

// Convenience: given a Supabase session object, return a trimmed session
// for cookie storage.
export function toRtSession(session: {
  access_token?: string | null;
  refresh_token?: string | null;
  token_type?: string;
  expires_in?: number | null;
}) {
  return {
    access_token: session.access_token ?? null,
    refresh_token: session.refresh_token ?? null,
    token_type: session.token_type ?? 'bearer',
    expires_in: session.expires_in ?? null,
  };
}

// Phase 3: Server-side OAuth redirect URL.
// Generates a PKCE code_verifier + code_challenge and builds the Supabase
// OAuth URL. Returns both so the callback can verify the challenge.
export interface OauthRedirectResult {
  url: string;
  codeVerifier: string;
}

export function buildOauthRedirectUrl(redirectTo: string, provider: string = 'google'): OauthRedirectResult {
  // PKCE: code_verifier is a high-entropy random string (43–128 chars).
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(
    crypto.createHash('sha256').update(codeVerifier).digest()
  );

  const params = new URLSearchParams({
    provider,
    redirect_to: redirectTo,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const url = `${env.SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;
  return { url, codeVerifier };
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Phase 3: Exchange the OAuth code for tokens via the Supabase token endpoint.
// Uses the anon key (sufficient for token exchange). Returns the full session.
export interface OauthTokenData {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  user?: Record<string, unknown>;
}

export async function exchangeOauthCode(
  code: string,
  codeVerifier: string,
  redirectTo: string
): Promise<OauthTokenData> {
  // Modern GoTrue (the `pkce` grant) expects an application/json body of
  // { auth_code, code_verifier } with grant_type=pkce in the query — identical
  // to how supabase-js v2 serializes its token request (this repo's pinned
  // @supabase/auth-js sends `Content-Type: application/json;charset=UTF-8` +
  // JSON.stringify body). The older `grant_type=authorization_code` + JSON
  // body produced `unsupported_grant_type`, and a form-urlencoded body was
  // rejected with "Could not parse request body as JSON".
  void redirectTo; // PKCE grant doesn't need redirect_to at exchange time
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new AppError(401, (body.error_description as string) || (body.msg as string) || (body.error as string) || 'OAuth token exchange failed');
  }

  const data: OauthTokenData = await res.json() as OauthTokenData;
  // data = { access_token, refresh_token, expires_in, token_type, user }
  return data;
}
