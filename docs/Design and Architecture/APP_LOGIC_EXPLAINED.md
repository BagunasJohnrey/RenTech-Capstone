# RenTech - How the App Works (Simple Words)

RenTech is the rental app for Mylene's Boutique in Balayan, Batangas.
Customers rent gowns, suits, barong and other outfits.
Staff manage items, bookings, pickup, returns and cleaning.

## 1. Renting - How It Works

1. **Browse:**
   Customer sees catalog with photo, price, size.
   Sale items show old price crossed out.

2. **Pick dates:**
   Customer picks pickup date and return date.
   System blocks dates if someone else already booked that item,
   plus 1 extra day for cleaning.

3. **Price:**
   Server computes the price, not the phone, so no cheating.
   If item is on sale, sale price is used.
   If promo code is valid, discount is applied.

4. **Downpayment:**
   Customer pays at least P200 down.
   Staff walk-ins can pay 0 first.

5. **Save booking:**
   If pickup is today -> `Active`.
   If pickup is in the future -> `Reserved` hold.

6. **Payment:**
   If no real key, payment is simulated as success for testing.
   If real, it goes through PayMongo.
   If payment fails or is cancelled, booking is auto-cancelled.

7. **Pickup:**
   Staff hands the item.
   `Reserved` becomes `Active`.
   Staff can add photo and take remaining balance.

8. **Return:**
   Staff checks the item:
   - Good condition -> goes to `Cleaning`, then staff later selects many and clicks `Mark as Cleaned` -> `Available` again.
   - Damaged + reason note -> goes straight to `OutOfService`.
   - Late -> adds late fee. Damaged -> adds damage fee.

9. **Auto checks every 1 minute:**
   - Due today -> reminder SMS + email + staff alert.
   - Past due -> mark `Overdue` + SMS + email.
   - 3 days overdue -> escalation warning to staff.
   - Reserved but never picked up after 1 day -> no-show alert to staff ("Cancel the booking?").

## 2. SMA - How Guessing Future Demand Works

SMA = Simple Moving Average. Just an average of the past to guess the future.

Example:
Jan = 10 rentals, Feb = 20, Mar = 30.
SMA for March = (10 + 20 + 30) / 3 = 20.

What the app does:
- Counts rentals per month, or per week for the last 12 weeks.
- Takes average of last 3 periods to smooth ups and downs.
- Shows it as bars = real counts, line = SMA.
- To predict next 3 months, it just copies the last SMA flat forward.
- If not enough history, it shows `-` and says "need more months".
- Per category like Gown / Suit, it shows trend up / down / flat to suggest what to restock or clean first.
- First months with incomplete window are empty (null) so the chart does not lie.

Code:
- Formula: `backend/src/utils/sma.ts`
- Data + forecast: `backend/src/services/dashboard.service.ts`
- Chart: `frontend/src/pages/AIInsightsView.jsx`

## 3. AI - How It Works

Two tools:

**A. Stylist chatbot:**
Helps customer pick outfit for wedding, debut, graduation, corporate, gala.

**B. Business report:**
Helps admin understand sales and what to do next.

### Fallback chain

Bad prompt check -> FAQ -> Gemini -> Groq -> OpenRouter -> offline message.

If one provider fails or is rate-limited, it tries the next one.
401 / 403 means bad key and stops trying that provider.

### Safety rules

- Tricks like "ignore your rules / jailbreak / pretend to be" are blocked.
- AI only suggests real items from the live `Available` list from the database.
- It cannot invent items, prices, or availability.
- Free styling advice (colors, fit, accessories) is allowed, but specific names and prices must come from the list.
- Sale items are marked `[ON SALE]` with sale price.

### Report anti-cheating

- Report only uses real numbers from KPIs, insights, forecast.
- Prompt says: no sales data -> write "No sales data available yet", never invent figures, promos are suggestions not facts.
- After writing, system checks every P / Php amount. If amount was not in the input data (within 5% for K/M rounding), report is thrown away as flagged.
- Rate-limited -> says "high traffic, try again" with retry flag.

### Labels and limits

- Each reply has source: `ai / faq / guardrail / fallback / error` shown as pill: AI + model name, Instant Answer, Assistant, Offline.
- Chat limited to 12 per minute per user.
- Chat timeout 45s, report timeout 60s.

Code:
- `backend/src/services/gemini.service.ts`
- `backend/src/controllers/ai.controller.ts`
- `frontend/src/components/ChatbotModal.jsx`
- `frontend/src/pages/AIInsightsView.jsx`

## 4. Auth - How Login Works

### Signup - customer
- Gives name, email, password, phone, address, likes.
- Password must be 12+ chars with big letter, small letter, number, symbol.
- App creates user but NOT logged in yet.
- Sends verification email via Brevo with `/verify-email?token=...` link.
- Token lives 24 hours, one-time use.
- Only after clicking link can they login.

### Login
- Gives email + password.
- If email not verified yet, blocked with "verify your email first".
- If correct, server gives 2 httpOnly cookies:
  - `rt_access` - short life, proves who you are.
  - `rt_refresh` - 60 days, used to get new access without login again.
