# Backend Development Plan: RENTECH — Mylene's Boutique

---

## 1. Architecture Overview

```
┌──────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│  React PWA   │────▶│  Express + TypeScript │────▶│   Supabase      │
│  (Vercel)    │     │  (Railway/Fly.io)     │     │  (PostgreSQL    │
│              │◀────│  Port 3001            │◀────│  + Storage)     │
└──────────────┘     └──────────────────────┘     └─────────────────┘
       │                       │
       │  (direct Supabase     ├──▶ PayMongo API
       │   client for auth,    ├──▶ Semaphore API
       │   anon key + RLS)     └──▶ Gemini API
       ▼
  Supabase (read-only
  public queries via
  anon key with RLS)
```

**Key design decisions:**
- Express + TypeScript — strongly typed, widest ecosystem
- Prisma ORM — type-safe DB access with migrations
- JWT verification via Supabase Admin SDK on every request
- All third-party API calls routed through backend (hides API keys)
- Supabase Storage for photos, backend generates signed URLs
- Separate `/backend` directory, independent deploy

---

## 2. Project Structure

```
backend/
├── package.json
├── tsconfig.json
├── .env
├── .env.example
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.ts               # Seed data
├── src/
│   ├── index.ts              # Entry point
│   ├── config/
│   │   ├── env.ts            # Environment variable validation
│   │   └── supabase.ts       # Supabase admin client
│   ├── middleware/
│   │   ├── auth.ts           # JWT verification middleware
│   │   ├── rbac.ts           # Role-based access control
│   │   ├── validate.ts       # Request validation (zod)
│   │   └── errorHandler.ts   # Global error handler
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── inventory.routes.ts
│   │   ├── transactions.routes.ts
│   │   ├── customers.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── settings.routes.ts
│   │   ├── payments.routes.ts
│   │   ├── sms.routes.ts
│   │   ├── notifications.routes.ts
│   │   ├── ai.routes.ts
│   │   ├── storage.routes.ts
│   │   └── webhooks.routes.ts
│   ├── controllers/
│   │   ├── auth.controller.ts
│   │   ├── inventory.controller.ts
│   │   ├── transactions.controller.ts
│   │   ├── customers.controller.ts
│   │   ├── dashboard.controller.ts
│   │   ├── settings.controller.ts
│   │   ├── payments.controller.ts
│   │   ├── sms.controller.ts
│   │   ├── notifications.controller.ts
│   │   ├── ai.controller.ts
│   │   ├── storage.controller.ts
│   │   └── webhooks.controller.ts
│   ├── services/
│   │   ├── auth.service.ts
│   │   ├── inventory.service.ts
│   │   ├── transactions.service.ts
│   │   ├── dashboard.service.ts
│   │   ├── paymongo.service.ts
│   │   ├── semaphore.service.ts
│   │   ├── gemini.service.ts
│   │   └── sms-templates.service.ts
│   ├── utils/
│   │   ├── helpers.ts
│   │   ├── fees.ts            # Late penalty/damage fee calc
│   │   └── sma.ts             # Simple Moving Average calc
│   └── types/
│       └── index.ts           # Shared TypeScript types
└── tests/
    ├── setup.ts
    ├── auth.test.ts
    ├── inventory.test.ts
    └── transactions.test.ts
```

---

## 3. Database Schema (Prisma)

### 3.1 Tables

