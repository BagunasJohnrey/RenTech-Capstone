# 4. RESULTS AND DISCUSSION

This chapter presents the results and discussion of the study based on the development and evaluation of the system. It details the actual implementation of the administrative, staff, and customer modules of RenTech, followed by the empirical findings from functional testing and user acceptance testing.

## 4.1 System Presentation

This section presents the developed RenTech system, including its features, functionalities, and interfaces. Each figure below represents a major module of the system. The placeholder line under each title indicates the exact screenshot to be inserted. Each figure is followed by an explanation of what the module does, a walkthrough of how it works, and how it addresses the manual problems previously identified at Mylene's Boutique.

---

### Figure 1. Login, Email Verification, and Role-Based Access Interface of RenTech

[Insert screenshot: Login page, Sign Up form with interest chips, email verification notice, and the three role-based side navigation menus for Admin, Staff, and Customer.]

Figure 1 presents the entry point of the system, developed for all users of Mylene's Boutique. This module fulfills Objective 1.1 by ensuring that every person enters the system through a verified account and only sees the pages meant for his or her role. Administrators see the Dashboard, Inventory, Promotions, Transactions, Reports, and Settings. Staff members see the Dashboard, Tasks, Catalog, Logs and Returns, and Settings. Customers see the Home, Collection, Transactions, Profile, and Help Guide.

The upper part of the interface contains the login form with email and password fields, a Google sign-in button, and a forgot-password link. The sign-up form collects the full name, email, phone number, home address, and a strong password of at least twelve characters, together with item-type interest chips that later personalize the customer home page. After signing up, the system sends a verification email, and the account cannot log in until the link is clicked. Directly opening a page that belongs to another role shows a clear authorization error and redirects the user to the correct dashboard, so no restricted data is exposed.

This feature directly resolves the lack of access control in the manual system, where paper logbooks were open to anyone who picked them up and no record showed who wrote or changed an entry. In the manual workflow, pages could be lost or altered without trace, and there was no way to hold anyone accountable. By requiring verified accounts and strictly separating admin, staff, and customer views, the system protects boutique records and ties every future action to a known user.

---

### Figure 2. Staff Account Management and Admin Security Interface of RenTech

[Insert screenshot: Settings Team tab with staff list and Add Staff form, the one-time password reveal panel, the full-screen forced password change gate, and the MFA setup screen with QR code.]

Figure 2 presents the account security center for administrators, also under Objective 1.1. This module allows only the admin to create staff accounts, forces new staff to set their own password on first login, and protects sensitive actions with multi-factor authentication. It functions as the guard of the whole system, since every rental, release, and return is later tagged with the staff member who performed it.

The Team tab displays the list of current staff with their roles and status, plus an Add Staff button that asks only for name, email, and role. Upon creation, the system generates a one-time password and shows it once in a copyable reveal panel, which the admin hands to the new staff member. On first login, the staff member is locked by a full-screen password change gate and cannot open any other page until a new policy-compliant password is set. For the admin, the Profile Settings page offers multi-factor setup through an authenticator app: scanning a QR code, entering the six-digit code, and safekeeping one-time backup codes. Sensitive pages such as business rules, message templates, and inventory reports require this second verification before opening.

This feature addresses the accountability gap of the manual process, where logbook entries carried no reliable author and any person present could write in the books. There was likewise no protection for critical decisions such as pricing or discount changes. By provisioning staff through one-time credentials and gating sensitive settings behind a second factor, the system ensures that only legitimate, verified personnel can alter boutique records.

---

### Figure 3. Walk-in Rental Creation and Transaction Records Interface of RenTech

[Insert screenshot: Staff New Rental form with item, customer, and date selection, and the transaction History table with search bar, status filters, and a transaction detail modal showing the booking code and QR.]

Figure 3 presents the transaction core of the boutique, developed for staff users in fulfillment of Objective 1.2. This module handles the complete rental lifecycle: creating walk-in rentals at the counter, recording payments, releasing items for pickup, and reviewing the full history of every transaction with its booking code and QR code.

The upper section of the New Rental form lets staff pick an Available item, find the customer by search or register a walk-in customer without an email, and set the pickup and return dates on a calendar that blocks already reserved dates. The system itself computes the rental fee from the item price or active sale price, rejects any downpayment below fifty percent of the fee, and applies promo codes within their usage limits. Confirming the form generates a unique booking code and QR code for the transaction. Below, the History table organizes all transactions with a search bar, status and date filters, and columns for customer, item, dates, amounts, balance, and status. Opening a row reveals the full detail with actions to cancel, swap the item for another available one, scan the QR for verification, and view upcoming returns due for follow-up.

