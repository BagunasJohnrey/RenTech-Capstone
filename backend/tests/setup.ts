import { beforeAll, afterAll, beforeEach, vi } from 'vitest';

// Reset mock call history (and any mockImplementation/mockResolvedValueOnce
// leftovers) between every test so once-guard / "not called" assertions never
// see stale calls from a previous test. Without this, any test asserting
// `.not.toHaveBeenCalled()` is order-dependent.
beforeEach(async () => {
  vi.clearAllMocks();
  // Rate-limit stores are in-memory and keyed by IP — with supertest every
  // request shares one IP, so without a reset the 5/min login limiter makes
  // the Nth login test in a file fail with 429 (order-dependent). Imported
  // dynamically so env.ts isn't evaluated before the process.env assignments
  // above (which would break e.g. the SEMAPHORE_API_KEY-based send path).
  const { clearAllRateLimiters } = await import('../src/middleware/rateLimiter.js');
  clearAllRateLimiters();
});

process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.NODE_ENV = 'test';
process.env.SEMAPHORE_API_KEY = 'test-semaphore-key';
// Brevo: blank key forces the simulated (no-network) send path in tests.
process.env.BREVO_API_KEY = '';
process.env.BREVO_SENDER_EMAIL = 'noreply@test.local';
process.env.BREVO_SENDER_NAME = 'RenTech Test';

// Unit tests must never hit live AI providers: backend/.env contains real
// Gemini/Groq/OpenRouter keys, and dotenv only fills vars that aren't already
// set — blanking them here forces the deterministic in-app fallback paths.
process.env.GEMINI_API_KEY = '';
process.env.GROQ_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';
// Tests verify JWTs locally with this secret — must be set BEFORE jwtVerify.ts loads.
process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
// W3.9: MFA_SECRET_KEY exercises the AES-256-GCM encrypt/decrypt path.
process.env.MFA_SECRET_KEY = 'test-mfa-secret-key-for-encryption';

const { mockUsers, mockSessions } = vi.hoisted(() => {
  const users: Record<string, { id: string; email: string; app_metadata?: any }> = {
    'customer-token': { id: 'auth-customer-id', email: 'customer@example.com' },
    'admin-token': { id: 'auth-admin-id-789', email: 'admin@example.com', app_metadata: { aal: 2 } },
    'staff-token': { id: 'auth-staff-id-456', email: 'staff@example.com' },
    'valid-token': { id: 'auth-user-id-123', email: 'test@example.com' },
  };

  const sessions: Record<string, { access_token: string; refresh_token: string }> = {
    'customer-token': { access_token: 'customer-token', refresh_token: 'rt-customer' },
    'admin-token': { access_token: 'admin-token', refresh_token: 'rt-admin' },
    'valid-token': { access_token: 'valid-token', refresh_token: 'rt-valid' },
  };

  return {
    mockUsers: users,
    mockSessions: sessions,
  };
});

vi.mock('@supabase/supabase-js', () => {
  const mockSupabaseClient = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'new-auth-id', email: 'new@test.com' }, session: { access_token: 'new-token', refresh_token: 'rt-new' } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
        signOut: vi.fn().mockResolvedValue({ error: null }),
        updateUserById: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-id-123', email: 'test@example.com' } },
          error: null,
        }),
        // Brevo flows: confirmation status check + magiclink session minting.
        getUserById: vi.fn().mockResolvedValue({
          data: { user: { id: 'auth-user-id-123', email: 'test@example.com', email_confirmed_at: null } },
          error: null,
        }),
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { hashed_token: 'mock-hashed-token' } },
          error: null,
        }),
      },
      // Public signup endpoint (anon key) — the email-verification path.
      // Returns a user with NO session (unconfirmed) by default; the signup
      // controller surfaces requiresVerification instead of logging in.
      signUp: vi.fn().mockResolvedValue({
        data: { user: { id: 'new-auth-id', email: 'new@test.com' }, session: null },
        error: null,
      }),
      getUser: vi.fn().mockImplementation((token: string) => {
        const user = mockUsers[token] || { id: 'auth-user-id-123', email: 'test@example.com' };
        return Promise.resolve({ data: { user }, error: null });
      }),
      signInWithPassword: vi.fn().mockImplementation(({ email }: { email: string }) => {
        const user = { id: 'auth-user-id-123', email };
        return Promise.resolve({
          data: { user, session: { access_token: 'mock-access-token-xyz', refresh_token: 'mock-refresh-token' } },
          error: null,
        });
      }),
      // Phase 1: refresh token rotation mock
      refreshSession: vi.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'refreshed-access-token',
            refresh_token: 'refreshed-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
            user: { id: 'auth-user-id-123', email: 'test@example.com' },
          },
          user: { id: 'auth-user-id-123', email: 'test@example.com' },
        },
        error: null,
      }),
      // Phase 2: password reset
      resetPasswordForEmail: vi.fn().mockResolvedValue({ data: {}, error: null }),
      verifyOtp: vi.fn().mockResolvedValue({
        data: { user: { id: 'auth-user-id-123', email: 'test@example.com' }, session: null },
        error: null,
      }),
      // PKCE-style email links (?code= after the /verify redirect)
      exchangeCodeForSession: vi.fn().mockResolvedValue({
        data: {
          user: { id: 'auth-user-id-123', email: 'test@example.com' },
          session: {
            access_token: 'exchanged-access-token',
            refresh_token: 'exchanged-refresh-token',
            token_type: 'bearer',
            expires_in: 3600,
          },
        },
        error: null,
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  };

  return {
    createClient: vi.fn(() => mockSupabaseClient),
  };
});