```prisma
enum Role {
  Admin
  Staff
  Customer
}

enum ItemStatus {
  Available
  Rented
  Reserved
  Cleaning
  Damaged
  Maintenance
}

enum TransactionStatus {
  Active
  Overdue
  Returned
  Cancelled
}

model Profile {
  id          String   @id @default(uuid())
  userId      String   @unique   // Supabase Auth user.id
  email       String   @unique
  role        Role     @default(Customer)
  name        String
  phone       String?
  address     String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  staffCreatedBy String?                // If Staff, who created them (Admin id)
  customerTransactions Transaction[]    @relation("CustomerTransactions")
  processedByTransactions Transaction[] @relation("ProcessedByTransactions")
  notifications  Notification[]
  sentMessages   SentSms[]
  sentByMessages SentSms[]    @relation("SentByMessages")

  @@map("profiles")
}

model InventoryItem {
  id          Int        @id @default(autoincrement())
  name        String
  category    String     // Gown, Suit, Barong, Filipiniana, Costume
  price       Float
  status      ItemStatus @default(Available)
  image       String?    // URL to Supabase Storage
  description String?
  size        String?    // XS, S, M, L, XL, Custom
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt

  transactions Transaction[]

  @@map("inventory_items")
}

model Transaction {
  id              String            @id @default(uuid())
  txNumber        Int               @default(autoincrement()) // Human-readable: TX-1001
  customerId      String
  processedById   String?
  itemId          Int
  rentalDate      DateTime
  dueDate         DateTime
  returnDate      DateTime?
  status          TransactionStatus @default(Active)
  rentalFee       Float
  downpayment     Float             @default(0)
  latePenalty     Float             @default(0)
  damageFee       Float             @default(0)
  totalPaid       Float             @default(0)
  balance         Float
  conditionPhoto  String?           // URL to Supabase Storage
  notes           String?
  paymentIntentId String?           // PayMongo PI ID
  createdAt       DateTime          @default(now())
  updatedAt       DateTime          @updatedAt

  customer       Profile        @relation("CustomerTransactions", fields: [customerId], references: [id])
  processedBy    Profile?       @relation("ProcessedByTransactions", fields: [processedById], references: [id])
  item           InventoryItem  @relation(fields: [itemId], references: [id])
  notifications  Notification[]
  payments       Payment[]

  @@map("transactions")
}

model Payment {
  id              String   @id @default(uuid())
  transactionId   String
  amount          Float
  method          String   // gcash, card, cash
  type            String   // downpayment, full_payment, penalty
  paymongoPiId    String?  // PayMongo payment intent ID
  status          String   // pending, succeeded, failed
  createdAt       DateTime @default(now())

  transaction Transaction @relation(fields: [transactionId], references: [id])

  @@map("payments")
}

model Notification {
  id            String   @id @default(uuid())
  profileId     String
  transactionId String?
  type          String   // return_due, return_overdue, booking_confirmed, payment_received, damage_reported
  title         String
  message       String
  isRead        Boolean  @default(false)
  createdAt     DateTime @default(now())

  profile     Profile?     @relation(fields: [profileId], references: [id])
  transaction Transaction? @relation(fields: [transactionId], references: [id])

  @@map("notifications")
}

model SentSms {
  id          String   @id @default(uuid())
  profileId   String
  sentById    String?
  transactionId String?
  templateId  String?
  message     String
  status      String   // sent, failed, queued
  createdAt   DateTime @default(now())

  profile     Profile     @relation(fields: [profileId], references: [id])
  sentBy      Profile?    @relation("SentByMessages", fields: [sentById], references: [id])
  transaction Transaction? @relation(fields: [transactionId], references: [id])
  template    SmsTemplate? @relation(fields: [templateId], references: [id])

  @@map("sent_sms")
}

model SmsTemplate {
  id        String   @id @default(uuid())
  name      String   // due_reminder, booking_confirmation, late_return, custom
  content   String   // Template with {customer}, {item}, {date} placeholders
  isDefault Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages SentSms[]

  @@map("sms_templates")
}

model BusinessRule {
  id              String  @id @default(uuid())
  key             String  @unique
  value           String  // Stored as string, parsed by type
  description     String?
  updatedAt       DateTime @updatedAt

  @@map("business_rules")
}

model AuditLog {
  id          String   @id @default(uuid())
  action      String   // create, update, delete
  entity      String   // inventory_item, transaction, profile, etc.
  entityId    String
  performedById String?
  oldValue    Json?
  newValue    Json?
  createdAt   DateTime @default(now())

  @@map("audit_logs")
}
```

### 3.2 Seed Data

- Business rules: late_penalty_per_day=500, damage_fee=1000, rental_period_days=3, min_downpayment=200
- SMS templates: due_reminder, booking_confirmation, late_return_notification
- Sample inventory items (from current INITIAL_INVENTORY)
- Sample transactions (from current INITIAL_TRANSACTIONS)

---

## 4. API Routes

### 4.1 Auth Routes (`/api/auth`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/api/auth/signup` | No | — | Customer self-registration (creates Supabase Auth user + Profile) |
| POST | `/api/auth/login` | No | — | Delegates to Supabase Auth, returns JWT + profile |
| POST | `/api/auth/logout` | Yes | All | Supabase Auth sign-out |
| GET | `/api/auth/me` | Yes | All | Get current user profile |
| PUT | `/api/auth/me` | Yes | All | Update own profile |
| POST | `/api/auth/staff` | Yes | Admin | Create staff account (Supabase Auth + Profile) |
| DELETE | `/api/auth/staff/:id` | Yes | Admin | Remove staff account |
| GET | `/api/auth/staff` | Yes | Admin | List all staff accounts |

