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
  // Pre-integration escape hatch: PAYMONGO_SIMULATE=true lets the booking flow
  // complete end-to-end (fake succeeded intents, `simulated: true`) even in
  // production. NO real money moves — set the real key and remove this flag
  // the moment PayMongo is integrated.
  PAYMONGO_SIMULATE: process.env.PAYMONGO_SIMULATE === 'true',

  // Maya Pay with Maya (QRPh). Empty keys ⇒ simulated payments; a production
  // deploy without MAYA_SIMULATE=true hard-fails rather than faking a payment.
  // MAYA_WEBHOOK_ALLOWED_IPS is Maya's published webhook IP list; when empty the
  // allowlist is skipped and the secret-key re-check carries the trust alone.
  MAYA_PUBLIC_KEY: process.env.MAYA_PUBLIC_KEY || '',
  MAYA_SECRET_KEY: process.env.MAYA_SECRET_KEY || '',
  MAYA_ENV: process.env.MAYA_ENV === 'production' ? 'production' : 'sandbox',
  MAYA_SIMULATE: process.env.MAYA_SIMULATE === 'true',
  MAYA_WEBHOOK_ALLOWED_IPS: (process.env.MAYA_WEBHOOK_ALLOWED_IPS || '')
    .split(',').map((ip) => ip.trim()).filter(Boolean),
  // Optional absolute override for the Maya API host. Empty in production.
  // Exists so the integration can be driven end-to-end against the local mock
  // (backend/scripts/mock-maya.mts) before real merchant credentials exist.
  MAYA_BASE_URL: process.env.MAYA_BASE_URL || '',

  SEMAPHORE_API_KEY: process.env.SEMAPHORE_API_KEY || '',

  // Brevo (formerly Sendinblue) transactional email — verification, password
  // reset, booking/pickup/return/cancellation + reminder emails. Empty in dev
  // (sends are simulated) — must be set in any deployment that emails users.
  BREVO_API_KEY: process.env.BREVO_API_KEY || '',
  BREVO_SENDER_EMAIL: process.env.BREVO_SENDER_EMAIL || '',
  BREVO_SENDER_NAME: process.env.BREVO_SENDER_NAME || 'RenTech',

  // RAG retrieval (AI stylist grounding). Tier 1 keyword retrieval is always
  // on; RAG_ENABLED=false restores the legacy full-catalog prompt. RAG_TOP_K
  // caps grounded items per prompt (token/latency budget). EMBED_MODEL +
  // EMBED_CACHE_MIN drive the Tier 2 pgvector path; REINDEX_SECRET guards the
  // cron reindex endpoint (Admin JWT also accepted).
  RAG_ENABLED: process.env.RAG_ENABLED !== 'false',
  RAG_TOP_K: parseInt(process.env.RAG_TOP_K || '8', 10) || 8,
  EMBED_MODEL: process.env.EMBED_MODEL || 'gemini-embedding-001',
  EMBED_CACHE_MIN: parseInt(process.env.EMBED_CACHE_MIN || '15', 10) || 15,
  REINDEX_SECRET: process.env.REINDEX_SECRET || '',

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
  // at most IMAGE_MAX_DIM px on its longest edge, and re-encoded as WebP at
  // IMAGE_WEBP_QUALITY before it reaches the storage bucket. A small
  // IMAGE_THUMB_DIM px WebP derivative (IMAGE_THUMB_QUALITY) is stored
  // alongside under `thumbs/` for grid thumbnails. 768px keeps catalog /
  // collection cards crisp on 2x displays (the old 480px thumbs rendered
  // soft at card sizes) while staying far smaller than the full image. Mirrors the client-side
  // canvas downscale (utils/file.js) so direct API uploads (curl/Postman)
  // can't land full-size images in the bucket.
  IMAGE_MAX_DIM: parseInt(process.env.IMAGE_MAX_DIM || '1280', 10),
  IMAGE_WEBP_QUALITY: parseInt(process.env.IMAGE_WEBP_QUALITY || '78', 10),
  IMAGE_THUMB_DIM: parseInt(process.env.IMAGE_THUMB_DIM || '768', 10),
  IMAGE_THUMB_QUALITY: parseInt(process.env.IMAGE_THUMB_QUALITY || '78', 10),
};
