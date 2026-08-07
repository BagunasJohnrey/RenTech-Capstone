import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as qrcode from 'qrcode';
import * as authService from '../services/auth.service.js';
import * as mfaService from '../services/mfa.service.js';
import { AuthenticatedRequest } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { setSessionCookies, clearSessionCookies, getRefreshTokenFromCookie, RtSession, setPkceCookie, getPkceCookie, clearPkceCookie, setOauthPendingCookie, clearOauthPendingCookie, getAccessTokenFromCookie, OAUTH_PKCE_COOKIE, OAUTH_PENDING_COOKIE, setMfaPendingCookie, getMfaPendingCookie, clearMfaPendingCookie, setMfaVerifiedCookie, isMfaVerifiedCookie, isMfaTrustedCookie, setMfaTrustedCookie } from '../middleware/cookies.js';
import { invalidateProfileCache, clearProfileCache } from '../utils/profileCache.js';
import { decryptField } from '../utils/crypto.js';

// Phase 4: password policy — 12+ chars with upper, lower, digit, symbol
export const passwordSchema = z.string()
  .min(12, 'Must be at least 12 characters')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;'`~]/, 'Must contain a symbol');

export const signupSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: passwordSchema,
    name: z.string().min(1),
    phone: z.string().optional(),
    address: z.string().optional(),
    preferences: z.array(z.string()).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const updateProfileSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    preferences: z.array(z.string()).optional(),
    notifyPrefs: z.record(z.boolean()).optional(),
    styleNotes: z.string().max(500).nullable().optional(),
  }),
});

export const createStaffSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: passwordSchema,
    name: z.string().min(1),
    phone: z.string().optional(),
  }),
});

// Phase 2: password reset schemas
export const forgotPasswordSchema = z.object({
  body: z.object({
    email: z.string().email(),
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token_hash: z.string().min(1),
    password: passwordSchema,
  }),
});

export const verifyEmailSchema = z.object({
  body: z.object({
    token_hash: z.string().min(1),
  }),
});

// Phase 1 + 3: OAuth now also carries the refresh token so the backend can
// mint httpOnly cookies (Phase 1). Phase 3 replaces the whole flow with a
// server-side redirect, but the schema stays backward-compatible meanwhile.
export const oauthSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().optional(),
    expiresIn: z.number().optional(),
    details: z
      .object({
        name: z.string().min(1),
        phone: z.string().min(1),
        address: z.string().min(1),
        preferences: z.array(z.string()).optional(),
      })
      .optional(),
  }),
});

export const oauthCancelSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1),
  }),
});

export async function signup(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await authService.signupCustomer(req.body);
    if (result.session) {
      setSessionCookies(res, result.session as RtSession);
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    // Trusted-device check: an rt_mfa_trusted cookie (HMAC-bound to this
    // email, set after a TOTP/backup-code pass within the last 30 days) lets
    // this browser skip the challenge on login.
    const trusted = isMfaTrustedCookie(req, email);
    const result = await authService.loginUser(email, password, trusted);
    // W2.7: If MFA is required, stash the challenge tokens in a short-lived
    // httpOnly cookie instead of returning them in the response body — the
    // client never sees the tokens; the TOTP/backup-code step reads the cookie
    // and completes the login.
    if (result.session && result.requiresMfa) {
      setMfaPendingCookie(res, result.session.access_token as string, result.session.refresh_token as string);
    } else if (result.session) {
      setSessionCookies(res, result.session as RtSession);
      // A trusted-device login skips the challenge but must still carry the
      // MFA-verified marker, otherwise requireMfaAdmin 403s right after login.
      const u = result.user as { mfaEnabled?: boolean; role?: string } | null;
      if (trusted && u?.mfaEnabled && u.role === 'Admin' && result.session.access_token) {
        setMfaVerifiedCookie(res, result.session.access_token);
      }
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

// Phase 1: server-side logout — revoke the refresh token via Supabase + clear
// cookies. The access token remains valid until its JWT expires (stateless
// residual; documented). No CSRF on logout — cookies are read directly.
export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = getRefreshTokenFromCookie(req);
    if (refreshToken) {
      await authService.revokeRefreshToken(refreshToken);
    }
    clearSessionCookies(res);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
}

// Phase 1: silent refresh. Reads the refresh-token cookie, exchanges it for a
// new access+refresh pair, sets fresh cookies, and returns the new session +
// profile. 401 if the refresh token is invalid/expired (caller clears state).
export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const refreshToken = getRefreshTokenFromCookie(req);
    if (!refreshToken) {
      throw new AppError(401, 'No refresh token');
    }
    // If the session being refreshed was MFA-verified, carry the marker over
    // to the new access token (the marker is bound to the old token, so it
    // must be re-minted for the rotated token to keep MFA-gated routes open).
    const wasMfaVerified = isMfaVerifiedCookie(req, getAccessTokenFromCookie(req) ?? '');
    const refreshed = await authService.refreshWithRefreshToken(refreshToken);
    const profile = await prisma.profile.findUnique({
      where: { userId: refreshed.user!.id },
    });
    setSessionCookies(res, refreshed as RtSession);
    if (wasMfaVerified && refreshed.access_token) {
      setMfaVerifiedCookie(res, refreshed.access_token);
    }
    res.json({
      session: {
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        token_type: refreshed.token_type,
        expires_in: refreshed.expires_in,
      },
      user: profile,
    });
  } catch (err) {
    next(err);
  }
}