### 4.2 Inventory Routes (`/api/inventory`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/inventory` | Optional | All | List items (public: Available only; auth: all statuses) |
| GET | `/api/inventory/:id` | Optional | All | Get single item detail |
| POST | `/api/inventory` | Yes | Admin, Staff | Create inventory item |
| PUT | `/api/inventory/:id` | Yes | Admin, Staff | Update inventory item (Admin: all fields; Staff: read-only) |
| DELETE | `/api/inventory/:id` | Yes | Admin | Delete item (only if Available/Maintenance) |
| GET | `/api/inventory/availability` | No | — | Check date-specific availability for an item |

### 4.3 Transaction Routes (`/api/transactions`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/transactions` | Yes | Admin, Staff, Customer | List transactions (filtered by role) |
| GET | `/api/transactions/:id` | Yes | All | Get transaction detail |
| POST | `/api/transactions` | Yes | Admin, Staff, Customer | Create rental (validates availability, updates item status) |
| PUT | `/api/transactions/:id/return` | Yes | Admin, Staff | Process return (calc fees, update statuses) |
| PUT | `/api/transactions/:id/cancel` | Yes | Admin | Cancel transaction |
| GET | `/api/transactions/upcoming` | Yes | Staff | List upcoming returns / today's tasks |

### 4.4 Customer-Facing Routes (`/api/customer`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/catalog` | No | — | Public catalog (Available items only) |
| GET | `/api/catalog/:id` | No | — | Public item detail |
| POST | `/api/bookings` | Yes | Customer | Create booking (validates availability, creates pending transaction) |
| GET | `/api/bookings` | Yes | Customer | Customer's booking history |
| GET | `/api/bookings/:id` | Yes | Customer | Booking detail + receipt |

### 4.5 Dashboard Routes (`/api/dashboard`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/dashboard/kpis` | Yes | Admin, Staff | Active rentals, pending returns, monthly revenue, damaged count |
| GET | `/api/dashboard/forecast` | Yes | Admin | SMA demand forecast data (3-month window) |
| GET | `/api/dashboard/insights` | Yes | Admin | Aggregated data for AI Insights view |
| GET | `/api/dashboard/today` | Yes | Staff | Today's returns, upcoming tasks |

### 4.6 Settings Routes (`/api/settings`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/settings/rules` | Yes | Admin, Staff | Get business rules |
| PUT | `/api/settings/rules` | Yes | Admin | Update business rules |
| GET | `/api/settings/sms-templates` | Yes | Admin, Staff | List SMS templates |
| POST | `/api/settings/sms-templates` | Yes | Admin | Create SMS template |
| PUT | `/api/settings/sms-templates/:id` | Yes | Admin | Update SMS template |
| DELETE | `/api/settings/sms-templates/:id` | Yes | Admin | Delete SMS template |

### 4.7 Payment Routes (`/api/payments`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/api/payments/create-intent` | Yes | Customer | Create PayMongo payment intent for downpayment |
| GET | `/api/payments/:id` | Yes | All | Get payment details |
| POST | `/api/webhooks/paymongo` | No | — | PayMongo webhook handler (updates payment status, triggers SMS) |

### 4.8 SMS Routes (`/api/sms`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/api/sms/send` | Yes | Admin, Staff | Send manual SMS (with template or custom message) |
| GET | `/api/sms/history` | Yes | Admin, Staff | SMS send history |

### 4.9 Notification Routes (`/api/notifications`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/api/notifications` | Yes | All | List notifications for authenticated user |
| PUT | `/api/notifications/:id/read` | Yes | All | Mark notification as read |
| PUT | `/api/notifications/read-all` | Yes | All | Mark all as read |
| GET | `/api/notifications/unread-count` | Yes | All | Get unread count (for badge) |

### 4.10 AI Routes (`/api/ai`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/api/ai/generate-report` | Yes | Admin | Generate AI business report via Gemini |
| POST | `/api/ai/chat` | Yes | Customer | Proxy chatbot messages to Gemini API (with FAQ fallback) |

### 4.11 Storage Routes (`/api/storage`)

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/api/storage/upload-url` | Yes | Admin, Staff | Generate signed upload URL for condition photo |
| GET | `/api/storage/:path` | Yes | All | Get signed download URL for a stored file |

---

## 5. Middleware Stack

```
Request
  │
  ├─ cors()                    — Allow Vercel frontend origin
  ├─ helmet()                  — Security headers
  ├─ express.json()            — Parse JSON bodies
  ├─ rateLimiter               — 100 req/min per IP (1000 for webhooks)
  │
  ├─ authMiddleware            — Verify JWT from Authorization header
  │   └─ rbacMiddleware(roles) — Check user.role against allowed roles
  │
  └─ validate(schema)          — Zod request body/query validation
