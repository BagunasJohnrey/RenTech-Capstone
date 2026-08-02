# UX & UI Specification: RENTECH — Mylene's Boutique Rental Management System

---

## 1. Information Architecture

### 1.1 Screen Map & Hierarchy

```
LANDING PAGE (Public)
│
├─ Login Page
│   ├─ Sign In (email + password)
│   └─ "Don't have an account?" → Sign Up flow
│
├─ SIGN UP FLOW (Customer only)
│   Step 1: Name, Email, Phone, Address
│   Step 2: Password, Confirm Password
│   Step 3: Email verification prompt
│   Step 4: Welcome / redirect to Home
│
├─ ADMIN VIEW (role-gated)
│   ├─ Dashboard            (default tab)
│   ├─ Catalog/Inventory    (CRUD)
│   ├─ Transactions         (history + search)
│   ├─ AI Insights          (forecasts, reports, optimizations)
│   ├─ Settings             (staff accounts, system config)
│   └─ Help Guide           (revisitable tutorial)
│
├─ STAFF VIEW (role-gated)
│   ├─ Dashboard            (default tab — action-oriented + today's items)
│   ├─ Tasks                (pending returns, upcoming reservations)
│   ├─ Catalog              (read-only, filter/search)
│   ├─ Logs & Returns       (transaction history, return processing)
│   ├─ Settings             (preferences)
│   ├─ Help Guide           (revisitable tutorial)
│   └─ [Floating Action]    Quick actions: New Rental, Process Return
│
├─ CUSTOMER VIEW (role-gated)
│   ├─ Home                 (AI stylist prompt + recommendations)
│   ├─ Collection           (catalog with availability check)
│   ├─ Transactions         (booking history, receipts)
│   ├─ Profile              (edit info, view upcoming rentals)
│   └─ Help Guide           (revisitable tutorial)
│
└─ GLOBAL OVERLAYS (any role)
    ├─ Notifications Dropdown
    ├─ AI Chatbot Modal (Customer) / disabled for Staff/Admin
    ├─ Process Return Modal (Staff)
    ├─ New Rental Modal or Full Wizard (Staff)
    ├─ Customer Booking Modal (Customer)
    ├─ Add/Edit Item Modal (Admin/Staff)
    └─ Confirmation / Error Toasts
```

### 1.2 Navigation Structure

**Desktop Layout (sidebar + header)**

```
┌─────────────────────────────────────────────────────┐
│ [Logo]         [Role Badge]    [+Add Item] [Bell]   │ ← Sticky Header
├──────────┬──────────────────────────────────────────┤
│ Sidebar   │                                          │
│           │   Main Content Area                       │
│ Icon +    │   (scrollable, max-w-7xl centered)       │
│ Label     │                                          │
│           │                                          │
│ [Icon]    │                                          │
│  Tab      │                                          │
│           │                                          │
│ [Icon]    │                                          │
│  Tab      │                                          │
│           │                                          │
│ ...       │                                          │
│           │                                          │
│ ────────  │                                          │
│ Help ?    │                                          │
│ Logout    │                                          │
├──────────┴──────────────────────────────────────────┤
│ Mobile Bottom Nav                                    │
│ [Tab1] [Tab2] [FAB] [Tab3] [Tab4]                   │
└─────────────────────────────────────────────────────┘
```

**Mobile Layout (bottom nav + header)**

```
┌─────────────────────────────────────────────────────┐
│ [Role/Menu]              [+Add] [Bell]              │ ← Sticky Header
├─────────────────────────────────────────────────────┤
│                                                      │
│   Main Content                                       │
│   (full width, scrollable)                          │
│                                                      │
├─────────────────────────────────────────────────────┤
│ [Home] [Catalog] [FAB] [History] [Profile]          │ ← Bottom Nav
└─────────────────────────────────────────────────────┘
```