// GET /auth/me — returns the sanitized profile. Since authMiddleware already
// resolved the Profile row, we build the response directly (no second DB
// query) and strip only the MFA secrets before returning.
export async function getMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const profile = await authService.getProfile(req.user.id);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function updateMe(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const profile = await authService.updateProfile(req.user.id, req.body);
    // Invalidate the auth middleware's cached profile so the next request
    // re-reads fresh fields (name/phone/etc).
    invalidateProfileCache(req.user.userId);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function createStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const profile = await authService.createStaffAccount(req.user.id, req.body);
    res.status(201).json(profile);
  } catch (err) {
    next(err);
  }
}

export async function oauth(req: Request, res: Response, next: NextFunction) {
  try {
    const { accessToken, refreshToken, expiresIn, details } = req.body;
    const result = await authService.oauthGetOrCreateProfile(accessToken, details);
    // If the profile is complete and we have a refresh token, mint cookies.
    if (!result.needsDetails && refreshToken) {
      setSessionCookies(res, {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'bearer',
        expires_in: expiresIn ?? null,
      });
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function oauthCancel(req: Request, res: Response, next: NextFunction) {
  try {
    const { accessToken } = req.body;
    await authService.oauthCancel(accessToken);
    res.json({ message: 'OAuth sign-up cancelled' });
  } catch (err) {
    next(err);
  }
}

export const verifyAdminSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export async function verifyAdmin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error || !data.user) throw new AppError(401, 'Invalid credentials');
    const profile = await prisma.profile.findUnique({ where: { userId: data.user.id } });
    if (!profile || profile.role !== 'Admin') throw new AppError(403, 'Not an admin account');
    res.json({ verified: true, admin: { name: profile.name, email: profile.email } });
  } catch (err) {
    next(err);
  }
}

export async function listStaff(_req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const staff = await authService.listStaffAccounts();
    res.json(staff);
  } catch (err) {
    next(err);
  }
}

export async function removeStaff(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    const staffId = req.params.id as string;
    await authService.removeStaffAccount(req.user.id, staffId);
    // Invalidate the removed staff's cache so they can't hit cached endpoints.
    // staffId here is the profile `id`; we don't have the auth userId directly,
    // so we clear the whole cache to be safe.
    clearProfileCache();
    res.json({ message: 'Staff account removed' });
  } catch (err) {
    next(err);
  }
}

// Phase 2: password reset — always returns 200 (no account enumeration).
// Email delivery is handled entirely by Supabase's own email service
// (Authentication → Emails). No third-party SMTP.
export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = req.body;
    const redirectTo = `${env.FRONTEND_URL.replace(/\/$/, '')}/reset-password`;
    await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
    res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

