import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',

  SUPABASE_URL: requireEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_ANON_KEY: requireEnv('SUPABASE_ANON_KEY'),
  // Project JWT secret (Settings → API → JWT Settings). Used to verify
  // access tokens locally instead of calling Supabase on every request.
  SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET || '',

  // W3.9: AES-256-GCM key for encrypting TOTP secrets at rest in the database.
  // A raw secret string is stretched via SHA-256 to 32 bytes. Empty in dev
  // (encryption is skipped) — must be set in any deployment where MFA is used.
  MFA_SECRET_KEY: process.env.MFA_SECRET_KEY || '',

  DATABASE_URL: requireEnv('DATABASE_URL'),

  PAYMONGO_SECRET_KEY: process.env.PAYMONGO_SECRET_KEY || '',
  PAYMONGO_PUBLIC_KEY: process.env.PAYMONGO_PUBLIC_KEY || '',
  PAYMONGO_WEBHOOK_SECRET: process.env.PAYMONGO_WEBHOOK_SECRET || '',

  SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY || '',

  // Brevo (formerly Sendinblue) transactional email — verification, password
  // reset, booking/pickup/return/cancellation + reminder emails. Empty in dev
  // (sends are simulated) — must be set in any deployment that emails users.
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || '',
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'RenTech',

  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // Groq fallback (second tier: Gemini → Groq → OpenRouter). Low-latency
  // free-tier models keep the stylist + reports online when Gemini is down.
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',

  // OpenRouter fallback so the AI stylist still answers when Gemini is down /
  // unconfigured. Key is optional; only free-capable models are tried.
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || '',

  // Email verification gate. false (default) = signups require email
  // confirmation: the public signUp endpoint triggers Supabase's built-in
  // confirmation email and the account can't log in until verified. Set
  // AUTH_EMAIL_CONFIRM=true to auto-confirm (frictionless demo).
  AUTH_EMAIL_CONFIRM: process.env.AUTH_EMAIL_CONFIRM === 'true',

  // Server-side image compression (sharp): every uploaded image is
  // auto-rotated via its EXIF orientation tag, EXIF-stripped, downscaled to
  // at most IMAGE_MAX_DIM px on its longest edge, and re-encoded as JPEG at
  // IMAGE_JPEG_QUALITY before it reaches the storage bucket. Mirrors the
  // client-side canvas downscale (utils/file.js) so direct API uploads
  // (curl/Postman) can't land full-size images in the bucket.
  IMAGE_MAX_DIM: parseInt(process.env.IMAGE_MAX_DIM || '1280', 10),
  IMAGE_JPEG_QUALITY: parseInt(process.env.IMAGE_JPEG_QUALITY || '82', 10),
};