- **Sidebar** (desktop): Fixed left, ~240px, shows nav items based on role, Help and Logout pinned at bottom.
- **Bottom Nav** (mobile): Fixed bottom, 5 tabs max. The center tab is a FAB (floating action button) that triggers the primary action per role (Admin → AI Insights, Staff → New Rental, Customer → Book Item).
- **Header**: Sticky, contains role badge/selector, contextual actions (+Add Item for Admin/Staff), notification bell, and **offline indicator dot** (subtle orange dot beside the bell when offline).

### 1.3 Offline Indicator

```
Status: Online  →  Bell icon normal (no indicator)
Status: Offline →  Small orange dot pulse on bell icon
                    + brief toast on transition: "You're offline. Changes will sync when connected."
```

- The dot is a 6px circle overlaid on the bell icon's top-right corner
- Persistent while offline, subtle pulsing animation every 3 seconds
- A sync queue badge (number) appears when pending offline actions exist

### 1.4 Responsive Breakpoints

| Breakpoint | Layout | Notes |
|---|---|---|
| < 768px | Single column, bottom nav | Staff primary experience |
| 768px – 1024px | Condensed sidebar, 2-column grids | Tablet |
| > 1024px | Full sidebar, multi-column | Desktop management |

---

## 2. Staff Mobile UX Deep Dive (Primary Focus)

### 2.1 Staff Onboarding Tutorial

**Trigger:** First login only (stored in localStorage).

**Format:** 4 full-screen swipeable cards, each with:
- Large illustration icon
- Bold headline (2-3 words)
- One-sentence description (max 15 words)
- "Got it" button or dot indicators

```
Card 1: "Your Dashboard"
  ┌─────────────────────┐
  │   📊 (large icon)   │
  │                     │
  │  Your daily tasks   │
  │  are right here.    │
  │                     │
  │     [ Got It ]      │
  └─────────────────────┘

Card 2: "New Rentals"
Card 3: "Processing Returns"
Card 4: "Need Help? Tap Help anytime in the sidebar menu."
```

After last card: "You're all set!" → dismiss to dashboard.

**Revisitable:** Sidebar → Help Guide shows the same 4 cards as a scrollable reference, plus a FAQ section with common "how do I..." questions.

### 2.2 Staff Dashboard (Mobile-First)

```
┌─────────────────────────────────────┐
│ Staff Portal          🔔 ● (offline)│
├─────────────────────────────────────┤
│                                     │
│  ┌───────┐  ┌───────┐              │
│  │ Active │  │ Today's│              │
│  │  12    │  │ Returns│              │
│  │Rentals │  │   5    │              │
│  └───────┘  └───────┘              │
│                                     │
│  ┌─────────────────────────┐        │
│  │  + New Rental           │        │ ← Big primary CTA
│  │  [large tap target]     │        │
│  └─────────────────────────┘        │
│                                     │
│  ┌─────────────────────────┐        │
│  │  ↩ Process Return       │        │ ← Secondary CTA
│  └─────────────────────────┘        │
│                                     │
│  ─── Upcoming Today ───             │
│  ┌─────────────────────────┐        │
│  │ Ana Rivera              │        │
│  │ Item: Vintage Dress     │        │
│  │ Due: Today 5PM          │        │
│  │ [Process Return]        │        │
│  └─────────────────────────┘        │
│                                     │
│  ... more items scrollable          │
└─────────────────────────────────────┘
```

**Key principles:**
- Two big tap-target buttons at top (min 56px height, full-width)
- Action-oriented: the first thing staff sees is what they can *do*
- Below actions: scrollable list of today's time-sensitive items
- Text is larger than typical mobile UI (16px minimum body, 20px+ for buttons)

### 2.3 Staff New Rental Flow (Wizard)

Designed as a **3-step wizard** with large progress indicator at top. Each step is a single focused screen — no scrolling within a step.

**Step 1: Pick Item**

