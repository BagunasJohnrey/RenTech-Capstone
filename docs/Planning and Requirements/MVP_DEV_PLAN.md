# MVP Development Plan: RENTECH — Mylene's Boutique

---

## 1. MVP Goal & Hypothesis

**Hypothesis:** A single-platform digital rental system with built-in AI intelligence can fully replace Mylene's Boutique's manual logbook-based process — simultaneously improving staff operational efficiency and providing a modern self-service experience for customers — from day one.

**What we're testing:**
- Can less tech-savvy staff adopt a mobile-first PWA for daily rental processing?
- Will customers use an online catalog + booking flow instead of phone/walk-in?
- Does AI-driven reporting provide actionable value to the boutique owner?

**Validation criteria:** All three personas (Admin, Staff, Customer) can complete their primary end-to-end flows without external support beyond the built-in onboarding tutorial.

---

## 2. Target Audience (MVP)

| Persona | Count | Role in MVP |
|---|---|---|
| **Admin (Mylene)** | 1 | Full oversight, staff accounts, AI reports, business rules |
| **Staff** | 2–5 | Daily rental/return processing, condition photos, SMS alerts |
| **Customers** | 50–100 (initial) | Browse, book, pay deposit, receive SMS, use AI stylist |

Early adopters: Existing walk-in customers of Mylene's Boutique transitioning from phone/walk-in booking. Staff are existing employees moving from manual logbooks.

---

## 3. Core Feature Set

All features listed in the MVP Concept are IN. No deferrals. The full PRD scope ships together.

**Key technology enablers that reduce build effort:**
- Supabase: handles auth, database, storage, real-time — replaces custom backend for many features
- Existing frontend prototype: ~80% of UI already built, needs backend wiring + refinements
- PayMongo: PH-ready payment gateway with GCash support
- Gemini API: plug-and-play AI (no model training needed)
- Semaphore API: simple SMS API popular in the Philippines

---

## 4. Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React 19, Vite 8, Tailwind CSS 3 | Existing prototype already uses these. No migration needed. |
| **Animations** | Framer Motion | Already in prototype. |
| **Icons** | Lucide React | Already in prototype. |
| **Backend (API Layer)** | Node.js / TypeScript (Express or Fastify) | Custom API server that sits between frontend and Supabase. Handles business logic, auth verification, payment processing, SMS dispatching, Gemini orchestration, and webhook endpoints. Provides a single secure gateway. |
| **Database** | Supabase (PostgreSQL) | Managed PostgreSQL. Node.js backend connects via `pg` or Prisma ORM. |
| **File Storage** | Supabase Storage | Garment condition photos, profile images. Accessed server-side via Supabase SDK in the Node.js backend, served to frontend via signed URLs. |
| **Auth** | Supabase Auth | Node.js backend verifies JWT tokens from Supabase Auth on every request. Frontend uses Supabase client SDK for login/sign-up. Backend enforces RBAC. |
| **ORM / DB Client** | Prisma | Type-safe database client. Schema generation, migrations. Works well with PostgreSQL and TypeScript. |
| **Payments** | PayMongo API | Supports GCash, card payments. Node.js backend handles payment intent creation, webhook verification, and balance tracking. |
| **AI** | Google Gemini API (gemini-2.5-flash) | Already in prototype. Backend proxies requests to protect API key (or client calls directly with restricted key). |
| **SMS** | Semaphore API | PH-based SMS provider. Node.js backend triggers SMS sends on booking, reminders, late returns. |
| **PWA** | vite-plugin-pwa | Adds service worker + manifest generation. Minimal config. |
| **Hosting** | Vercel (frontend) + Railway / Render / Fly.io (backend) | Frontend on Vercel (free tier). Node.js backend on Railway or similar (starts at ~$5-10/month). Supabase is managed separately. |
| **Markdown rendering** | react-markdown | Already in prototype for chatbot responses. |

**Architecture overview:**

```
┌──────────────┐     ┌──────────────────┐     ┌────────────────┐
│  React PWA   │────▶│  Node.js Backend │────▶│   Supabase     │
│  (Vercel)    │     │  (Railway/Fly)   │     │  (PostgreSQL   │
│              │◀────│  Express/Fastify │◀────│  + Storage)    │
└──────────────┘     └──────────────────┘     └────────────────┘
       │                       │
       │                       ├──▶ PayMongo API
       │ (direct for           ├──▶ Semaphore API
       │  read-only            └──▶ Gemini API
       │  public data)
       ▼
  Supabase (read-only
  public queries via
  anon key with RLS)
```