// Phase 2: consume the recovery token + new password. In Supabase v2, verifyOtp
// returns a session (access_token + refresh_token) when valid. We verify the OTP,
// set the new password, then set session cookies so the browser is logged in.
export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token_hash, password } = req.body;
    const { data, error } = await supabaseAdmin.auth.verifyOtp({
      token_hash,
      type: 'recovery',
    });
    if (error || !data?.user) throw new AppError(401, 'Invalid or expired reset token');
    await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password });
    // W2.8: A password reset invalidates all existing sessions so old tokens
    // (which were issued before the password changed) can't be used to ride in.
    // revokeAllUserSessions signs out all sessions for this user; the fresh
    // session returned by verifyOtp then establishes a clean new session.
    if (data.session?.access_token) {
      try {
        await authService.revokeAllUserSessions(data.user.id, data.session.access_token);
      } catch { /* best-effort */ }
    }
    if (data.session) {
      const rtSession = authService.toRtSession(data.session);
      setSessionCookies(res, rtSession);
    }
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    next(err);
  }
}

// Email verification: consume the signup confirmation token. The user was
// created (unconfirmed) by signupCustomer via the public signUp endpoint;
// verifyOtp({ type: 'signup' }) confirms the email and returns a session,
// which we mint into httpOnly cookies so the user is logged in immediately.
export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const { token_hash } = req.body;
    const { data, error } = await supabaseAdmin.auth.verifyOtp({
      token_hash,
      type: 'signup',
    });
    if (error || !data?.user) throw new AppError(401, 'This verification link is invalid or has expired.');

    // The profile was created at signup; find it by auth userId. If it's
    // missing (e.g. signup was interrupted), create a minimal one so the
    // verified user can use the app.
    let profile = await prisma.profile.findUnique({ where: { userId: data.user.id } });
    if (!profile) {
      profile = await prisma.profile.create({
        data: {
          userId: data.user.id,
          email: data.user.email ?? '',
          role: 'Customer',
          name: data.user.email?.split('@')[0] ?? 'Customer',
        },
      });
    }

    if (data.session) {
      setSessionCookies(res, authService.toRtSession(data.session));
    }
    res.json({ message: 'Email verified successfully', user: profile });
  } catch (err) {
    next(err);
  }
}

// Phase 5: MFA setup — generate a TOTP secret + QR data-URI for the authenticated admin.
// The QR is rendered server-side as a data-URI PNG so no external image service is needed.
export async function mfaSetup(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    if (req.user.role !== 'Admin') throw new AppError(403, 'MFA is admin-only');
  const secret = mfaService.generateTotpSecret();
  const uri = mfaService.buildTotpUri(secret, req.user.email);
  await mfaService.setTotpSecret(req.user.userId, secret);
  const qrDataUri = await qrcode.toDataURL(uri, { width: 200, margin: 1 });
    res.json({ secret, qrUri: uri, qrDataUri });
  } catch (err) {
    next(err);
  }
}

// Phase 5: MFA enable — verify the TOTP code + persist server-generated backup codes.
export const mfaEnableSchema = z.object({
  body: z.object({
    code: z.string().length(6).regex(/^\d+$/),
  }),
});

export async function mfaEnable(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    if (req.user.role !== 'Admin') throw new AppError(403, 'MFA is admin-only');
    const { code } = req.body as { code: string };
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user.userId },
      select: { totpSecret: true, email: true },
    });
    if (!profile?.totpSecret) throw new AppError(400, 'MFA not set up — call /mfa/setup first');
    const decryptedSecret = decryptField(profile.totpSecret);
    if (!decryptedSecret) throw new AppError(400, 'MFA secret is corrupted — call /mfa/setup to re-enroll');
    if (!mfaService.verifyTotpToken(decryptedSecret, code)) {
      throw new AppError(401, 'Invalid TOTP code');
    }
    // Backup codes are generated server-side (crypto.randomBytes) and shown once.
    const backupCodes = mfaService.generateBackupCodes(10);
    await mfaService.enableMfa(req.user.userId, backupCodes);
    invalidateProfileCache(req.user.userId);
    // The admin just proved possession of the second factor (correct TOTP code
    // from the app they scanned) — mark the current access token as
    // MFA-verified so MFA-gated routes work immediately without a re-login,
    // and trust this browser so future logins skip the prompt.
    const currentToken = getAccessTokenFromCookie(req);
    if (currentToken) setMfaVerifiedCookie(res, currentToken);
    if (profile.email) setMfaTrustedCookie(res, profile.email);
    res.json({ message: 'MFA enabled successfully', backupCodes });
  } catch (err) {
    next(err);
  }
}