```
┌─────────────────────────────────────┐
│ New Rental           ← Back    X   │
├─────────────────────────────────────┤
│  ○  ●  ○                              │ ← Step indicator (1 of 3)
│                                     │
│  Search: [____________]              │
│                                     │
│ [Gown] [Suit] [Barong] [All]        │ ← Large chip buttons
│                                     │
│  ┌──────────┐  ┌──────────┐         │
│  │ 📸 Item  │  │ 📸 Item  │         │ ← 2-column grid
│  │ Name     │  │ Name     │         │
│  │ ₱3,500   │  │ ₱2,800   │         │
│  └──────────┘  └──────────┘         │
│                                     │
│  ... scrollable grid                 │
│                                     │
│          [ Next: Details ]          │ ← Large CTA
└─────────────────────────────────────┘
```

**Step 2: Customer & Dates**

```
┌─────────────────────────────────────┐
│ New Rental           ← Back    X   │
├─────────────────────────────────────┤
│  ○  ●  ○                              │
│                                     │
│  Customer Name:  [_______________]   │
│  Contact:        [_______________]   │
│  Address:        [_______________]   │
│                                     │
│  📅 Pickup Date:  [Date Input or   │
│                    Calendar Popup]  │
│  📅 Return Date:  [Auto: +3 days]  │
│                                     │
│  Size: [XS] [S] [M] [L] [XL]       │ ← Large chips
│                                     │
│  Optional: Downpayment ₱ [____]    │
│                                     │
│          [ Next: Confirm ]          │
└─────────────────────────────────────┘
```

**Step 3: Confirm & Photo**

```
┌─────────────────────────────────────┐
│ New Rental           ← Back    X   │
├─────────────────────────────────────┤
│  ○  ○  ●                              │
│                                     │
│  ┌─ Receipt Summary ──────────────┐ │
│  │  ✓ Item: Emerald Gown          │ │
│  │  ✓ Customer: Ana Rivera        │ │
│  │  ✓ Pickup: May 10              │ │
│  │  ✓ Return: May 13              │ │
│  │  ✓ Balance: ₱4,500             │ │
│  └────────────────────────────────┘ │
│                                     │
│  📸 Take Condition Photo            │ ← Big camera button
│  ┌─────────────────────────┐        │
│  │  [Tap to capture or     │        │
│  │   upload photo]         │        │
│  └─────────────────────────┘        │
│                                     │
│  Notes: [____________________]      │
│                                     │
│    [ Confirm & Create Rental ]      │ ← Green CTA
└─────────────────────────────────────┘
```

**After confirmation:** Toast "Rental Created!" + auto-close after 2 seconds.

### 2.4 Staff Process Return Flow

Triggered from Dashboard (Process Return button) or from Logs & Returns screen.

```
┌─────────────────────────────────────┐
│ Process Return         ← Back  X   │
├─────────────────────────────────────┤
│                                     │
│  Transaction: TX-1001               │
│  Customer: Ana Rivera               │
│  Item: Vintage Sequin Dress         │
│  Due Date: May 1, 2026              │
│                                     │
│  ── ⏰ Is this late? ──             │
│  [  Yes  ]  [  No  ]                │ ← Large toggle
│                                     │
│  ── 🧵 Condition ──                │
│  [  Good  ]  [  Damaged  ]          │ ← Large toggle
│                                     │
│  (if Damaged → show photo upload)   │
│                                     │
│  📸 Capture Return Condition        │
│  ┌─────────────────────────┐        │
│  │  [Tap to capture photo] │        │
│  └─────────────────────────┘        │
│                                     │
│  ── Fees Summary ──                 │
│  Late Penalty:     ₱500             │
│  Damage Fee:       ₱1,000           │
│  Total:            ₱1,500           │
│                                     │
│  ┌─────────────────────────┐        │
│  │  ✓ Confirm Return       │        │
│  └─────────────────────────┘        │
└─────────────────────────────────────┘
```