**Data flow:**
- **Auth**: Frontend uses Supabase client SDK for sign-up/login → gets JWT → sends JWT to Node.js backend on every request → backend verifies JWT via Supabase Admin SDK
- **CRUD operations**: Frontend sends requests to Node.js API → backend validates permissions → queries/updates Supabase PostgreSQL → returns response
- **File uploads**: Frontend uploads directly to Supabase Storage (client-side with RLS) or via backend-generated signed URLs
- **Third-party APIs**: All calls to PayMongo, Semaphore, and Gemini are routed through the Node.js backend (hides API keys, handles webhooks)
- **Real-time**: Supabase Realtime subscriptions used for live dashboard updates (can be connected directly from frontend with RLS)

---

## 5. Development Phases & Roadmap (8-Week Timeline, Full-Time)

The phases run on **parallel tracks** where dependencies allow. Each phase lists the primary track and any parallel work.

### Week 1 – 2: Foundation & Backend Setup

| Track | Tasks | Dependencies |
|---|---|---|
| **Supabase Setup** | Create Supabase project, define database schema (users, inventory, transactions, notifications, sms_templates, settings, business_rules), configure RLS policies, set up auth providers | None |
| **Node.js Backend Scaffold** | Initialize Express/Fastify + TypeScript project. Configure Prisma with Supabase PostgreSQL connection. Set up project structure (routes, controllers, middleware, services). Implement JWT verification middleware (Supabase Admin SDK). | None |
| **Auth API Routes** | Sign-up endpoint (creates Supabase Auth user + profile record). Sign-in (delegates to Supabase Auth client). Profile CRUD. Role-based access middleware. | Backend scaffold + Supabase ready |
| **Storage Setup** | Create photo buckets in Supabase. Implement backend route for generating signed upload URLs. | Supabase project ready |
| **Payment Setup** | Set up PayMongo account, create test API keys, build payment intent creation route + webhook handler in Node.js backend. | Backend scaffold ready |
| **Project Config** | Vercel + Railway (or similar) project setup, environment variables, custom domain, PWA manifest config | None |
| **Parallel: Prototype Audit** | Audit all prototype components for backend wiring needed. Identify what renders from mock data vs. real API. Map each component to a backend route. | None |

**Milestone:** Node.js backend running with Supabase connection, JWT auth middleware, sign-up/sign-in flow working, PayMongo test endpoint responding.

---

### Week 3 – 4: Admin & Staff Core

| Track | Tasks | Dependencies |
|---|---|---|
| **Inventory API Routes** | Node.js CRUD endpoints for items (create, read, update, delete, list with filters). Role-based access (Admin: full CRUD, Staff: read-only). Status transition validation (e.g., Rented item cannot be deleted). | Backend scaffold ready |
| **Inventory Frontend** | Wire AddItemModal / EditItemModal to backend API. Replace INITIAL_INVENTORY mock with API calls. Real-time status display. | Inventory API ready |
| **Rental API Routes** | Create rental transaction endpoint (validates item availability, creates transaction record, updates item status, creates notification record). List/search transactions. Cancel rental. | Inventory API ready |
| **Staff Rental Wizard** | Wire StaffNewRental 3-step flow to backend API. Photo upload via signed URL. Replace mock transaction creation. | Rental API ready |
| **Return API Routes** | Process return endpoint (calculates late penalty from due date vs. actual return date, applies damage fee toggle, updates transaction status to Returned, updates item status to Cleaning, logs audit record). | Rental API ready |
| **Return Processing Frontend** | Wire ProcessReturnModal to backend API. Auto-calculated fees display. Condition photo upload. | Return API ready |
| **Dashboard API** | KPI endpoint (aggregates: active rental count, pending returns, monthly revenue, damaged count). Demand forecast data endpoint (computes SMA from historical transactions). | Transactions flowing |
| **Dashboard Frontend** | Wire KPI cards + demand forecast chart to real API data. Replace mock computed values. | Dashboard API ready |
| **Settings API + Frontend** | Staff account management (Admin creates users via Supabase Auth admin API + backend profile creation). Business rules CRUD (late fee amount, damage fee, rental period, min downpayment). SMS template CRUD. | Backend scaffold ready |
| **Parallel: UI Refinements** | Implement mobile-first dashboard layout per UX spec, onboarding tutorial frontend, Help Guide page | None |

