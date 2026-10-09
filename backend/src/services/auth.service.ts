import { supabaseAdmin, supabaseSignUp } from '../config/supabase.js';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import { createAuditLog } from '../utils/audit.js';
import { env } from '../config/env.js';
import * as brevoService from './brevo.service.js';
import * as storageService from './storage.service.js';
import { Role, Prisma } from '@prisma/client';
import * as crypto from 'crypto';

// Brevo email-token lifetimes: verification links last 24h, reset links 1h.
export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

// Our own tokens are 64-char hex (crypto.randomBytes(32)). Anything else on
// the verify/reset endpoints is a legacy Supabase credential (token_hash /
// code / access_token) and takes the Supabase fallback path in the controller.
export function isBrevoTokenFormat(token: string): boolean {
  return /^[0-9a-f]{64}$/i.test(String(token || '').trim());
}

function frontendUrl(): string {
  return env.FRONTEND_URL.replace(/\/$/, '');
}

// Email identity is case-insensitive, but Postgres `=` is not. Every write
// stores the trimmed + lowercased form (the zod schemas already normalize
// inbound values — this covers any direct service caller too).
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}

export async function signupCustomer(data: {
  email: string;
  password: string;
  name: string;
  phone?: string;
  address?: string;
  preferences?: string[];
}) {
  const email = normalizeEmail(data.email);
  if (!env.AUTH_EMAIL_CONFIRM) {
    // Email verification path (Brevo): create the user UNCONFIRMED via the
    // service role (admin.createUser never sends email — delivery is ours),
    // store a single-use token, and send the branded link via Brevo. The
    // user cannot log in until they click it (/verify-email?token=...).
    const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: false,
    });

    if (error || !authData.user) {
      // C2: never echo the Supabase error — it reveals whether the email is
      // already registered (account enumeration). Log the real reason instead.
      console.error('[auth] signup (verify) failed:', error?.message ?? 'no user returned');
      throw new AppError(400, 'Unable to create account. Please try again.');
    }

    const profile = await prisma.profile.create({
      data: {
        userId: authData.user.id,
        email,
        role: 'Customer',
        name: data.name,
        phone: data.phone ?? null,
        address: data.address ?? null,
        preferences: Array.isArray(data.preferences) && data.preferences.length
          ? data.preferences.join(',')
          : null,
      },
    });

    const token = crypto.randomBytes(32).toString('hex');
    await prisma.emailToken.create({
      data: {
        userId: profile.id,
        token,
        type: 'verification',
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    // Best-effort delivery: if Brevo fails the account still exists and the
    // user can request a fresh link via POST /auth/resend-verification.
    try {
      await brevoService.sendVerificationEmail(
        email,
        data.name,
        `${frontendUrl()}/verify-email?token=${token}`,
      );
    } catch (err) {
      console.error('[auth] verification email failed:', (err as Error)?.message);
    }

    // No session — the user must verify their email first. The controller
    // skips setSessionCookies when session is null, so the frontend shows
    // "check your inbox" instead of auto-logging in.
    return {
      session: null,
      user: profile,
      requiresVerification: true,
      requiresMfa: false,
    };
  }

  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: data.password,
    email_confirm: true,
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
      email,
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
    email,
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

export async function loginUser(rawEmail: string, password: string, trustedDevice = false) {
  // L3: uniform error for both "no account" and "wrong password" so the API
  // can't be used to enumerate registered emails. The sign-up CTA on the
  // login screen serves as the generic fallback for new users.
  const email = normalizeEmail(rawEmail);
  const existing = await prisma.profile.findUnique({ where: { email } });
  if (!existing) {
    throw new AppError(401, 'Invalid email or password');
  }

  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    // The "email not confirmed" error only fires when the password was
    // CORRECT for a registered email (GoTrue checks credentials first), so
    // surfacing it doesn't leak account enumeration. Direct the user to the
    // verification email instead of the generic invalid-credentials message.
    if (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(error?.message ?? '')) {
      throw new AppError(401, 'Please verify your email address first — check your inbox.');
    }
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

  // Staff first-login flow: the admin created this account with a one-time
  // password; the staff member must choose their own password before the
  // account can be used. The flag rides along on the login response so the
  // frontend can route to the change-password screen (session is still
  // minted — the change-password endpoint is the only thing they can reach).
  return {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
    },
    user: profile,
    requiresMfa: false,
    mustChangePassword: profile.mustChangePassword === true,
  };
}

// Google account photo: link the provider URL directly. The frontend
// renders absolute avatar URLs straight into <img> (see resolveAvatarUrl),
// so no download/re-upload is needed. Only ever SET from Google, never
// overwrite — a manually uploaded photo always wins on later logins.
// Provider metadata is not trusted blindly: https-only + length-capped.
function pickGooglePhoto(meta: unknown): string | null {
  const m = (meta ?? {}) as { picture?: unknown; avatar_url?: unknown };
  for (const v of [m.picture, m.avatar_url]) {
    if (typeof v !== 'string') continue;
    const url = v.trim();
    if (url.length > 0 && url.length <= 2000 && /^https:\/\//i.test(url)) return url;
  }
  return null;
}

export async function oauthGetOrCreateProfile(
  accessToken: string,
  details?: { name?: string; phone?: string; address?: string; preferences?: string[] }
) {
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    throw new AppError(401, 'Invalid OAuth token');
  }

  const rawOAuthEmail = user.email;
  if (!rawOAuthEmail) {
    throw new AppError(400, 'OAuth account has no email address');
  }
  // Google already normalizes, but keep the canonical form for our rows too.
  const email = normalizeEmail(rawOAuthEmail);

  // A profile may already exist (e.g., auto-created by a Supabase trigger or a
  // previous abandoned OAuth). Only treat it as "complete" if it has the
  // required fields; otherwise keep asking for details instead of logging in.
  // Staff/Admin profiles are exempt from the customer details form — the
  // customer signup fields (address, preferences) don't apply to them, and
  // forcing a staff member through it would overwrite their role with
  // 'Customer'. This is what lets a staff member sign in with Google using
  // their staff email: Supabase links the Google identity to the same auth
  // user (email match), and the profile resolves here without the customer
  // onboarding detour.
  const existing = await prisma.profile.findUnique({ where: { userId: user.id } });
  const isStaffLike = !!(existing && (existing.role === 'Staff' || existing.role === 'Admin'));
  const isComplete = isStaffLike || !!(existing && existing.name && existing.phone && existing.address);
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
    // Preserve the existing role (a Staff member finishing an old incomplete
    // profile must not be silently demoted to Customer).
    role: existing?.role ?? ('Customer' as Role),
    name: details!.name!,
    phone: details!.phone,
    address: details!.address,
    preferences:
      Array.isArray(details!.preferences) && details!.preferences.length
        ? details!.preferences.join(',')
        : null,
    // Google photo links on first save only — an existing manual photo is
    // never overwritten by a later Google login.
    avatarPath: existing?.avatarPath
      ?? pickGooglePhoto((user as { user_metadata?: unknown }).user_metadata),
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

// Profile photo (any role). The file lands under `avatars/` — a non-`rental/`
// prefix, so it lives in the PUBLIC catalog bucket and the frontend resolves
// it to a stable URL with zero signing round-trips (same as item photos).
// Uploads go through the same hardened path as every other image
// (allowlist + server-side WebP normalize in storageService.uploadFile).
export async function setAvatar(userId: string, file: {
  contentType: string;
  buffer: Buffer;
}) {
  const profile = await prisma.profile.findUnique({ where: { id: userId } });
  if (!profile) throw new AppError(404, 'Profile not found');
  const key = `avatars/${profile.id}-${Date.now()}.jpg`;
  const { path } = await storageService.uploadFile(key, file.contentType, file.buffer);
  // Best-effort cleanup of the previous photo — a missing/stale key must not
  // fail the swap (removeObject already swallows errors, belt and suspenders).
  const previous = profile.avatarPath;
  if (previous && previous !== path) {
    await storageService.removeObject(previous);
  }
  await prisma.profile.update({ where: { id: userId }, data: { avatarPath: path } });
  return getProfile(userId);
}

// Remove the profile photo (back to the default icon avatar).
export async function removeAvatar(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { id: userId } });
  if (!profile) throw new AppError(404, 'Profile not found');
  const previous = profile.avatarPath;
  if (previous) {
    await storageService.removeObject(previous);
  }
  await prisma.profile.update({ where: { id: userId }, data: { avatarPath: null } });
  return getProfile(userId);
}