This module replaces the separate handwritten logbooks for rentals, group bookings, and returns, which were difficult to search and easy to lose or damage. In the manual workflow, overlapping bookings happened because availability lived only in the staff's memory, and computing fees and balances by hand caused frequent errors. By centralizing every transaction in one searchable digital ledger with automatic conflict checking and server-computed amounts, the interface eliminates double booking, shortens counter service time, and keeps a permanent audit trail.

---

### Figure 4. Item Release, Return Processing, and Cleaning Queue Interface of RenTech

[Insert screenshot: Release confirmation modal, Return processing modal with intact and damaged options plus reason field, and the Cleaning Queue with bulk selection and the Mark Selected as Cleaned button.]

Figure 4 presents the item lifecycle controls used by staff, continuing Objective 1.2 together with Objective 1.3. This module moves each rented garment through its true physical states: Reserved to Rented upon release, Rented to Cleaning after an intact return or directly to Out of Service after a damaged return, and Cleaning back to Available once laundry is done in batches.

The release action opens a confirmation modal that records the assisting and releasing staff together with the pickup timestamp. The return modal offers two paths: marking the item intact, which sends it to the Cleaning Queue, or marking it damaged, which requires a written damage reason and an optional condition photo and sends the item straight to Out of Service, skipping cleaning. The Cleaning Queue lists all items awaiting laundry with bulk selection, and the Mark Selected as Cleaned button returns the chosen batch to Available in one action, matching the boutique's real batch-laundry practice. Items marked Out of Service show their reason to staff, stay hidden from customer booking, and return to circulation only through an explicit Restore action. A dashboard banner keeps the pending cleaning count visible, and bookings whose pickup date passes without release raise a no-show alert suggesting cancellation.

This directly fixes the broken condition-tracking habit in the old workflow, where staff photographed garments with personal phones and the images were never linked to the written logs. Damage disputes were common because there was no attached evidence, and half-cleaned or damaged items were sometimes re-rented by mistake. By attaching condition photos to the transaction itself and enforcing the correct next state for every return, the system preserves evidence, prevents accidental re-rental of unready items, and mirrors the boutique's actual batch-cleaning routine.

---

### Figure 5. Real-Time Inventory Monitoring Interface of RenTech

[Insert screenshot: Inventory page with status summary counts, search and filter bar, item cards showing photo, price, sale badge, and status, the Add and Edit Item form, and the availability calendar with blocked dates.]

Figure 5 presents the live inventory control center for admin and staff, fulfilling Objective 1.3. This module is the single source of truth for every gown, suit, and costume: its details, photo, price, quantity, and current status of Available, Rented, Reserved, Cleaning, Out of Service, or Deleted.

The top section shows summary counts per status so staff instantly see how many items are rentable, in cleaning, or under repair. Below it, a search bar with type, size, and status filters narrows the directory in real time. Each item card displays the photo, name, price with any active sale price, and a color-coded status badge, with contextual actions only: clean, mark out of service, or restore, so transaction-driven states cannot be flipped by hand. The Add and Edit form captures name, type, size, price, and quantity with photo upload, which the server automatically compresses and converts for fast loading. Deleting an item that already has rental history is rejected with an instruction to archive it instead, preserving records. An availability calendar shades all booked date ranges per item so both staff and customers see exactly when each piece is free.

This resolves the core record-keeping problem of the boutique, where inventory lived across separate logbooks, memory, and scattered phone photos, making it slow to answer even simple questions such as whether a gown was available next Saturday. Physical records wore out and went missing, and availability answers depended on who was asked. By placing every item with its photo and live status in one searchable directory, the interface makes retrieval instant, keeps records accurate, and lets availability be checked in seconds rather than through pages of handwriting.

---

### Figure 6. Per-Item Sale and Promo Code Management Interface of RenTech

[Insert screenshot: Edit Item form with the sale toggle, discount and sale price fields, catalog showing the On Sale badge with strikethrough price, and the Promotions view with the promo code list and creation form.]

Figure 6 presents the discount management tools for the admin, supporting Objectives 1.3 and 3.3. This module lets the boutique run time-bound per-item sales and coded promos systematically instead of through informal, untracked markdowns.