**Milestone:** Admin and Staff can fully manage the rental lifecycle end-to-end with real data flowing through the Node.js backend.

---

### Week 5: Customer Portal

| Track | Tasks | Dependencies |
|---|---|---|
| **Customer API Routes** | Customer-facing endpoints: public catalog (Available items only), date-specific availability check, booking creation, customer transaction history. | Inventory + Rental APIs ready |
| **Landing Page** | Polish existing landing page, ensure all CTAs route correctly through login/sign-up flow | Auth integration done |
| **Customer Catalog** | Wire catalog to backend API (Available items only). Search + category filter. Date-specific availability check calls availability endpoint. | Customer API ready |
| **Payment Integration** | Frontend calls backend to create PayMongo payment intent. Backend webhook handler listens for successful payment, updates transaction downpayment status, triggers SMS confirmation. | Payment setup done (Week 2) |
| **Booking Wizard** | Wire CustomerRentalFlow to backend API. Step 1-4 (catalog → details → payment → receipt). Create transaction on successful payment callback. | Customer API + Payment API ready |
| **Customer History** | Wire transaction history view to backend API (filtered by authenticated customer). QR code receipt display. | Customer API ready |
| **AI Chatbot** | Wire ChatbotModal to Gemini API. Ensure fallback FAQ works when API is unavailable. | Already built in prototype, minor wiring |

**Milestone:** A customer can sign up, browse, book, pay via PayMongo, and see their receipt — all end-to-end through the Node.js backend.

---

### Week 6: AI Intelligence

| Track | Tasks | Dependencies |
|---|---|---|
| **AI Insights API** | Backend endpoint that aggregates transaction + inventory data into the format needed for AI Insights view (category utilization, popular items, underperforming items, SMA computation, revenue trends). | All transaction + inventory data flowing |
| **AI Insights Frontend** | Wire AI Insights dashboard to backend API. Replace all mock computed values with real data. | AI Insights API ready |
| **Gemini Report API** | Backend endpoint: receives data payload, calls Gemini API, returns formatted report. Protects Gemini API key server-side. Rate limiting (60s) enforced. Wire AIReportModal to this endpoint. | AI Insights API ready |
| **Demand Forecast** | SMA computation (3-month window) on backend using historical transaction data. Serve via API. Chart updates dynamically. | AI Insights API ready |
| **Chatbot Backend Proxy** | Optional: route chatbot calls through backend to protect Gemini API key. Or keep direct frontend calls with restricted API key (risk is low). | Backend scaffold |
| **Parallel: PWA Setup** | Configure vite-plugin-pwa. Generate manifest icons. Test install prompt on mobile. | Project config done |

**Milestone:** Admin can generate AI reports and view real-time demand forecasts based on actual boutique data, all routed through the Node.js backend.

---

### Week 7: SMS, Notifications & Offline

| Track | Tasks | Dependencies |
|---|---|---|
| **SMS API Routes (Backend)** | Semaphore API integration service. Endpoints: send SMS (template or custom), trigger batch reminders. Auto-trigger on booking confirmation (via webhook or post-creation hook). Auto-trigger return reminder (cron job or check on dashboard load). Late return notification trigger. | Backend scaffold ready |
| **Manual SMS Sender (Frontend)** | Build SMS sender component with template dropdown + preview + custom message field. Wire to backend API. | SMS API ready |
| **Notification System (Backend)** | Notification records created automatically on key events (rental created, return due, item damaged, payment received). API endpoint to list notifications for authenticated user. Mark-read endpoint. | Transaction lifecycle complete |
| **In-App Notifications (Frontend)** | Wire notification bell dropdown to backend API. Real-time badge count. Grouped by date. | Notification API ready |
| **Offline Service Worker** | Configure vite-plugin-pwa with cache-first strategy for app shell. Cache last-fetched reservation list, inventory, customer contacts. | PWA setup done |
| **Offline Queue (IndexedDB)** | Implement offline queue in frontend: store rental/return actions when offline. Sync queue to backend API when connectivity returns. Show queue status in UI. | Offline SW working |
| **Offline Indicator** | Network listener component. Header orange dot when offline. Pending sync count badge. Auto-dismiss banner on first transition. | Offline queue working |