// First-login staff flow: replace the admin-issued one-time password with the
// staff member's own password. Requires the old password (the one-time
// password) to be re-presented — a second factor proof that the person at the
// keyboard is the intended recipient, not someone riding a stolen session.
// After updating the Supabase credential, the flag is cleared so the account
// becomes fully usable.
//
// The same proof powers the voluntary Settings change for any logged-in
// account (staff/admin/customer): currentPassword is verified against Supabase
// before anything is written, and other sessions are revoked so a changed
// password invalidates every device except this one.
export async function changeOwnPassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
  opts: { voluntary?: boolean; accessToken?: string } = {}
) {
  const profile = await prisma.profile.findUnique({ where: { id: userId } });
  if (!profile) throw new AppError(401, 'Not authenticated');

  // Verify the current password before allowing the change.
  const { error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
    email: profile.email,
    password: oldPassword,
  });
  if (verifyError) {
    throw new AppError(401, 'Current password is incorrect');
  }

  if (oldPassword === newPassword) {
    throw new AppError(400, 'Choose a different password from your current one');
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    profile.userId,
    { password: newPassword },
  );
  if (updateError) {
    throw new AppError(400, 'Unable to change password. Please try again.');
  }

  const patch: Prisma.ProfileUpdateInput = {};
  if (profile.mustChangePassword) patch.mustChangePassword = false;
  if (Object.keys(patch).length > 0) {
    await prisma.profile.update({ where: { id: userId }, data: patch });
  }

  // Voluntary change (Settings): the password just rotated, so revoke every
  // OTHER session — the current one (opts.accessToken) stays alive so the user
  // isn't logged out mid-save. Supabase's `signOut(jwt, 'others')` invalidates
  // all refresh tokens for this user except the session the token belongs to.
  if (opts.voluntary && opts.accessToken) {
    try {
      await supabaseAdmin.auth.admin.signOut(opts.accessToken, 'others');
    } catch {
      // Best-effort: other sessions expire naturally when their access tokens
      // lapse (refresh tokens rotate on password change).
    }
  }

  return { success: true };
}