```

### 5.1 Auth Middleware

```typescript
// Verifies Supabase JWT, attaches user to req.user
// On failure: 401 Unauthorized
// On success: req.user = { id, email, role, name }
```

### 5.2 RBAC Middleware

```typescript
// Factory: requireRole('Admin') or requireRole('Admin', 'Staff')
// Checks req.user.role against allowed roles
// On failure: 403 Forbidden
```

---

## 6. Service Integrations

### 6.1 PayMongo Service

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| Create Payment Intent | `POST /v1/payment_intents` | Create PI for downpayment |
| Retrieve Payment Intent | `GET /v1/payment_intents/:id` | Check payment status |
| Webhook verification | Signature check | Verify incoming webhooks |

### 6.2 Semaphore Service

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| Send SMS | `POST /v4/messages` | Send templated or custom SMS |
| API Key | `api_key` in query params | Authentication |

### 6.3 Gemini Service

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| Generate report | `gemini-2.5-flash` model | AI business report |
| Chat completion | `gemini-2.5-flash` model | AI stylist chatbot |
| Rate limiting | 15 req/min | Respect free tier limits |

---

## 7. Development Phases

### Phase 1: Scaffold & Database (Week 1, Days 1-2)

- [ ] Initialize Express + TypeScript project in `/backend`
- [ ] Configure ESLint, tsconfig, scripts (`dev`, `build`, `start`)
- [ ] Set up Prisma with Supabase PostgreSQL connection
- [ ] Define all models in `schema.prisma`
- [ ] Run initial migration
- [ ] Create seed script with sample data
- [ ] Set up environment variable validation (`config/env.ts`)
- [ ] Implement Supabase admin client (`config/supabase.ts`)

**Files to create:**
- `package.json` (express, cors, helmet, dotenv, @supabase/supabase-js, prisma, @prisma/client, zod, uuid)
- `tsconfig.json`
- `.env` / `.env.example`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `src/index.ts` (basic Express app with health check)

### Phase 2: Auth & Middleware (Week 1, Days 3-4)

- [ ] Implement JWT verification middleware
- [ ] Implement RBAC middleware factory
- [ ] Implement Zod validation middleware
- [ ] Implement global error handler
- [ ] Build auth routes: signup (customer), login, me, update profile
- [ ] Build admin auth routes: create staff, list staff, remove staff
- [ ] Test full signup → login → JWT → protected route flow

### Phase 3: Inventory CRUD (Week 1, Days 5-6)

- [ ] Build inventory service (create, read, update, delete, list, filter)
- [ ] Build inventory routes with RBAC
- [ ] Implement availability check logic (date ranges)
- [ ] Build storage routes (signed upload URLs)
- [ ] Test all inventory endpoints

### Phase 4: Transactions & Returns (Week 2, Days 1-3)

- [ ] Build transaction service (create rental with availability validation)
- [ ] Implement item status transitions (Available → Rented → Cleaning → Available)
- [ ] Build return processing with fee calculation
- [ ] Build transaction listing with role-based filtering
- [ ] Build dashboard KPI endpoints
- [ ] Implement audit logging for all mutations

### Phase 5: Customer Portal (Week 2, Days 3-4)

- [ ] Build public catalog endpoint
- [ ] Build booking creation endpoint (validates dates, creates pending transaction)
- [ ] Build customer booking history
- [ ] Integrate AI chat proxy endpoint

### Phase 6: Payments (Week 2, Days 4-5)

- [ ] Implement PayMongo service (create payment intent)
- [ ] Build payment routes
- [ ] Build webhook handler (payment success → update transaction → trigger SMS)
- [ ] Test payment flow end-to-end

### Phase 7: SMS & Notifications (Week 2, Days 5-6)

- [ ] Implement Semaphore service
- [ ] Build SMS send routes (templated + custom)
- [ ] Build SMS history
- [ ] Build notification system (auto-create on key events)
- [ ] Build notification routes

### Phase 8: AI & Reports (Week 2, Day 6-7)

- [ ] Implement Gemini service (report generation)
- [ ] Build AI report endpoint
- [ ] Build AI chat endpoint (with FAQ fallback)
- [ ] Implement SMA computation service
- [ ] Build forecast endpoint

### Phase 9: Polish & Test (Week 2, Day 7)

- [ ] Add request rate limiting
- [ ] Add request logging (morgan or pino)
- [ ] Test all error states
- [ ] Write API documentation
- [ ] Deploy to Railway/Fly.io

---

## 8. Installation & Setup

### 8.1 Prerequisites

- Node.js 20+
- Supabase project (free tier)
- PayMongo test account
- Semaphore API key
- Gemini API key

### 8.2 Initial Setup

```bash
# Navigate to backend directory
cd backend

