# MVP Concept Description: RENTECH — Mylene's Boutique

---

## 1. Core MVP Hypothesis/Goal

**Hypothesis:** A single-platform digital rental system with built-in AI intelligence (Gemini-powered reports, chatbot, SMA forecasting) can fully replace Mylene's Boutique's manual logbook-based process — simultaneously improving staff operational efficiency and providing a modern self-service experience for customers — from day one.

**Primary Learning Objective:** Validate that the full end-to-end rental lifecycle (customer browse → book → pay deposit → staff fulfill → track → return → AI-driven insights) can be executed within a single PWA, and that both less tech-savvy staff and occasional customers can adopt it with minimal training.

---

## 2. Target Audience (MVP Subset)

| Persona | Count (Est.) | Role in MVP |
|---|---|---|
| **Admin (Mylene)** | 1 | Full oversight, staff management, AI reports, inventory control |
| **Staff** | 2–5 | Daily rental processing, returns, condition tracking, SMS alerts |
| **Customers** | 50–100 (initial) | Browse catalog, book online, pay downpayment, receive SMS, use AI stylist |

Early adopters: Existing walk-in customers of Mylene's Boutique who currently book via phone or in person. Staff are existing employees transitioning from manual logbooks.

---

## 3. Problem Solved (MVP Focus)

| Problem (from PRD) | MVP Solution |
|---|---|
| Fragmented manual logbook process for rentals | Centralized digital transaction management with real-time inventory |
| No online catalog or availability checking for customers | Customer-facing PWA with browse, search, date-specific availability |
| No-show bookings without commitment | Online downpayment (min ₱200) secures reservations |
| Late returns hard to track and penalize consistently | Automated late penalty calculation (₱500/day) + SMS reminders |
| Staff need offline access for unreliable internet | PWA offline mode for reservation lookup, returns, contact info |
| No data-driven business decisions | Gemini AI reports + SMA demand forecasting + revenue dashboards |
| Customers need sizing/styling help after hours | AI chatbot (Gemini with FAQ fallback) available 24/7 |

---

## 4. Minimum Feature Set

### IN (All features shipped in MVP)

**User Management**
- Full sign-up flow (name, email, phone, address, password, email verification)
- Secure login with JWT
- RBAC: Admin, Staff, Customer roles
- Admin: create/edit/remove staff accounts

**Inventory Management**
- Add, edit, delete items (name, category, price, image, status)
- Categories: Gown, Suit, Barong, Filipiniana, Costume
- Real-time status updates: Available → Rented → Cleaning → Available
- Item sizes (XS–XXL + custom measurements)

**Staff Operations**
- Action-oriented mobile dashboard (active rentals, today's returns, quick actions)
- 3-step wizard: New Rental (select item → enter customer + dates → confirm + photo)
- Return processing with late/damage fee toggles + condition photo capture
- Read-only inventory view with search/filter
- Transaction history with search by customer or item
- Offline mode: view reservations, process returns, create rentals (queued)

**Customer Portal**
- Landing page with collection showcase, how-it-works, FAQ
- Catalog with search, category filtering, date-specific availability checks
- 4-step booking modal: catalog → details + size + date → payment → receipt
- Online downpayment via GCash or card (min ₱200)
- Booking history with QR receipt
- AI chatbot stylist (Gemini API + FAQ fallback)

**AI Intelligence**
- AI Insights view with demand forecast chart (SMA, 3-month window)
- AI-generated business reports via Gemini API (revenue, inventory, trends)
- Utilization rates by category
- Underperforming item identification and promotion suggestions
- Optimization tips (most/least popular items)

**Notifications & SMS**
- SMS booking confirmation via Semaphore API
- SMS return deadline reminders (auto-triggered + manual send)
- Late return notifications
- In-app notification bell with grouped alerts
- SMS template management (pre-defined + custom)

**Admin Dashboard**
- KPI cards: Active Rentals, Pending Returns, Monthly Revenue, Damaged Items
- Demand forecast bar chart with SMA projection
- AI insights panel with trend alerts and action suggestions
- Staff account management in Settings
- Business rules configuration (penalties, rental period, min downpayment)
- SMS template editing

**PWA Capabilities**
- Installable (service worker + manifest)
- Staff offline: cached reservation list, contact info, return/rental queue
- Auto-sync when connectivity returns
- Offline indicator in header (subtle orange dot)

**Design & UX**
- Existing prototype design retained (color palette, typography, spacing)
- Single portal with role-based navigation
- Mobile-first responsive layout (staff bottom nav, desktop sidebar)
- 4-card onboarding tutorial for new staff
- Revisitable Help Guide
- 56px minimum touch targets for staff screens
- Framer Motion transitions
- Skeleton loading states, empty states, error states

### OUT (Deliberately excluded from MVP)

| Feature | Rationale |
|---|---|
| Dynamic pricing rules | Future enhancement, not required for core flow |
| Automated recommendation system | AI chatbot covers this minimally; full system deferred |
| Multi-language support | Not needed for local Balayan customer base |
| Barcode/QR scanner (hardware) | Simulated QR display suffices for MVP |
| Inventory barcode labeling | Physical process, not software-dependent |
| Third-party calendar sync | Out of scope for initial release |
| Advanced reporting beyond Gemini | SMA + Gemini sufficient for MVP |
| Customer reviews/ratings | Not part of core rental workflow |

---

## 5. Key Constraints (MVP Specific)

| Constraint | Detail |
|---|---|
| **Timeline** | TBD |
| **Team** | Solo developer (frontend + backend + design) |
| **Tech stack** | React 19 + Vite 8 + Tailwind CSS (existing frontend); Node.js/TypeScript backend (to be built); database TBD |
| **API dependencies** | Google Gemini API, Semaphore API, payment gateway (TBD) |
| **Offline** | Limited to staff reservation/return/contact viewing; full offline sync is complex |
| **Hosting** | TBD |
| **Photo storage** | TBD — cloud or local |
| **Payment gateway** | TBD — evaluating GCash, card processors |

---

## 6. Initial Success Metrics Ideas

| Metric | How to Measure |
|---|---|
| **Staff adoption** | % of daily rentals created in system vs. manual logbook (target: 80% within 2 weeks) |
| **Customer bookings** | Number of online bookings per week (target: 10+/week by week 4) |
| **No-show rate** | % of reservations that result in no pickup (target: <5%) |
| **AI report usage** | Admin generates ≥1 Gemini report per week |
| **Chatbot engagement** | ≥20 conversations initiated per week |
| **Offline reliability** | Zero data loss incidents from offline queue |
| **User satisfaction** | Staff: "able to complete task" rating ≥4/5; Customer: post-rental survey ≥4/5 |

---

## 7. Build Priority (Phased Within MVP)

Since the MVP ships everything together, this is the recommended build order within the development cycle:

| Phase | Focus | Deliverables |
|---|---|---|
| **Phase 1** | Backend foundation | Auth system, database schema, API scaffolding, RBAC |
| **Phase 2** | Admin + Staff core | Inventory CRUD, rental processing, return flow, dashboard, Settings |
| **Phase 3** | Customer portal | Landing page polish, catalog, booking wizard, payment integration |
| **Phase 4** | AI & Intelligence | Gemini API integration, SMA forecasting, AI Insights view, chatbot |
| **Phase 5** | PWA + Offline | Service worker, manifest, offline caching, sync queue |
| **Phase 6** | SMS + Notifications | Semaphore API integration, auto-reminders, notification system |
| **Phase 7** | Polish + Hardening | Onboarding tutorial, Help Guide, error states, accessibility, testing |