// One-time password minted for admin-created staff accounts. Long enough to
// satisfy the app's password policy (12+ chars, upper/lower/digit/symbol) so
// Supabase accepts it at createUser time; the staff member must change it on
// first login (Profile.mustChangePassword) before the account is usable.
function generateOneTimePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  // Guarantee at least one char from each required class, then fill to 16.
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  for (let i = chars.length; i < 16; i++) chars.push(pick(all));
  // Fisher-Yates shuffle so the guaranteed classes aren't predictably first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function createStaffAccount(adminId: string, data: {
  email: string;
  name: string;
  phone?: string;
}) {
  const admin = await prisma.profile.findUnique({ where: { id: adminId } });
  if (!admin || admin.role !== 'Admin') {
    throw new AppError(403, 'Only admins can create staff accounts');
  }

  const tempPassword = generateOneTimePassword();
  const email = normalizeEmail(data.email);

  // Staff are created by an admin, so they're trusted by default — always
  // auto-confirm (admin.createUser wouldn't send a verification email anyway,
  // so an unconfirmed staff account would be locked out with no way in).
  const { data: authData, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (error || !authData.user) {
    // C2: same as signupCustomer — generic message, real reason logged only.
    console.error('[auth] create staff failed:', error?.message);
    throw new AppError(400, 'Unable to create account. Please try again.');
  }

  const profile = await prisma.profile.create({
    data: {
      userId: authData.user.id,
      email,
      role: 'Staff',
      name: data.name,
      phone: data.phone ?? null,
      mustChangePassword: true,
    },
  });

  // Best-effort welcome email carrying the one-time password (the admin still
  // sees it once in the response for out-of-band sharing). Never blocks.
  try {
    await brevoService.sendStaffWelcomeEmail(email, data.name, tempPassword);
  } catch {
    // best-effort
  }

  // The one-time password is returned exactly once — never stored in the
  // database or logged. The admin shares it with the staff member out of band
  // (in person / SMS), and the first login forces a change.
  // Audit: a new login-capable account exists (email only — never the OTP).
  try {
    await createAuditLog({
      action: 'staff.create', entity: 'staff', entityId: profile.id,
      performedById: adminId,
      newValue: { email: profile.email, name: profile.name },
    });
  } catch { /* audit is non-critical */ }
  return { profile, oneTimePassword: tempPassword };
}

export async function listStaffAccounts() {
  return prisma.profile.findMany({
    where: { role: 'Staff' },
    select: { id: true, email: true, name: true, phone: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

// Edit a staff account's display details (name/phone). Two allowed callers:
//  - an Admin editing any staff account from the Team tab
//  - the staff member editing their own profile from Settings
// Email is intentionally NOT editable here — it is the login identity shared
// with the Supabase auth user, and changing it would desync auth from the
// profile (and break the Google sign-in email match).
export async function updateStaffAccount(callerId: string, staffId: string, data: {
  name?: string;
  phone?: string | null;
}) {
  const caller = await prisma.profile.findUnique({ where: { id: callerId } });
  if (!caller) throw new AppError(401, 'Not authenticated');

  const staff = await prisma.profile.findUnique({ where: { id: staffId } });
  if (!staff || staff.role !== 'Staff') {
    throw new AppError(404, 'Staff account not found');
  }

  const isSelf = caller.id === staff.id;
  const isAdmin = caller.role === 'Admin';
  if (!isSelf && !isAdmin) {
    throw new AppError(403, 'Only admins can edit staff accounts');
  }

  const patch: { name?: string; phone?: string | null } = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.phone !== undefined) patch.phone = data.phone?.trim() || null;
  if (Object.keys(patch).length === 0) {
    throw new AppError(400, 'Nothing to update');
  }

  const updated = await prisma.profile.update({
    where: { id: staffId },
    data: patch,
  });

  // Audit: which display fields changed and their old→new values. Self-edits
  // and admin edits share this path; performedById distinguishes them.
  // Non-critical: never blocks the update.
  try {
    const oldValue: Record<string, unknown> = {};
    const newValue: Record<string, unknown> = {};
    for (const k of Object.keys(patch) as (keyof typeof patch)[]) {
      oldValue[k] = (staff as Record<string, unknown>)[k] ?? null;
      newValue[k] = patch[k] ?? null;
    }
    await createAuditLog({
      action: 'staff.update', entity: 'staff', entityId: staffId,
      performedById: callerId,
      oldValue, newValue,
    });
  } catch { /* audit is non-critical */ }

  return updated;
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

  // Audit after deletion: identity snapshot (no row left to reference).
  // Non-critical: never throws past this point.
  try {
    await createAuditLog({
      action: 'staff.remove', entity: 'staff', entityId: staffId,
      performedById: adminId,
      oldValue: { email: staff.email, name: staff.name },
    });
  } catch { /* audit is non-critical */ }
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

// ---- Brevo email-token flows (verification + password reset) ----

function brevoTokenError(used: boolean, expired: boolean): AppError {
  if (used) {
    return new AppError(401, 'This link has already been used. Please request a new one.');
  }
  return new AppError(
    401,
    expired
      ? 'This link has expired. Please request a new one.'
      : 'This link is invalid or has already been used. Please request a new one.',
  );
}

// Resend the signup verification email. Always resolves with the generic
// message (no account enumeration): unknown emails, walk-ins, and already-
// confirmed accounts are indistinguishable from a fresh send.
export async function requestVerificationEmail(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const profile = await prisma.profile.findUnique({ where: { email } });
  if (profile && brevoService.isSendableEmail(profile.email)) {
    try {
      const { data } = await supabaseAdmin.auth.admin.getUserById(profile.userId);
      const confirmed = Boolean(
        (data?.user as { email_confirmed_at?: string | null } | undefined)?.email_confirmed_at,
      );
      if (!confirmed) {
        // Invalidate older unused verification links so only the newest works.
        await prisma.emailToken.deleteMany({
          where: { userId: profile.id, type: 'verification', usedAt: null },
        });
        const token = crypto.randomBytes(32).toString('hex');
        await prisma.emailToken.create({
          data: {
            userId: profile.id,
            token,
            type: 'verification',
            expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
          },
        });
        await brevoService.sendVerificationEmail(
          profile.email,
          profile.name,
          `${frontendUrl()}/verify-email?token=${token}`,
        );
      }
    } catch (err) {
      console.error('[auth] resend verification failed:', (err as Error)?.message);
    }
  }
  return { message: 'If that email is registered, a verification link has been sent.' };
}

// Consume a Brevo verification token: confirm the Supabase user, then
// best-effort mint a session (magiclink) so the user lands logged in. Falls
// back to session:null (manual login) when the magiclink exchange fails.
export async function verifyEmailToken(token: string) {
  const row = await prisma.emailToken.findUnique({ where: { token } });
  if (!row || row.type !== 'verification') {
    throw brevoTokenError(false, false);
  }
  if (row.usedAt) throw brevoTokenError(true, false);
  if (row.expiresAt.getTime() < Date.now()) throw brevoTokenError(false, true);

  const profile = await prisma.profile.findUnique({ where: { id: row.userId } });
  if (!profile) throw brevoTokenError(false, false);

  await prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });

  const { error: confirmError } = await supabaseAdmin.auth.admin.updateUserById(
    profile.userId,
    { email_confirm: true },
  );
  if (confirmError) {
    console.error('[auth] email confirm failed:', confirmError.message);
    throw new AppError(500, 'Could not verify your email. Please try again later.');
  }

  let session: { access_token: string | null; refresh_token: string | null } | null = null;
  try {
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
    });
    const hashed = (linkData as { properties?: { hashed_token?: string } } | null)?.properties?.hashed_token;
    if (!linkError && hashed) {
      const { data: otpData, error: otpError } = await supabaseAdmin.auth.verifyOtp({
        token_hash: hashed,
        type: 'magiclink',
      });
      if (!otpError && otpData?.session) session = toRtSession(otpData.session);
    }
  } catch {
    // best-effort: the account IS verified; the user can always sign in manually.
  }

  const fresh = await prisma.profile.findUnique({ where: { id: profile.id } });
  return { profile: fresh ?? profile, session };
}

// Request a password-reset email (Brevo). Always resolves with the generic
// message — unknown emails and undeliverable sends are indistinguishable, so
// the endpoint can never be used to enumerate accounts. (The route itself is
// rate-limited per-IP, which bounds retry abuse.)
export async function requestPasswordReset(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const profile = await prisma.profile.findUnique({ where: { email } });
  if (profile && brevoService.isSendableEmail(profile.email)) {
    try {
      await prisma.emailToken.deleteMany({
        where: { userId: profile.id, type: 'password_reset', usedAt: null },
      });
      const token = crypto.randomBytes(32).toString('hex');
      await prisma.emailToken.create({
        data: {
          userId: profile.id,
          token,
          type: 'password_reset',
          expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
        },
      });
      await brevoService.sendPasswordResetEmail(
        profile.email,
        profile.name,
        `${frontendUrl()}/reset-password?token=${token}`,
      );
    } catch (err) {
      console.error('[auth] password-reset email failed:', (err as Error)?.message);
    }
  }
  return { message: 'If that email is registered, a reset link has been sent.' };
}

// Consume a Brevo reset token: set the new password, then sign in fresh so
// the user lands logged in with clean cookies.
//
// currentPassword is an OPTIONAL old-password confirmation: when the user
// still remembers their current password they type it on the reset page and
// it is verified against Supabase BEFORE the single-use link is consumed — a
// typo never burns the token, the link stays valid for a retry. Blank/absent
// is the "I forgot it too" case (customer AND staff): the email link itself
// (inbox possession) is the authorization. Note this check is a confirmation
// aid, not a security boundary — the link alone authorizes the change; the
// route's 10/min rate limiter bounds old-password guessing through it.
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  currentPassword?: string,
) {
  const row = await prisma.emailToken.findUnique({ where: { token } });
  if (!row || row.type !== 'password_reset') {
    throw brevoTokenError(false, false);
  }
  if (row.usedAt) throw brevoTokenError(true, false);
  if (row.expiresAt.getTime() < Date.now()) throw brevoTokenError(false, true);

  const profile = await prisma.profile.findUnique({ where: { id: row.userId } });
  if (!profile) throw brevoTokenError(false, false);

  // Optional old-password gate — verified BEFORE the token is consumed.
  if (currentPassword) {
    const { error: verifyError } = await supabaseAdmin.auth.signInWithPassword({
      email: profile.email,
      password: currentPassword,
    });
    if (verifyError) {
      throw new AppError(401, 'Current password is incorrect');
    }
  }

  await prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    profile.userId,
    { password: newPassword },
  );
  if (updateError) {
    console.error('[auth] password update failed:', updateError.message);
    throw new AppError(500, 'Could not reset your password. Please request a new link.');
  }

  // Fresh sign-in with the just-set password (clean access + refresh pair).
  // If it fails the password WAS changed — return session:null and let the
  // user sign in manually instead of reporting a misleading link error.
  let session: { access_token: string | null; refresh_token: string | null } | null = null;
  try {
    const { data: signIn, error: signInError } = await supabaseSignUp.auth.signInWithPassword({
      email: profile.email,
      password: newPassword,
    });
    if (!signInError && signIn?.session) session = toRtSession(signIn.session);
  } catch {
    // best-effort
  }
  return { session };
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