vi.mock('../src/config/database.js', () => {
  const now = new Date();

  const profiles: Record<string, any> = {
    'auth-user-id-123': {
      id: 'profile-id-123',
      userId: 'auth-user-id-123',
      email: 'test@example.com',
      role: 'Customer',
      name: 'Test User',
      phone: '09171234567',
      address: 'Test Address',
      createdAt: now,
      updatedAt: now,
    },
    'admin-id-789': {
      id: 'admin-id-789',
      userId: 'auth-admin-id-789',
      email: 'admin@example.com',
      role: 'Admin',
      name: 'Admin User',
      phone: null,
      address: null,
      createdAt: now,
      updatedAt: now,
    },
    'auth-admin-id-789': {
      id: 'admin-id-789',
      userId: 'auth-admin-id-789',
      email: 'admin@example.com',
      role: 'Admin',
      name: 'Admin User',
      phone: null,
      address: null,
      mfaEnabled: true,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      backupCodes: JSON.stringify(['a1b2c3d4', 'e5f6g7h8']),
      createdAt: now,
      updatedAt: now,
    },
    'profile-id-123': {
      id: 'profile-id-123',
      userId: 'auth-user-id-123',
      email: 'test@example.com',
      role: 'Customer',
      name: 'Test User',
      phone: '09171234567',
      address: 'Test Address',
      createdAt: now,
      updatedAt: now,
    },
    'auth-customer-id': {
      id: 'customer-id-111',
      userId: 'auth-customer-id',
      email: 'customer@example.com',
      role: 'Customer',
      name: 'Customer User',
      phone: null,
      address: null,
      createdAt: now,
      updatedAt: now,
    },
    'customer-id-111': {
      id: 'customer-id-111',
      userId: 'auth-customer-id',
      email: 'customer@example.com',
      role: 'Customer',
      name: 'Customer User',
      phone: '09171234567',
      address: null,
      createdAt: now,
      updatedAt: now,
    },
    'no-phone-id': {
      id: 'no-phone-id',
      userId: 'no-phone-auth-id',
      email: 'nophone@example.com',
      role: 'Customer',
      name: 'No Phone',
      phone: null,
      address: null,
      createdAt: now,
      updatedAt: now,
    },
    'staff-id-456': {
      id: 'staff-id-456',
      userId: 'auth-staff-id-456',
      email: 'staff@example.com',
      role: 'Staff',
      name: 'Staff User',
      phone: null,
      address: null,
      createdAt: now,
      updatedAt: now,
    },
    'auth-staff-id-456': {
      id: 'staff-id-456',
      userId: 'auth-staff-id-456',
      email: 'staff@example.com',
      role: 'Staff',
      name: 'Staff User',
      phone: null,
      address: null,
      mustChangePassword: false,
      createdAt: now,
      updatedAt: now,
    },
    'admin-id-789': {
      id: 'admin-id-789',
      userId: 'auth-admin-id-789',
      email: 'admin@example.com',
      role: 'Admin',
      name: 'Admin User',
      phone: null,
      address: null,
      mfaEnabled: true,
      totpSecret: 'JBSWY3DPEHPK3PXP',
      backupCodes: JSON.stringify(['a1b2c3d4', 'e5f6g7h8']),
      createdAt: now,
      updatedAt: now,
    },
  };

  const mockPrisma = {
    profile: {
      create: vi.fn().mockImplementation((args) => {
        const key = args.data.userId;
        const base = profiles[key] || profiles['auth-user-id-123'];
        return Promise.resolve({ ...base, ...args.data, id: base?.id || 'profile-id-123' });
      }),
      findUnique: vi.fn().mockImplementation((args) => {
        if (args.where.id) {
          return Promise.resolve(profiles[args.where.id] || null);
        }
        if (args.where.userId) {
          return Promise.resolve(profiles[args.where.userId] || null);
        }
        if (args.where.email) {
          return Promise.resolve(Object.values(profiles).find(p => p.email === args.where.email) || null);
        }
        return Promise.resolve(null);
      }),
      findMany: vi.fn().mockResolvedValue([
        profiles['staff-id-456'],
      ]),
      update: vi.fn().mockImplementation((args) => {
        const profile = profiles['auth-user-id-123'];
        return Promise.resolve({ ...profile, ...args.data });
      }),
      delete: vi.fn().mockResolvedValue({ id: 'staff-id-456' }),
    },
    inventoryItem: {
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 1, ...args.data })),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      delete: vi.fn().mockResolvedValue({ id: 1 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    transaction: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({
        _count: { id: 0 },
        _sum: { rentalFee: 0, totalPaid: 0, latePenalty: 0, damageFee: 0 },
      }),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'tx-new', ...args.data })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    payment: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'pay-new', ...args.data })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
    },
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'notif-new', ...args.data })),
      createMany: vi.fn().mockImplementation((args) => Promise.resolve({ count: args.data?.length ?? 0 })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sentSms: {
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'sms-new', ...args.data })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      delete: vi.fn().mockResolvedValue({ id: 'sms-deleted' }),
    },
    businessRule: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ ...args.data })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ ...args.data })),
      upsert: vi.fn().mockImplementation((args) => Promise.resolve({ key: args.where.key, value: args.create.value })),
    },
    promoCode: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'promo-new', ...args.data })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    smsTemplate: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'tmpl-new', ...args.data })),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({ id: 'tmpl-deleted' }),
    },
    emailToken: {
      create: vi.fn().mockImplementation((args) => Promise.resolve({ id: 'etok-new', usedAt: null, ...args.data })),
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id, ...args.data })),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // vi.fn so tests can assert the ledger actually wrapped its writes.
    $transaction: vi.fn((fn: any) => Promise.resolve(fn(mockPrisma))),
    $disconnect: vi.fn(),
  };

  return { prisma: mockPrisma };
});