In the Edit Item form, an admin-only sale section offers a sale switch with either a discount percentage or a fixed sale price plus an optional end date. While active, the item automatically shows an On Sale badge with the regular price struck through in the catalog, on the customer home page, and inside the booking flow, and every computation charges the sale price until expiry. Staff accounts neither see these controls nor can pass sale changes through direct requests. Separately, the Promotions view lists all promo codes with their type, value, usage caps, validity dates, and status, and provides a creation form for new codes. Customers see the public promos and validate them during booking, while the system enforces expiry and per-customer limits and suggests new promos from sales patterns.

In the manual operation, discounts were given verbally at the counter with no consistent record, so the boutique could never tell which markdowns actually drove rentals or were simply given away. By formalizing every sale and code with dates, limits, and automatic price application, the module turns discounting from gut feel into a measurable, controllable lever for slow seasons and slow-moving items.

---

### Figure 7. Personalized Customer Home Interface of RenTech

[Insert screenshot: Customer Home with greeting hero, Recommended for You row, On Sale collection row, and Your Rentals summary cards.]

Figure 7 presents the landing page each customer sees after logging in, opening the Objective 2 experience. This module functions as a personal boutique window: it greets the customer by name and assembles recommendations from the interests chosen at signup, current sale items, and the customer's own rental activity.

The upper hero section carries the greeting and quick access to the collection and the AI stylist chat. Beneath it, the Recommended for You row shows items matching the customer's saved preferences, followed by an On Sale collection row for discounted pieces and a Your Rentals summary listing upcoming pickups, returns due, and past rentals with their balances. Editing interests, sizes, or contact details in Profile Settings immediately refreshes these recommendations, and the booking form later reuses the saved details so repeat customers never retype them.

Previously, a customer learned about new arrivals or suitable items only by visiting the shop or sending messages, and staff had no practical way to personalize suggestions at scale. By generating a tailored home page for every account around the clock, the system gives each customer the feeling of being assisted by staff who remember her taste, while drawing attention to sale pieces the boutique most wants to move.

---

### Figure 8. Product Browsing and Availability Checking Interface of RenTech

[Insert screenshot: Collection catalog with search bar, filter chips including On Sale, sorting control, an item detail modal with photos and date picker showing blocked dates, and the global search modal.]

Figure 8 presents the self-service collection browser for customers, fulfilling Objective 2.2. This module lets anyone check what the boutique owns, what each piece costs, and exactly which dates it is free, without asking staff.

The catalog opens as a photo grid where a search bar finds items by name, filter chips narrow by type, size, availability, and On Sale status, and sorting orders by price or name. Active filters appear as removable chips so the customer always sees what is applied. Clicking a piece opens its detail view with photos, sizes, regular and sale prices, and a date picker in which already reserved ranges are visibly blocked and unselectable. Only genuinely free date combinations allow proceeding to booking. A global search modal offers the same lookup from anywhere in the app, and item links inside the AI stylist replies jump straight into the catalog with the search prefilled.

This removes the heaviest messaging burden of the old operation, where every availability question required a chat reply or a shop visit and answers varied with whoever responded. Customers can now verify dates themselves with the same data staff see, which cuts inquiry traffic, prevents misunderstandings about reserved weekends, and lets decisions happen at the customer's own pace, including late at night.

---

### Figure 9. Online Booking Interface of RenTech

[Insert screenshot: The booking flow steps — item selection sheet, date selection with schedule chips, sizes and measurements form, contact details with promo code field, and the confirmation screen with booking code.]

Figure 9 presents the guided multi-step booking flow for customers, fulfilling Objective 2.1. This module converts a chosen item and free dates into a confirmed reservation with complete details captured once and reused thereafter.

The flow opens on item selection, or directly on dates when launched from a specific piece. Date selection offers quick schedule chips alongside the calendar for common rental windows. The sizes step prefills the customer's saved measurements and style notes and offers standard size presets, while the contact step prefills the saved phone and address so only changes need typing. A promo field validates the code instantly and shows the exact discount and terms before confirmation. The review screen lays out the fee, discount, required downpayment, and remaining balance for checking. Leaving midway with unfinished entries raises a discard-changes confirmation so work is never lost silently.

Under the manual system, reservations were scribbled on paper slips or negotiated across long chat threads, where sizes, dates, and contact numbers were repeatedly asked and frequently mis-copied. By collecting every needed detail in one structured pass with validation at each step, the booking flow produces complete, legible reservations that staff can fulfill exactly as the customer intended, and customers receive their booking code immediately as proof.

---

### Figure 10. Secure Online Payment and Digital Receipt Interface of RenTech