# Initialize project
npm init -y
npm install express cors helmet dotenv @supabase/supabase-js @prisma/client zod uuid morgan pino
npm install -D typescript @types/node @types/express @types/cors ts-node tsx prisma nodemon

# Initialize TypeScript
npx tsc --init

# Initialize Prisma
npx prisma init

# Configure .env with DATABASE_URL (Supabase PostgreSQL connection string)

# Run migration
npx prisma migrate dev --name init

# Seed database
npx prisma db seed

# Start dev server
npm run dev
```

### 8.3 Environment Variables

```env
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxx   # Admin SDK key (server-side only)
SUPABASE_ANON_KEY=xxxxx           # Public key (for frontend)

# Database (via Supabase)
DATABASE_URL=postgresql://postgres:xxxxx@xxxxx.supabase.co:5432/postgres

# PayMongo
PAYMONGO_SECRET_KEY=sk_test_xxxxx
PAYMONGO_PUBLIC_KEY=pk_test_xxxxx
PAYMONGO_WEBHOOK_SECRET=whsec_xxxxx

# Semaphore
SEMAPHORE_API_KEY=xxxxx

# Gemini
GEMINI_API_KEY=xxxxx

# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# JWT (verified via Supabase, but used for session if needed)
JWT_SECRET=xxxxx
```

### 8.4 Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "db:migrate": "prisma migrate dev",
    "db:seed": "prisma db seed",
    "db:studio": "prisma studio",
    "lint": "eslint src/"
  }
}
```

---

## 9. Key Implementation Details

### 9.1 Fee Calculation (Return Processing)

```typescript
function calculateFees(rentalDate: Date, dueDate: Date, returnDate: Date, isDamaged: boolean) {
  const daysLate = Math.max(0, Math.floor((returnDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)));
  const latePenalty = daysLate * LATE_PENALTY_PER_DAY;  // ₱500/day
  const damageFee = isDamaged ? DAMAGE_FEE : 0;         // ₱1000
  return { daysLate, latePenalty, damageFee, totalFees: latePenalty + damageFee };
}
```

### 9.2 Availability Check

- An item is **Available** if: status === 'Available' AND no overlapping Active/Reserved transactions exist for the requested date range
- Check overlaps: `WHERE itemId = ? AND status IN ('Active', 'Reserved') AND rentalDate <= ? AND dueDate >= ?`

### 9.3 Status Transitions

```
Available  ──rent──▶  Rented  ──return──▶  Cleaning  ──mark-ready──▶  Available
Available  ──book──▶  Reserved ──confirm──▶ Rented
Rented     ──late──▶  Overdue
Rented     ──return──▶ Cleaning
Reserved   ──cancel──▶ Available
Available  ──mark──▶  Maintenance
Cleaning   ──mark──▶  Available
Any        ──damage──▶ Damaged
```

### 9.4 Auto-Triggers

| Event | Trigger | When |
|-------|---------|------|
| Booking confirmed | Create notification (booking_confirmed) | After payment success |
| Rental created | Send SMS confirmation | After transaction creation |
| Return approaching | Send SMS reminder (due_reminder) | 1 day before dueDate (cron) |
| Return overdue | Send SMS (late_return), create notification | After dueDate passes |
| Payment received | Create notification (payment_received) | After webhook confirms payment |
| Item damaged | Create notification (damage_reported) | On return with damage toggle |

---

## 10. Testing Strategy

| Layer | Tool | Focus |
|-------|------|-------|
| Unit (services) | Vitest / Jest | Fee calculation, SMA, validation logic |
| Integration (routes) | Supertest | Each API endpoint with real Prisma (test DB) |
| E2E | Playwright (frontend→backend) | Full flows: signup → browse → book → pay → return |

---

## 11. Deployment

| Platform | Service | Cost |
|----------|---------|------|
| Railway | Express backend | ~$5-10/month |
| Supabase | PostgreSQL + Storage | Free tier |
| Vercel | Frontend (already deployed) | Free tier |

**Deployment steps:**
1. Push backend to GitHub
2. Connect Railway to GitHub repo
3. Set environment variables in Railway dashboard
4. Run `prisma migrate deploy` on Railway build
5. Set FRONTEND_URL to Vercel domain in Railway env
6. Deploy and test health endpoint (`/api/health`)