**Key principles:**
- Yes/No toggles instead of checkboxes (larger tap targets, clearer action)
- Fees auto-calculate and display immediately
- Photo step is optional but encouraged
- Confirmation button is green/positive feedback

### 2.5 Staff Offline Mode

```
┌─────────────────────────────────────┐
│ Staff Portal        🔔 (orange ●)  │ ← Offline indicator
├─────────────────────────────────────┤
│                                     │
│  ⚠ You're offline.                  │ ← Subtle banner (first 5s)
│  Your changes will sync             │
│  when connection returns.           │
│                                     │
│  ┌─────────────────────────┐        │
│  │  + New Rental (offline) │        │ ← Works, queued
│  └─────────────────────────┘        │
│                                     │
│  ┌─────────────────────────┐        │
│  │  ↩ Process Return      │        │ ← Works, queued
│  └─────────────────────────┘        │
│                                     │
│  ─── Pending Sync (2) ───           │ ← Queue indicator
│  • New Rental: Ana Rivera           │
│  • Return: TX-1002                  │
│                                     │
│  📋 Reservation List (cached)       │ ← Read from cache
│  📞 Customer Contacts (cached)      │
└─────────────────────────────────────┘
```

**Offline-capable operations:**
- View cached reservation list (last loaded data)
- View cached customer contact info
- Create rental (queued)
- Process return (queued)
- Offline queue visible in a collapsible section

**Sync behavior:** When connectivity returns, auto-sync in background with a toast: "Synced 2 items."

---

## 3. Customer Flow Specification

### 3.1 Sign-Up Flow

```
Landing Page → "Sign Up" link on Login
┌─────────────────────────────────────┐
│ Create Your Account                 │
│                                     │
│  Step 1 of 4                        │
│                                     │
│  Full Name    [________________]    │
│  Email        [________________]    │
│  Phone        [________________]    │
│  Address      [________________]    │
│                                     │
│            [ Next ]                 │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Step 2 of 4                         │
│                                     │
│  Password     [________________]    │
│  Confirm      [________________]    │
│                                     │
│  ✓ Must be 8+ characters            │
│                                     │
│            [ Next ]                 │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Step 3 of 4                         │
│                                     │
│  📧 Check your email                │
│                                     │
│  We sent a verification code to     │
│  [email@example.com]                │
│                                     │
│  Code: [____]                       │
│                                     │
│  Resend code in 30s                 │
│                                     │
│         [ Verify ]                  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Step 4 of 4                         │
│                                     │
│  🎉 Welcome, [Name]!                │
│                                     │
│  You're all set. Start browsing     │
│  our collection and book your       │
│  perfect outfit.                    │
│                                     │
│    [ Start Browsing ]               │
└─────────────────────────────────────┘
```

### 3.2 Customer Booking Flow (Modal-based)

Same as existing prototype structure with refinements:

```
Step 0: Browse Catalog (if no preselected item)
  - Full catalog with search + category chips
  - Items show availability badges
  - Tap item to select → "Continue" btn

Step 1: Booking Details
  - Selected item summary (image, name, price)
  - "Me / Someone else" toggle
  - Pre-filled name/contact/address from profile
  - Editable fields
  - Size selector (large chips)
  - Date picker (calendar widget)
  - Notes field
  - Downpayment: min ₱200 input

Step 2: Payment Method
  - GCash / Card options (large cards with icons)
  - Downpayment amount summary
  - "Pay ₱X" button
  - Processing overlay with spinner
  - Success overlay with checkmark

Step 3: Receipt
  - Booking confirmed message
  - Transaction summary
  - QR code (display only, visual confirmation)
  - Transaction ID
  - "Done" button → redirects to My Transactions
```

### 3.3 Calendar Widget (Shared Component)

Used in: Customer booking, Staff new rental, Admin reservation view.

**Desktop view:**