**Milestone:** SMS notifications flow automatically, staff can work offline with queued sync, and the notification system is fully functional.

---

### Week 8: Polish, Testing & Deploy

| Track | Tasks | Dependencies |
|---|---|---|
| **Onboarding Tutorial** | Implement 4-card swipeable tutorial for first-time staff login. Revisitable Help Guide page with FAQ. | All features working |
| **Error State Audit** | Ensure every view handles empty, loading, error, and offline states per UX spec. Test all error recovery paths. | All features done |
| **Staff In-Person Testing** | Deploy to Vercel preview. Bring Mylene + 1-2 staff to test on their phones. Observe, take notes, fix critical issues. | All features done |
| **Bug Fixes** | Address issues found during testing. Prioritize by impact on core flows. | Testing done |
| **Production Deploy** | Final Vercel production deploy. Custom domain (if any). Supabase production project promotion. | Bug fixes done |
| **Documentation** | Brief admin/staff usage guide (can be the Help Guide content). | All features done |

**Milestone:** MVP is live and usable by Mylene's Boutique.

---

## 6. Testing Strategy

| Phase | Who | Method | Focus |
|---|---|---|---|
| **Unit testing** | Solo dev | Manual component testing as each view is wired | Individual views work with real data |
| **Integration testing (Week 6-7)** | Solo dev | Walk through each core flow end-to-end | No broken chains between frontend → Supabase → 3rd-party APIs |
| **Staff in-person testing (Week 8)** | Mylene + 2-3 staff | Observe real usage on their phones. Think-aloud protocol. | Can they complete tasks without help? Where do they get stuck? |
| **Customer testing (Week 8)** | 3-5 friendly customers | Invite to test the booking flow on their phones | Is the sign-up → browse → book → pay flow frictionless? |
| **Bug bash** | Solo dev + testers | Free-form exploration | Edge cases, error states, offline behavior |

**Feedback capture:**
- Note observations during in-person testing (pain points, confusion, workarounds)
- Brief post-test interview: "What was the hardest part?" "What would you change?"
- For customers: optional 2-question survey after booking (CSAT + NPS)

---

## 7. Deployment Approach

| Stage | Environment | When | Who accesses |
|---|---|---|---|
| **Development** | `localhost` + Supabase free tier | Weeks 1-7 | Solo dev |
| **Preview** | Vercel preview URL | Week 8 (testing) | Dev + testers |
| **Staging** | `staging.rentech.app` (subdomain) | Week 8 (post-testing fixes) | Dev + Mylene |
| **Production** | `rentech.app` (or custom domain) | End of Week 8 | All users |

**Deployment pipeline:**
- Git push to `main` → Vercel auto-deploys preview
- Manual promotion to production when ready
- Supabase: separate `prod` and `dev` projects (or same project with RLS environment gating)

**Rollback plan:**
- Vercel: instant rollback to previous deployment via dashboard
- Supabase: database backups configured, point-in-time recovery available

---

## 8. Success Metrics

| Metric | Target | How to Measure |
|---|---|---|
| **Staff adoption rate** | ≥80% of daily rentals created in system within 2 weeks of launch | Compare system transaction count vs. estimated manual volume |
| **Customer online bookings** | ≥10 per week by week 4 post-launch | Supabase transactions query |
| **No-show rate** | <5% | % of bookings where item was never picked up |
| **Staff task completion** | 100% of test staff complete a rental + return without help | Observed during in-person testing |
| **AI report generation** | ≥1 per week | AIReportModal usage log |
| **Chatbot engagement** | ≥20 conversations/week | Chatbot message count |
| **Offline reliability** | Zero data loss from offline queue | Offline sync audit |
| **Customer satisfaction** | ≥4/5 average | Post-rental survey |

---