[Insert screenshot: Downpayment screen with gateway notice and Maya QR code showing expiry, the payment return status page, and the booking receipt with booking code, QR code, payment breakdown, and download button.]

Figure 10 presents the payment and proof-of-payment experience for customers, fulfilling Objective 2.4. This module collects the required downpayment through a selectable online gateway, reports the true payment outcome honestly, and issues a permanent digital receipt.

After booking, the payment screen states the amount due, bounded between the fifty-percent minimum and the outstanding balance so overpayment and underpayment are impossible. Choosing the Maya QR option issues a one-time dynamic QR code with a clearly shown one-hour expiry. The app then moves to a payment return page that polls the real transaction status and displays exactly what happened: pending, partial with the honest remaining amount, succeeded only when the required downpayment is truly covered, or expired with a Pay Again option that raises a fresh charge for the remainder. Once credited, the booking receipt shows the booking code, item, dates, downpayment, balance, and promo line beside a booking QR code that staff can scan at the counter, with a one-tap download of the receipt image for the customer's files.

Cash-only manual payments with handwritten official receipts were easily lost, faded, or disputed, and settling old balances meant arguing over missing slips. By recording every credit in a single idempotent ledger where duplicate gateway callbacks can never double-charge, and by giving customers a verifiable receipt they keep on their phones, the system removes payment disputes and provides both sides with a secure, checkable money trail.

---

### Figure 11. Customer Notification Interface of RenTech

[Insert screenshot: Notification bell dropdown with unread counter, Notifications page with All, Notifications, Messages, and SMS Log tabs, a manual SMS result popup, and the Profile notification preference switches.]

Figure 11 presents the unified messaging hub for customers, staff, and admin, fulfilling Objective 2.3. This module guarantees that booking confirmations, pickup and return notices, due-today reminders, overdue alerts, and shop announcements all reach the right people through in-app notices, SMS, and email.

Customers follow everything through the bell icon, whose counter marks unread items, and the Notifications page, which keeps the full text of every advisory permanently readable. Staff gain the extra SMS Log tab showing each send as Sent, Queued with an explicit not-confirmed warning, or Failed, with filters by manual or automatic origin, delivery state, search, sorting, and paging, so no send is ever falsely claimed as delivered. Transactional emails mirror the same events with the boutique's branded header for booking, pickup, return, cancellation, due, and overdue notices. In Profile Settings, customers control master email and SMS switches plus separate reminder and late-return toggles, and the scheduler honors every opt-out while staff safety alerts still fire.

The old communication setup depended on word of mouth, paper postings, and informal group chats, so maintenance notices and due reminders routinely arrived late or not at all, and customers had no single place to re-read them. By consolidating every notice into one addressed, timestamped, and re-readable feed across three channels, the system makes billing deadlines and service advisories timely, transparent, and impossible to lose to a buried chat message.

---

### Figure 12. AI Stylist Customer Assistant Interface of RenTech

[Insert screenshot: Chatbot modal with a wedding outfit question, the assistant reply showing a source label, recommended items with prices, follow-up suggestion chips, and an item link.]

Figure 12 presents the conversational styling assistant for customers, forming the first half of Objective 3.1. This module answers occasion-based questions about weddings, debuts, graduations, corporate events, and themed parties, and points customers to real boutique pieces they can book immediately.

The chat window accepts free-form questions including size and budget hints. The assistant replies conversationally with styling advice on colors, fit, and accessories, but every specific item, price, and availability claim comes strictly from the live catalog of Available pieces, complete with sale markers, so nothing is ever invented. Each reply carries a small source label showing whether it is live AI, an instant answer, or offline guidance, followed by contextual follow-up chips for refining the request. Tapping a recommended item name closes the chat and opens the catalog with that item prefilled for booking. Off-topic questions are politely declined by design, and when nothing in stock matches, the assistant says so honestly and invites a shop visit instead of fabricating options.

Previously, styling guidance depended entirely on which staff member happened to be free and what she remembered from stock, so advice quality varied and stopped when the shop closed. The assistant provides consistent, patient, around-the-clock guidance grounded in actual inventory, acting as a knowledgeable attendant who never misquotes a price or promises an item that is already rented.

---

### Figure 13. AI Business Insights Report Interface of RenTech

[Insert screenshot: AI Insights page with range selector, Generate Report button, KPI and forecast input summary, generated report with recommendations section, and the saved reports and promo suggestions lists.]

Figure 13 presents the management insight generator for the admin, forming the second half of Objective 3.1. This module turns raw rental records into a readable business report with findings and recommendations, while strictly refusing to invent numbers.