- Frontend only keeps logged-in flag, no token in storage.
- If access expires, frontend auto-calls `/auth/refresh`.
- Wrong email and wrong password show same message so hackers cannot guess emails.

### Forgot / reset password
- Always says "if account exists email sent".
- Email has `/reset-password?token=...` link, 1 hour life.
- After reset, all other devices are logged out.

### Staff accounts
- Admin creates staff, no password typed.
- System makes random 16-char one-time password, shows it once to copy + sends welcome email.
- On first login, staff is locked to change-password screen only. Must change before doing anything.

### Admin extra lock - MFA
- Admin must setup authenticator app. Scans QR, types 6-digit code.
- Gets 10 backup codes, one-time use if phone lost.
- On login, after password, must type 6-digit code.
- Can check "trust this device 30 days" to skip next time on same browser.
- Without MFA, sensitive pages like staff list, rules, analytics are blocked.

### Google login
- Click Google -> go to Supabase -> back with code.
- If new, asks for phone / address to finish profile.

### Logout
- Refresh token revoked, cookies cleared.

Code:
- `backend/src/services/auth.service.ts`
- `backend/src/controllers/auth.controller.ts`
- `backend/src/middleware/auth.ts`
- `backend/src/middleware/jwtVerify.ts`
- `backend/src/middleware/rbac.ts`
- `backend/src/middleware/cookies.ts`

## 5. Other Core Logics

### Roles
- Customer books for self only via `/bookings`.
- Staff handles walk-ins, release, return via `/transactions`.
- Admin handles sales, prices, staff, delete, settings.
- Server checks role on every route.

### Item lifecycle
- `Available -> Reserved / Rented -> Cleaning -> Available`.
- Damaged -> `OutOfService` with reason, skips cleaning.
- With rental history cannot delete, only archive to `Deleted`.
- No auto Cleaning -> Available flip, staff cleans in bulk.
- Rented / Reserved are derived from transactions, staff cannot hand-flip them.

### Per-item sales
- Only admin can set on-sale + % off or fixed price + end date.
- Active only while `onSale` AND end date is null or in future.
- Customer auto-pays sale price in catalog, home, and booking.

### Promo codes
- Code + % off + max uses + expiry.
- One use per customer.
- Checked read-only first, consumed only if booking succeeds, inside same DB transaction.

### Notifications / SMS / Email
- In-app bell for staff: new booking, late, overdue, due today, no-show.
- SMS via Semaphore + email via Brevo alongside.
- No per-day fee rates in SMS text (overdue texts show the outstanding balance as plain `PHP 1,250` — never the ₱ glyph).
- Customer can turn off reminders / emails in Profile Settings.
- Walk-in fake emails are never emailed.

### Photos
- Uploads auto-rotate, strip GPS, shrink to 1280px, convert to WebP.
- Catalog bucket is public for speed, return-condition photos are private with signed URL.
- Thumbs for grids, full image for modals.

### Settings
- Rules like `min_downpayment=200`, `rental_period=3 days`, `overdue_escalation_days=3`, `data_retention_months=12`.
- SMS templates editable.
- Health page shows Gemini / Groq / OpenRouter / Brevo status.

### Cleanup
- Daily deletes old notifications / SMS / logs / used email tokens older than 12 months.
- Orphaned image check is dry-run only, manual delete.

## 6. Item Status - Simple Words

Item status = where is the item right now. 6 kinds only:

**1. Available**
- On the rack, ready to rent.
- Customer can book it.
- This is the default.

**2. Reserved**
- Someone booked it for a future date, not picked up yet.
- Example: book today for next week wedding.
- System sets this auto on booking. Staff cannot set by hand.
- Other customers cannot book those dates, but can book other dates.

**3. Rented**
- Item is out with customer right now.
- Example: picked up today, due in 3 days.
- System sets this auto on pickup. Staff cannot set by hand.
- No one else can book it while rented.

**4. Cleaning**
- Customer returned it in good condition, needs wash.
- It stays here until staff cleans in bulk.
- No auto-change to Available. Staff must select in Cleaning Queue and click `Mark as Cleaned`.
- Cannot be booked while cleaning.

**5. OutOfService**
- Broken, damaged, lost, or under repair.
- Happens when return is marked damaged + reason, or staff clicks `Mark Out of Service` with reason.
- Cannot be booked.
- To bring back, staff clicks `Restore` -> becomes `Available` or `Cleaning`.

**6. Deleted**
- Hidden, archived. Not shown in catalog.
- Used when item has rental history and cannot be really deleted.
- If no history, admin can really delete it. If has history, must archive to Deleted instead.

**Simple flow:**

- `Available` -> book future -> `Reserved` -> pickup -> `Rented` -> return good -> `Cleaning` -> clean -> `Available`
- `Rented` -> return damaged -> `OutOfService` -> repair -> `Available`
- Any free item -> damage -> `OutOfService`
- Old item -> `Deleted`

Staff can only hand-set: `Available, Cleaning, OutOfService`. `Rented / Reserved` are auto from bookings.