## 9. Key Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| **Staff struggle with mobile UI** | High | Low adoption | Large touch targets (56px), onboarding tutorial, in-person training session, Help Guide written in simple Tagalog/English |
| **Payment gateway integration delays** | Medium | Blocked customer booking | Start PayMongo integration early (Week 2). Build webhook handler with detailed logging. Have fallback: manual "pay via GCash reference" flow as Plan B. |
| **Gemini API rate limits / downtime** | Medium | AI features broken | Local FAQ fallback for chatbot. Cached/mock reports for AI Insights. Graceful degradation badge. |
| **Offline sync conflicts** | Medium | Data loss / duplication | Last-write-wins strategy for simplicity. Audit log for conflict detection. Manual reconciliation note in Help Guide. |
| **Solo dev burnout (2 months full-time)** | High | Missed deadline | Parallel tracks reduce end-of-project crunch. Weekly "must-ship" vs. "nice-to-have" triage. Scope is locked — no feature creep. |
| **Internet connectivity during testing** | Medium | Can't demo | Pre-load test data. Offline mode should still work. Demo on mobile hotspot as backup. |
| **Supabase RLS misconfiguration** | Medium | Data exposure | Test RLS policies thoroughly. Since backend is the primary data gate, RLS is a defense-in-depth layer, not the sole protector. |
| **Node.js backend deployment complexity** | Medium | Delayed launch | Start with Railway (simple Git deploy, PostgreSQL-friendly). Keep backend stateless for easy scaling. Dockerize early for consistency. |
| **Prisma migration issues** | Low | Schema drift | Use Prisma Migrate with version control. Test migrations on staging before production. Keep seed data script for fresh setups. |

---

## 10. Team Roles & Responsibilities

| Role | Person | Responsibilities |
|---|---|---|
| **Solo Developer** | You | Frontend (React), Supabase integration, API wiring (PayMongo, Gemini, Semaphore), PWA setup, deployment, testing coordination, documentation |
| **Product Owner** | You | Feature prioritization, scope management, timeline decisions |
| **Tester / SME** | Mylene (Admin) | Feature validation, business rule confirmation, staff training materials |
| **Testers** | Boutique staff (2-3) | Usability testing, real-world workflow validation |
| **Testers** | Friendly customers (3-5) | Customer flow validation |

---

## 11. Budget Outline (High-Level)

| Item | Estimated Cost | Notes |
|---|---|---|---|
| **Node.js Backend Hosting (Railway)** | ~$5-10/month (~₱280-560) | Starter plan covers 1GB RAM, shared CPU. Sufficient for MVP traffic. Or use Fly.io free tier (limited). |
| **Supabase (free tier)** | ₱0 | 500 MB database, 1 GB storage, 50,000 monthly active users — sufficient for MVP |
| **Vercel (free tier)** | ₱0 | 100 GB bandwidth, 6000 build minutes/month |
| **PayMongo** | ~3.5% per transaction + ₱15/disbursement | Standard payment gateway fees |
| **Semaphore API** | ~₱0.35/SMS | Pay-as-you-go. Estimate 100-200 SMS/month for MVP = ~₱35-70/month |
| **Gemini API** | Free tier (gemini-2.5-flash) | 15 requests per minute, 1M tokens/minute — sufficient for MVP |
| **Custom domain** | ~₱500-800/year | .com or .ph domain |
| **Design resources** | ₱0 | Existing prototype covers all UI |
| **Total estimated monthly** | ~₱315-630 + transaction fees | Backend hosting is the only fixed cost beyond SMS/transaction fees |

---

## 12. Next Steps Post-MVP

Based on MVP launch results, the decision criteria are:

| If metrics show... | Decision |
|---|---|
| **Strong adoption** (staff ≥80%, bookings ≥10/week, satisfaction ≥4/5) | **Iterate & expand**: Add v2 features (dynamic pricing, recommendations, barcode scanning) |
| **Mixed adoption** (staff high, customers low, or vice versa) | **Targeted iteration**: Improve the underperforming side. If customers aren't booking, investigate UX friction or marketing. If staff aren't adopting, more training/UI simplification. |
| **Low adoption overall** | **Pivot or stop**: Interview users to understand why. If the hypothesis is wrong (digital system doesn't help), consider a simpler tool (e.g., shared spreadsheet + chatbot only). |
| **Technical issues** (offline sync problems, payment failures) | **Fix and re-test**: Address root cause, deploy patch, re-measure. |

**Immediate post-MVP actions (regardless of outcome):**
1. Retrospective with Mylene + staff (what worked, what didn't)
2. Prioritized backlog for next iteration based on real feedback
3. Fix any critical bugs found during first week of live use