```
┌─────── May 2026 ───────┐
│  <  May 2026  >         │
│ Su Mo Tu We Th Fr Sa   │
│        1  2  3  4  5   │
│  6  7  8  9 10 11 12   │
│ 13 14 15 16 17 18 19   │
│ 20 21 22 23 24 25 26   │
│ 27 28 29 30 31         │
│                         │
│ Selected: May 10, 2026  │
│ [◄ Today]  [Confirm ►] │
└─────────────────────────┘
```

**Mobile view (compact):**

```
┌─────── May 2026 ───────┐
│  <  May 2026  >         │
│ Mo Tu We Th Fr Sa Su   │
│              1  2  3   │
│  4  5  6  7  8  9 10   │
│ 11 12 13 14 15 16 17   │
│ 18 19 20 21 22 23 24   │
│ 25 26 27 28 29 30 31   │
│                         │
│     [✓ Select Date]     │
└─────────────────────────┘
```

- Dates with existing bookings show a small dot indicator
- Unavailable dates (already fully booked) are grayed out with a strikethrough
- Today is highlighted with a ring
- Tapping a date selects it and shows a popover with any existing bookings for that item

---

## 4. Admin Views

### 4.1 Admin Dashboard

Same layout as prototype, with these refinements:

```
┌──────────────────────────────────────────────────────┐
│ Overview                    [AI Insights] [Settings]  │
├──────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Active   │ │ Pending  │ │ Monthly  │ │ Damaged  │ │
│  │ Rentals  │ │ Returns  │ │ Revenue  │ │ Items    │ │
│  │    12    │ │     5    │ │  ₱45,200 │ │    2     │ │
│  │  +12% ▲ │ │ ⚠ Action │ │  +24% ▲ │ │ ⚠ Alert │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│                                                        │
│  ┌─ Demand Forecast ─────────┐ ┌─ AI Insights ─────┐  │
│  │                           │ │                    │  │
│  │  📊 Bar chart (Jan-Jun)   │ │ 💡 Trend Alert    │  │
│  │  with SMA projection for  │ │ Prom season peaks  │  │
│  │  next month               │ │ in 3 weeks...      │  │
│  │                           │ │                    │  │
│  │  Jun forecast: 18 rentals │ │ 💡 Action: Promote │  │
│  │                           │ │ Navy Suits bundle  │  │
│  └───────────────────────────┘ └────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 4.2 Staff Account Management (Settings)

```
┌──────────────────────────────────────┐
│ System Settings                      │
├──────────────────────────────────────┤
│                                       │
│  ── Staff Accounts ──                 │
│                                       │
│  [ + Add Staff Member ]               │
│                                       │
│  ┌───────────────────────────┐        │
│  │ 👤 Staff Name             │        │
│  │    Username: staff01       │        │
│  │    [Edit] [Remove]        │        │
│  └───────────────────────────┘        │
│  ┌───────────────────────────┐        │
│  │ 👤 Another Name           │        │
│  │    Username: staff02       │        │
│  │    [Edit] [Remove]        │        │
│  └───────────────────────────┘        │
│                                       │
│  ── Business Rules ──                 │
│  Late Penalty/day:  ₱ [500   ]       │
│  Damage Fee:        ₱ [1000  ]       │
│  Default Rental:    [3] days         │
│  Min Downpayment:   ₱ [200   ]       │
│                                       │
│  ── SMS Templates ──                  │
│  ┌─ Due Reminder ──────────────────┐  │
│  │ Hi {customer}, your rental of   │  │
│  │ {item} is due on {date}. Please │  │
│  │ return on time to avoid fees.   │  │
│  └─────────────────────────────────┘  │
│  [Edit] [Add Template]               │
│                                       │
│  [ Save Changes ]                     │
└──────────────────────────────────────┘
```

---

## 5. Shared Components & Interaction Patterns

### 5.1 SMS Sender Component

Trigger: Transaction detail view, Dashboard "Notify" button.

```
┌─────────────────────────────────────┐
│ Send SMS to Ana Rivera              │
├─────────────────────────────────────┤
│                                     │
│  Customer: Ana Rivera               │
│  Phone: 0917 123 4567               │
│  Current Rental: Vintage Gown       │
│  Due: May 13, 2026                  │
│                                     │
│  ── Quick Message ──                 │
│  [Due Reminder      ▼]              │ ← Dropdown of templates
│                                     │
│  ┌─ Preview ─────────────────────┐  │
│  │ Hi Ana, your rental of       │  │
│  │ Vintage Gown is due on       │  │
│  │ May 13. Please return on     │  │
│  │ time to avoid penalties.     │  │
│  └──────────────────────────────┘  │
│                                     │
│  ── Or custom message ──            │
│  [____________________________]     │
│  [____________________________]     │
│                                     │
│       [ Send SMS ]                  │
└─────────────────────────────────────┘
```

### 5.2 Notification Bell & Dropdown

```
┌─────────────────────┐
│ 🔔 (3)              │ ← Badge count
├─────────────────────┤
│ Notifications       │
│                     │
│ 🔴 Today            │
│ ┌─────────────────┐ │
│ │ 📅 Return due   │ │
│ │ Ana Rivera -    │ │
│ │ Vintage Gown    │ │
│ │ 2 hours ago     │ │
│ └─────────────────┘ │
│                     │
│ 🔴 Yesterday        │
│ ┌─────────────────┐ │
│ │ ✅ Return done  │ │
│ │ Carlos Mendez   │ │
│ │ Barong Tagalog  │ │
│ └─────────────────┘ │
│                     │
│ [ Mark all read ]   │
└─────────────────────┘
```

### 5.3 State Patterns (Applied to All Screens)

| State | Pattern |
|---|---|
| **Empty** | Centered illustration + "No items yet" + CTA button |
| **Loading** | Skeleton cards (animated gray shimmer) matching final layout shape |
| **Populated** | Normal content with data |
| **Error** | Inline error banner with retry button, not a full page replacement |
| **Offline** | Subtle header indicator + banner on first transition (auto-dismiss after 5s) |

**Empty state example (Catalog):**
```
┌─────────────────────────────┐
│                             │
│        📦 (large icon)      │
│                             │
│   No items in inventory     │
│                             │
│   [ + Add First Item ]      │
│                             │
└─────────────────────────────┘
```

**Loading state example (Dashboard):**
```
┌─────────────────────────────┐
│ ┌─────────┐ ┌─────────┐    │
│ │ ░░░░░░  │ │ ░░░░░░  │    │ ← Gray shimmer blocks
│ └─────────┘ └─────────┘    │
│ ┌─────────────────────┐    │
│ │ ░░░░░░░░░░░░░░░░░░  │    │
│ └─────────────────────┘    │
└─────────────────────────────┘
```

### 5.4 Transition Animations

| Interaction | Animation |
|---|---|
| Page/view change | fade-in + slide-up (duration 0.4s, ease-out) |
| Modal open | backdrop blur + scale-in (0.95 → 1.0) + fade |
| Modal close | scale-out 0.95 + fade |
| Toast appear | slide-down from top, auto-dismiss after 2-3s |
| List item enter | staggered fade-slide-up (base 0.3s, stagger 0.05s) |
| Button press | scale 0.97 (momentary) |
| Step transition | slide-left (forward), slide-right (back) |
| Offline status change | subtle icon color shift + optional brief toast |
| Sync complete | brief green checkmark pulse on indicator |

---

## 6. Accessibility & Touch Targets

### 6.1 Touch Target Guidelines (Staff Mobile)

| Element | Minimum Size |
|---|---|
| Primary action buttons | 56px height, full-width preferred |
| Secondary buttons | 48px height |
| Toggle/radio chips | 44px height, min 120px width |
| Icon-only buttons | 44px x 44px touch area |
| Category chips | 36px height |
| List items (tappable) | 56px height |
| Form inputs | 48px height |
| Bottom nav items | 56px height |

### 6.2 Typography Scale

| Element | Size | Weight |
|---|---|---|
| Headings (h1) | 28-32px / 1.75-2rem | Extrabold (800) |
| Headings (h2) | 22-24px / 1.375-1.5rem | Bold (700) |
| Section titles | 16-18px / 1-1.125rem | Bold (700) |
| Body text | 16px / 1rem | Medium (500) |
| Small/labels | 13-14px / 0.8125-0.875rem | Semibold (600) |
| Tiny/meta | 11-12px / 0.6875-0.75rem | Medium (500) |
| Button text | 15-16px / 0.9375-1rem | Bold (700) |

### 6.3 Color Contrast

| Usage | Color | Background | Passes AA? |
|---|---|---|---|
| Body text | #111827 (gray-900) | #FFFFFF | Yes (15.3:1) |
| Muted text | #6B7280 (gray-500) | #FFFFFF | Yes (7.9:1) |
| Primary (CTA text) | #FFFFFF | #bf4a53 | Yes (5.2:1) |
| Primary bg | #bf4a53 | — | — |
| Links | #bf4a53 | #FFFFFF | Yes (5.2:1) for large text |
| Error text | #DC2626 | #FFFFFF | Yes |

### 6.4 Keyboard Navigation (Desktop)

| Key | Action |
|---|---|
| Tab | Move forward through focusable elements |
| Shift+Tab | Move backward |
| Enter/Space | Activate button, toggle, submit |
| Escape | Close modal, dropdown, cancel |
| Arrow keys | Navigate within date picker, list |

---

## 7. Design System Integration (Existing Prototype Conventions)

### 7.1 Color Palette

| Token | Value | Usage |
|---|---|---|
| `--primary` | `#bf4a53` | CTAs, active states, accent icons, links |
| `--primary-hover` | `#a63f47` | Button hover |
| `--primary-bg` | `#FAF0F1` | Light tint backgrounds, icon containers |
| `--bg` | `#fcfcfd` | Page background |
| `--card` | `#FFFFFF` | Card backgrounds |
| `--border` | `#f3f4f6` / `#e5e7eb` | Borders |
| `--text-primary` | `#111827` | Body text |
| `--text-muted` | `#6B7280` | Secondary text |
| `--success` | `#10B981` | Confirmation badges |
| `--warning` | `#F59E0B` | Warning indicators |
| `--error` | `#DC2626` | Error states |