The admin selects a coverage range such as Overall, Yearly, or Monthly and presses Generate Report. The system feeds real key metrics, forecasts, and inventory figures into the model and returns a structured report whose every peso amount is traceable to the input data; any figure that cannot be matched is blocked and the report is flagged rather than shown. The recommendations section is parsed into actionable points on promos, scheduling, and stock moves, with static fallback insights whenever the AI providers are rate-limited, clearly labeled as such. Generated reports and promo suggestions are saved in lists for re-reading, retrying uploads, or deletion.

This replaces the most fragile part of the old operation: decisions made purely from memory and gut feel, with no analysis of which months, categories, or items actually earned. Because a wrong number is worse than no number, the honesty guard and its distinct warning states ensure the admin either receives verified, traceable insight or an explicit notice that none is available, building justified trust instead of impressive-looking fiction.

---

### Figure 14. Demand Forecasting Interface of RenTech

[Insert screenshot: Forecast view with Overall, Yearly, and Monthly toggles, actual versus projected trend lines, and the insufficient-data notice state.]

Figure 14 presents the forward-looking projection charts for the admin, fulfilling Objective 3.2. This module estimates upcoming rental and reservation demand from historical records so the boutique can prepare before peak periods instead of reacting during them.

The view offers Overall, Yearly, and Monthly ranges over the boutique's real transaction history. Solid lines trace actual past rentals while dashed projection lines extend the expected trend into coming weeks and months, with summary cards for the historical baseline and the next-month and next-year outlooks. When the database holds fewer than two months of records, the system refuses to fabricate a forecast and instead shows a plain notice that minimum baseline data is required, avoiding both crashes and misleading charts.

Seasonality was previously invisible: prom and wedding rushes arrived as surprises, with too few cleaned gowns ready and no staff scheduling ahead. By making the coming demand curve visible in one glance, the forecast gives the boutique an empirical basis for advancing laundry batches, holding popular sizes back from long bookings, and staffing the counter for the weeks that truly need it.

---

### Figure 15. Inventory Analytics and Sales Optimization Interface of RenTech

[Insert screenshot: Inventory analytics with turnover and category charts, top-performer and slow-mover lists, an item row opened to filtered history, and the AI promo suggestions panel.]

Figure 15 presents the stock intelligence view for the admin, fulfilling Objective 3.3. This module identifies which items earn, which gather dust, and what commercial action each group deserves: feature, discount, or retire.

Turnover and category-demand charts rank every piece by rentals, revenue, and idle time, while dedicated slow-mover flags highlight garments that have sat unbooked beyond their expected cycle. Clicking any row jumps directly into the transaction history prefiltered for that item, so the numbers behind the flag can be inspected in seconds. Dormant pieces carry suggestions to place them on sale or attach a promo code, and the AI promo panel drafts campaign ideas from the same data, which the admin can save, review, and apply.

Underperforming garments were previously undetectable because no report ever connected rental counts to individual items, so unpopular designs occupied rack space for years while winners were never reinforced. By converting rental history into per-item verdicts with one-click drill-down, the module converts the catalog from a static wardrobe into a managed portfolio where every piece must justify its place or be moved on sale.

---

### Figure 16. Revenue Monitoring Dashboard and Report Export Interface of RenTech

[Insert screenshot: Admin dashboard with KPI cards for collected revenue, outstanding balances, and booking counts, revenue trend charts with forecast projections, and the export buttons with a downloaded report file.]

Figure 16 presents the financial oversight center for the admin, fulfilling Objective 3.4. This module keeps collected revenue, outstanding balances, and future projections visible at all times and exports them into files ready for meetings and audits.

Key cards summarize total billed, collected, and outstanding amounts with booking counts, while trend charts separate actual collections from clearly labeled forecast projections so expectations are never mistaken for earnings. Figures reconcile exactly with the payment ledger, including honest partial-payment states. One-click exports produce the full workbook or the individual transaction, revenue, and inventory reports for any selected period, with spreadsheet-injection guards so item names can never corrupt the files. Staff share the operational portions of the dashboard while customers are excluded from all financial views and exports.

Month-end closing in the manual era meant an afternoon of tallying paper columns with a handheld calculator, an exercise both slow and error-prone, with no volume to present at planning discussions. By automating every total and keeping projections visually distinct from cash in hand, the dashboard gives the owner a trustworthy financial picture in seconds and a print-ready record whenever formal reporting is required.