// Phase 5: MFA disable — clears the secret + backup codes.
export async function mfaDisable(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError(401, 'Not authenticated');
    if (req.user.role !== 'Admin') throw new AppError(403, 'MFA is admin-only');

    const accessToken = getAccessTokenFromCookie(req);

    // W2.8: Disable MFA first, then revoke other sessions (not the current one
    // since we're still using it to make this request). This lets the admin
    // proceed to re-setup MFA without being logged out mid-flow.
    await mfaService.disableMfa(req.user.userId);

    // Only revoke other sessions — the current access token is needed for
    // the rest of this request. Use 'others' scope.
    if (accessToken) {
      try {
        await supabaseAdmin.auth.admin.signOut(accessToken, 'others');
      } catch { /* best-effort */ }
    }

    invalidateProfileCache(req.user.userId);
    res.json({ message: 'MFA disabled successfully' });
  } catch (err) {
    next(err);
  }
}

// W2.7: MFA challenge — verify the TOTP/backup code during login.
// Reads the challenge tokens from the rt_mfa_pending httpOnly cookie (set by
// the login handler when MFA is required). Falls back to request body tokens
// only for backward-compatibility with older clients/tests.
export const mfaChallengeSchema = z.object({
  body: z.object({
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    code: z.string().min(1),
    trustDevice: z.boolean().optional(),
  }),
});

export async function mfaChallenge(req: Request, res: Response, next: NextFunction) {
  try {
    // Prefer the MFA pending cookie; fall back to body for legacy clients.
    const pending = getMfaPendingCookie(req);
    const accessToken = pending?.accessToken || req.body.accessToken;
    const refreshToken = pending?.refreshToken || req.body.refreshToken;
    const { code } = req.body;

    if (!accessToken || !refreshToken || !code) {
      throw new AppError(401, 'Invalid session — please sign in again');
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) throw new AppError(401, 'Invalid session — please sign in again');

    const profile = await prisma.profile.findUnique({
      where: { userId: user.id },
    });
    if (!profile || !profile.mfaEnabled) throw new AppError(401, 'MFA not enabled for this account');

    // First try TOTP code, then fall back to backup code.
    let verified = false;
    const decryptedSecret = profile.totpSecret ? decryptField(profile.totpSecret) : null;
    if (decryptedSecret && /^\d{6}$/.test(code)) {
      verified = mfaService.verifyTotpToken(decryptedSecret, code);
    }
    if (!verified) {
      verified = await mfaService.consumeBackupCode(user.id, code);
    }

    if (!verified) throw new AppError(401, 'Invalid code');

    // MFA passed — mark this exact access token as MFA-verified (HMAC-bound
    // httpOnly cookie) so requireMfaAdmin accepts it as AAL=2, then mint full
    // session cookies with both tokens.
    setMfaVerifiedCookie(res, accessToken);
    setSessionCookies(res, {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: null,
    });
    clearMfaPendingCookie(res);
    // "Trust this device": optional 30-day cookie so this browser skips the
    // TOTP prompt on future logins (persists across logout, HMAC-bound to
    // the account email).
    if (req.body.trustDevice === true && profile.email) {
      setMfaTrustedCookie(res, profile.email);
    }
    res.json({ message: 'MFA verified', user: profile });
  } catch (err) {
    next(err);
  }
}
export async function oauthRedirect(req: Request, res: Response, next: NextFunction) {
  try {
    const { provider, redirectTo } = req.query;
    const redirect = typeof redirectTo === 'string' ? redirectTo : `${env.FRONTEND_URL.replace(/\/$/, '')}/oauth/callback`;
    const prov = typeof provider === 'string' && provider.length > 0 ? provider : 'google';
    const result = authService.buildOauthRedirectUrl(redirect, prov);
    // Stash the code_verifier for the callback exchange.
    setPkceCookie(res, result.codeVerifier);
    res.redirect(302, result.url);
  } catch (err) {
    next(err);
  }
}