### 7.2 Border Radius System

| Token | Value | Usage |
|---|---|---|
| `rounded-sm` | 6px | Small badges, tags |
| `rounded-xl` | 12px | Form inputs, cards (legacy) |
| `rounded-2xl` | 16px | Cards, modals (new standard) |
| `rounded-3xl` | 24px | Large cards, modals |
| `rounded-full` | 9999px | Buttons, pills, chips |

### 7.3 Shadow System

| Token | Value |
|---|---|
| Card shadow | `shadow-sm shadow-gray-950/5` |
| Elevated card | `shadow-md shadow-gray-950/10` |
| Modal | `shadow-2xl` |
| Button | `shadow-sm shadow-red-500/20` (primary) |

---

## 8. Technical Implementation Notes

### 8.1 Frontend Component Mapping

| PRD Ref | Component | Parent | State Mgmt |
|---|---|---|---|
| FR-01 | LoginForm | App | Local state |
| FR-01 | SignUpWizard | App | Multi-step form state |
| FR-02 | RoleRouter | App | Auth context |
| FR-03 | StaffAccountManager | SettingsView | API state |
| FR-05 | InventoryGrid | CatalogView | Filtered list |
| FR-05 | AddItemModal | App | Local form state |
| FR-05 | EditItemModal | App | Local form state |
| FR-11 | CatalogBrowser | CustomerRentalFlow | Filtered + paginated |
| FR-12 | AvailabilityCalendar | CatalogBrowser | Date + slot state |
| FR-13 | BookingWizard | CustomerRentalFlow | Multi-step wizard |
| FR-14 | StaffRentalWizard | StaffNewRental | Multi-step wizard |
| FR-18 | PaymentSelector | BookingWizard | Payment method + amount |
| FR-22 | ReturnProcessor | ProcessReturnModal | Fee calculation |
| FR-27 | AIReportModal | AIInsightsView | API + cached |
| FR-31 | ChatbotModal | App | Chat history |
| FR-32 | SMSSender | Transaction detail | Template + compose |
| FR-35 | NotificationBell | Header | Dropdown state |
| FR-39 | KPICardGrid | DashboardView | Computed from data |
| FR-40 | DemandChart | DashboardView / AIInsightsView | SVG computed |
| FR-43 | OfflineIndicator | Header | Network listener |
| FR-44 | OfflineQueue | Bottom sheet drawer | IndexedDB queue |

