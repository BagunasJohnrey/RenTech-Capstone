import { supabaseAdmin } from '../config/supabase.js';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Role } from '@prisma/client';

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
  };
}

export async function loginUser(email: string, password: string) {
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

  return {
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      token_type: data.session.token_type,
      expires_in: data.session.expires_in,
    },
    user: profile,
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
  return profile;
}

export async function updateProfile(userId: string, data: {
  name?: string;
  phone?: string;
  address?: string;
  preferences?: string[];
}) {
  const updateData: {
    name?: string;
    phone?: string;
    address?: string;
    preferences?: string | null;
  } = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.preferences !== undefined) {
    updateData.preferences = data.preferences.length ? data.preferences.join(',') : null;
  }
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
  await prisma.profile.delete({ where: { id: staffId } });
}