// Phase 3: OAuth callback. Exchanges the authorization code for tokens,
// finds/creates the profile, and either sets session cookies (complete) or
// sets a pending flag + redirects to the details form.
export async function oauthCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const { code, error: oauthError, error_description } = req.query as Record<string, string>;
    if (oauthError) {
      throw new AppError(401, error_description || 'OAuth provider error');
    }
    if (!code) throw new AppError(400, 'Missing authorization code');

    const codeVerifier = getPkceCookie(req);
    if (!codeVerifier) throw new AppError(400, 'Missing PKCE verifier (session expired)');

    const redirect = `${env.FRONTEND_URL.replace(/\/$/, '')}/oauth/callback`;
    const tokenData = await authService.exchangeOauthCode(code, codeVerifier, redirect);

    clearPkceCookie(res);

    // Find or create the profile using the access token from the exchange.
    const result = await authService.oauthGetOrCreateProfile(
      tokenData.access_token as string
    );

    if (result.needsDetails) {
      // Store the access token in a session cookie so the /oauth/details
      // endpoint can use it later (without requiring frontend token passing).
      setSessionCookies(res, {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type ?? 'bearer',
        expires_in: tokenData.expires_in ?? null,
      });
      setOauthPendingCookie(res);
      // Redirect to the frontend details page. The non-httpOnly pending flag
      // is read by the frontend to know it should show the form.
      res.redirect(
        302,
        `${env.FRONTEND_URL.replace(/\/$/, '')}/oauth-details?email=${encodeURIComponent(result.email!)}`
      );
      return;
    }

    // Profile is complete — mint full session cookies.
    setSessionCookies(res, {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type ?? 'bearer',
      expires_in: tokenData.expires_in ?? null,
    });
    res.redirect(302, `${env.FRONTEND_URL.replace(/\/$/, '')}/`);
  } catch (err) {
    // User-facing OAuth errors (e.g. 409 "an account with this email already
    // exists") must NOT dump raw JSON on the callback URL the browser was
    // redirected to. Send the user to a friendly error page instead.
    if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500) {
      clearPkceCookie(res);
      clearSessionCookies(res);
      clearOauthPendingCookie(res);
      res.redirect(
        302,
        `${env.FRONTEND_URL.replace(/\/$/, '')}/oauth-error?message=${encodeURIComponent(err.message)}`
      );
      return;
    }
    next(err);
  }
}

// Phase 3: Complete the OAuth profile for users who didn't have one.
// Reads the access token from the rt_access cookie (set during the callback),
// calls oauthGetOrCreateProfile with the submitted details, and returns the
// profile. Does NOT require authMiddleware because the profile may not exist yet.
export async function oauthDetails(req: Request, res: Response, next: NextFunction) {
  try {
    const accessToken = getAccessTokenFromCookie(req);
    if (!accessToken) throw new AppError(401, 'OAuth session expired — please sign in again');

    const result = await authService.oauthGetOrCreateProfile(accessToken, req.body);
    if (result.needsDetails) {
      throw new AppError(400, 'Missing required profile details');
    }

     // Profile is now complete — set session cookies + clear pending flag.
    // The refresh token from the callback is already in the rt_refresh cookie;
    // read it so we preserve it (oauthGetOrCreateProfile doesn't return it).
    const refreshToken = getRefreshTokenFromCookie(req);
    setSessionCookies(res, {
      access_token: accessToken,
      refresh_token: refreshToken ?? null,
      token_type: 'bearer',
      expires_in: null,
    });
    clearOauthPendingCookie(res);
    res.json({ user: result.user });
  } catch (err) {
    next(err);
  }
}

export const oauthDetailsSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().min(1),
    preferences: z.array(z.string()).optional(),
  }),
});

// Phase 3: Cancel OAuth sign-up (using cookie-based auth instead of token-in-body).
export async function oauthCancelCookie(req: Request, res: Response, next: NextFunction) {
  try {
    const accessToken = getAccessTokenFromCookie(req);
    if (accessToken) {
      await authService.oauthCancel(accessToken);
    }
    clearSessionCookies(res);
    clearOauthPendingCookie(res);
    res.json({ message: 'OAuth sign-up cancelled' });
  } catch (err) {
    next(err);
  }
}