// ---- Discount authorization PIN (admin-set, staff-presented) ----
// The 4-digit PIN is scrypt-hashed with a per-user salt and stored in the
// admin's Supabase `user_metadata` (no schema change needed). Only a hash ever
// leaves the server. The verify endpoint is rate-limited per-IP (see
// auth.routes.ts) because a 4-digit space is trivially brute-forceable.
export function hashAdminPin(pin: string): { salt: string; hash: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pin, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyAdminPin(pin: string, salt: string, hash: string): boolean {
  try {
    const candidate = crypto.scryptSync(pin, salt, 64);
    const stored = Buffer.from(hash, 'hex');
    return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

// Whether this admin already has a discount PIN configured.
export async function getAdminPinConfigured(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const meta = data?.user?.user_metadata as { adminPin?: { salt?: string; hash?: string } } | undefined;
  return Boolean(meta?.adminPin?.salt && meta.adminPin.hash);
}

// Setting/resetting the PIN requires the admin's own Supabase password when a
// PIN already exists (the PIN is only 4 digits, so changing it must be
// protected by the full credential, not just the session), plus the current
// PIN itself — the admin must know both to mint a new one. First-time setup
// takes neither — the endpoint is already Admin-only + MFA-gated.
export async function setAdminPin(userId: string, pin: string, password?: string, oldPin?: string) {
  const configured = await getAdminPinConfigured(userId);

  if (configured) {
    if (!oldPin) throw new AppError(400, 'Current PIN is required to reset');
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = data?.user?.user_metadata as { adminPin?: { salt?: string; hash?: string } } | undefined;
    if (!meta?.adminPin?.salt || !meta.adminPin.hash || !verifyAdminPin(oldPin, meta.adminPin.salt, meta.adminPin.hash)) {
      throw new AppError(401, 'Current PIN is incorrect');
    }

    if (!password) {
      throw new AppError(400, 'Password is required to reset the PIN');
    }
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { email: true },
    });
    if (!profile?.email) throw new AppError(401, 'Invalid password');

    const { data: authData, error } = await supabaseAdmin.auth.signInWithPassword({ email: profile.email, password });
    if (error || !authData.user || authData.user.id !== userId) {
      throw new AppError(401, 'Invalid password');
    }
  }

  const { salt, hash } = hashAdminPin(pin);
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    user_metadata: { adminPin: { salt, hash } },
  });
  if (updateError) throw new AppError(500, 'Failed to save discount PIN');
}

// Finds the admin whose stored PIN hash matches, so any Admin can be the
// discount approver. Returns the admin's display info or null on mismatch.
export async function verifyDiscountPin(pin: string): Promise<{ name: string; email: string } | null> {
  const admins = await prisma.profile.findMany({
    where: { role: 'Admin' },
    select: { userId: true, name: true, email: true },
  });
  for (const admin of admins) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(admin.userId);
    const meta = data?.user?.user_metadata as { adminPin?: { salt?: string; hash?: string } } | undefined;
    if (meta?.adminPin?.salt && meta.adminPin.hash && verifyAdminPin(pin, meta.adminPin.salt, meta.adminPin.hash)) {
      return { name: admin.name, email: admin.email };
    }
  }
  return null;
}