### 8.2 View State Management Approach

Each data-fetching view should track:

```javascript
{
  status: 'idle' | 'loading' | 'success' | 'error',
  data: null | Array | Object,
  error: null | Error,
  isOffline: boolean,
  pendingSync: number
}
```

- **idle/loading** → Skeleton placeholders
- **success** → Render data
- **error** → Inline error + retry
- **isOffline** → Show cached data + queue indicator

### 8.3 Critical Rendering Considerations

1. **Staff mobile performance:** Avoid heavy animations on low-end devices. Use `will-change: transform` sparingly. Prefer CSS transitions over JS animation for touch feedback.

2. **Inventory images:** Lazy load with `loading="lazy"`. Use skeleton placeholders matching image aspect ratio (3:4 for items). Provide fallback for broken images.

3. **Offline service worker:** Cache the app shell, last-fetched inventory list, last-fetched reservation list, and customer contacts. Use IndexedDB for offline transaction queue.

4. **Gemini API calls:** Always have a fallback (mock data or cached results). Show loading state with progress indication for AI report generation (can take 3-8 seconds).

### 8.4 Performance Optimization Suggestions

| Area | Strategy |
|---|---|
| Catalog grid | Virtual scroll or paginated (6 items per load, infinite scroll) |
| Transaction list | Client-side search + filter, paginate by 20 |
| Charts | SVG over Canvas for simpler use case (accessible, crisp) |
| Images | Srcset or CDN resizing, lazy loading |
| Bundle | Code-split by route/role (Admin chunk is heaviest) |
| Offline | IndexedDB for writes, Cache API for static assets |
| Icon library | Tree-shake Lucide icons (only import used icons) |

---

## 9. Edge Cases & Error Recovery

| Scenario | UX Handling |
|---|---|
| **Staff creates rental while offline** | Queued locally, shows in "Pending Sync" section, syncs when online |
| **Customer enters invalid email during sign-up** | Inline validation with specific error message, not a generic "invalid" |
| **Gemini API is down** | Fallback to mock/precomputed report, show "AI temporarily unavailable" badge |
| **Semaphore API fails for SMS** | Queue the message, retry on next page load, show "Message queued" indicator |
| **Two staff try to rent the same item on same date** | Real-time check on confirm, show conflict error: "This item was just booked. Please select another." |
| **Image upload fails (staff photo)** | Show error on the upload area, allow retry, don't block the transaction |
| **Customer's session expires during booking** | Preserve booking state in local storage, redirect to login, restore on re-auth |
| **Calendar shows no available dates** | Show "No availability this month" with a "View next month" quick-action button |
| **Staff taps "Process Return" by mistake** | Add an "Are you sure?" confirmation step with the total fees prominently displayed |
