# Functional Test Cases for RenTech – Mylene's Boutique Rental Management System with Demand Forecasting

## General Objective

The general objective of this study is to develop a comprehensive rental management system with demand forecasting for Mylene's Boutique, designed to streamline operations, improve record-keeping, enhance inventory monitoring, and support data-driven decision-making.

## Specific Objectives

1. To develop a Rental Management System for Mylene's Boutique by implementing:
   - 1.1. Role-Based Access Control
   - 1.2. Transaction Management
   - 1.3. Real-Time Inventory Monitoring
2. To develop a Customer-Based Booking Interface featuring:
   - 2.1. Online Booking System
   - 2.2. Product Browsing with Availability Checking
   - 2.3. Customer Notifications
   - 2.4. Secure Online Payment
3. To integrate System-Level Intelligence and Demand Forecasting through:
   - 3.1. Generative AI Business Insights and Customer Assistant
   - 3.2. Rule-Based Demand Forecasting for Rental and Reservation Trends
   - 3.3. Smart Inventory and Sales Optimization
   - 3.4. Revenue Monitoring and Forecast-Based Projections

## Test Environment

- Frontend: Vite React app with role-based dashboards for Admin, Staff, and Customer.
- Backend: Node.js API with PostgreSQL (Supabase), Supabase Storage for item photos and rental condition photos.
- Email: Brevo transactional email for verification, booking, pickup, return, and cancellation notices.
- Payment: Maya QRPh and PayMongo gateway with simulated mode when keys are not set.
- Notifications: In-app notification dropdown, SMS scheduler, and email alerts.

## How to Use This Document

- Execute the test cases per table in order.
- Fill in the Actual Result column with the observed behavior and screenshot reference.
- Mark the Status column as Passed, Failed, or N/A.
- Record every Failed case in Table 05 Corrective Action and Retest Log.

---

## Table 01. Functional Test Cases for Administrative and Staff Modules

Covers Objective 1.1 Role-Based Access Control and Objective 1.2 Transaction Management.

| Test Case ID | Test Case Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| TC-FUNC-01 | Restrict unauthorized role access to administrative URL routes and management settings. Precondition: Prepare one Admin, one Staff, and one Customer account. Steps: Log in as Customer and manually open admin pages for dashboard, inventory analytics, promos, staff list, and settings rules. Repeat as Staff for admin-only delete and rule update actions. | System blocks access and issues an authorization error. The app shows the Unauthorized page or redirects to the correct dashboard. No restricted data or action is exposed to the unauthorized role. |  |  |
| TC-FUNC-02 | Register a new customer account with complete signup details and interest preferences. Precondition: Logged out with a fresh valid email. Steps: Open Sign Up, enter full name, email, phone, address, and a 12-character password with upper, lower, digit, and symbol. Select item-type interest chips and submit. | New customer profile is stored in the database with phone, address, and preferences. The system sends an email verification link and holds the account as unconfirmed. No session is created until verification is completed. |  |  |
| TC-FUNC-03 | Verify customer email and block login before verification. Precondition: Newly registered but unverified account. Steps: Try to log in with the correct password before clicking the link. Then open the /verify-email link from the email, confirm, and log in again. Test resend verification as needed. | System rejects the first login and prompts the user to verify the email first. After clicking the valid link, the account becomes verified and login succeeds to the Customer Home. Resend verification always returns a generic success message. |  |  |
| TC-FUNC-04 | Register and provision a new staff account profile with operational privileges. Precondition: Logged in as Admin with multi-factor verified session. Steps: Open Settings then Team, add a staff member using name, email, and role only. Copy the one-time password from the reveal panel and log in as that staff. | New staff profile is stored in the database and authenticates successfully with the one-time password. The password is shown only once and is never stored in plain text or logs. A welcome email with the credentials is sent when email service is available. |  |  |
| TC-FUNC-05 | Force password change on first login using the one-time password. Precondition: Newly created staff account that has not changed password yet. Steps: Log in with the one-time password and observe the lock screen. Enter a new policy-compliant password and confirm, then continue using the system. | System locks all pages and shows a full-screen password change gate. All other actions are blocked on both client and server until the password is changed. After a valid change, the flag is cleared and normal access resumes. |  |  |
| TC-FUNC-06 | Set up and enforce admin multi-factor authentication using an authenticator app. Precondition: Admin account without MFA. Steps: Open Profile Settings, start MFA setup, scan the QR code, and enter the 6-digit code to enable. Log out and log in again, then try opening admin reports and settings without completing MFA. | System enables MFA, stores the secret in encrypted form, and issues one-time backup codes. Login requires the authenticator code or a valid backup code. Protected admin routes return an MFA required error when verification is missing. |  |  |
| TC-FUNC-07 | Create a walk-in rental transaction received at the boutique counter. Precondition: Logged in as Staff with at least one Available item. Steps: Open Tasks or New Rental, select an item, select or create the customer including walk-in without email, set pickup and return dates, and record the downpayment. | Transaction is saved with a booking code and QR code. Item status changes to Reserved or Rented and blocked dates are updated. Staff notification for new booking is created and the record appears in transaction logs. |  |  |
| TC-FUNC-08 | Enforce system-computed rental fee and minimum 50 percent downpayment. Precondition: Staff rental form and customer booking form. Steps: Try submitting an altered low rental fee. Then try a downpayment below 50 percent of the fee. Finally apply a valid promo code and submit again. | System ignores the altered fee and recomputes the correct sale-aware fee on the server. Low downpayment is rejected with a clear validation message. Valid promo is accepted, discounted correctly, and consumed for that booking within usage limits. |  |  |
| TC-FUNC-09 | Release a reserved item upon customer pickup at the boutique. Precondition: A Reserved booking due for pickup. Steps: Open the transaction, click Release, confirm assisting and releasing staff, and save. | Item status changes to Rented with release timestamp and staff recorded. Pickup notice is sent to the customer by in-app notification and email. Availability calendar reflects the released period. |  |  |
| TC-FUNC-10 | Process an intact item return from the transaction records table. Precondition: A Rented transaction ready for return. Steps: Open History or Logs and Returns, click Return, mark as intact, attach a condition photo if needed, and confirm. | Item status changes to Cleaning and appears in the Cleaning Queue with an updated staff dashboard count. Return receipt is saved and sent to the customer. Late return alert is raised for staff when the return is overdue. |  |  |
| TC-FUNC-11 | Process a damaged item return with damage reason and evidence. Precondition: A Rented transaction with a damaged gown or suit. Steps: Open Return, mark as damaged, enter the specific damage reason, attach a photo, and confirm. | Item skips cleaning and moves directly to Out of Service with the reason stored on both item and transaction. Return receipt itemizes the damage. Audit log records the action for traceability. |  |  |
| TC-FUNC-12 | Cancel a booking and swap a booked item with another available item. Precondition: One Reserved booking and one spare Available item for the same dates. Steps: Cancel the first booking from the detail view. Create another booking and use Swap Item to move it to the spare item. | Cancelled booking frees its blocked dates and sends a cancellation notice. Swapped booking keeps its payments and history while pointing to the new item. Old item returns to Available and the new item becomes Reserved. |  |  |
| TC-FUNC-13 | Validate rental date conflicts and scan booking QR for verification. Precondition: An item already booked for October 20 to 22. Steps: Try booking the same item on overlapping dates. Then scan the Booking QR from the receipt and check the Upcoming Returns list. | System blocks the overlapping request and shows an unavailable date prompt. QR scan resolves to the correct transaction detail. Upcoming Returns correctly lists due-today and overdue rentals for staff follow-up. |  |  |

## Table 02. Functional Test Cases for Real-Time Inventory Monitoring Modules

Covers Objective 1.3 Real-Time Inventory Monitoring.

| Test Case ID | Test Case Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| TC-FUNC-14 | Add and update an inventory item with photo upload and complete details. Precondition: Logged in as Admin or Staff. Steps: Open Inventory or Catalog, click Add Item, enter name, type, size, price, and quantity. Upload a JPEG or PNG photo and save, then edit the same item. | Item details and compressed WebP photo with thumbnail are saved to the catalog bucket. The item appears immediately in the catalog, search, and home collections. Invalid or corrupt image files are rejected with a clear format error. |  |  |
| TC-FUNC-15 | Mark a per-item sale with discount percent or fixed sale price and end date. Precondition: Existing item with regular price. Steps: As Admin, open Edit Item, turn on sale, enter either discount percent or sale price, set an optional end date, and save. Check catalog, home On Sale row, and booking price. | Item shows an On Sale badge with strikethrough regular price and discounted price in all customer views. Booking charges the sale price while the sale is active. Expired sales automatically return to regular price without manual action. |  |  |
| TC-FUNC-16 | Restrict sale price controls to admin accounts only. Precondition: One Admin and one Staff account. Steps: Open Edit Item as Staff and inspect sale fields. Then send a direct update request with sale fields as Staff using the same item. | System hides sale inputs from staff in the form. Direct non-admin sale updates are rejected with an authorization error. Only Admin changes are applied and reflected in customer prices. |  |  |
| TC-FUNC-17 | Block deletion of items with rental history and require archiving instead. Precondition: One new item with no transactions and one old item with past rentals. Steps: Delete the new item, then try deleting the old item. Archive the old item by setting status to Deleted. | New item is deleted together with its image and thumbnail. Old item deletion is rejected with a message instructing to archive instead. Archived items are hidden from customers but kept for records and reporting. |  |  |
| TC-FUNC-18 | Bulk mark cleaned items as available from the cleaning queue. Precondition: At least three items in Cleaning status after intact returns. Steps: Open Cleaning Queue, select multiple items, click Mark Selected as Cleaned, and confirm. Try manually flipping a Rented item to Available. | Selected items change to Available at once with audit records. Staff dashboard cleaning count decreases accordingly. Transaction-derived Rented and Reserved items cannot be manually flipped and only show allowed contextual actions. |  |  |
| TC-FUNC-19 | Mark an item as Out of Service with reason and restore it when ready. Precondition: An Available or Cleaning item needing repair. Steps: Click Out of Service, enter the reason such as stain or broken zipper, save, then click Restore after repair. | Item is hidden from customer booking and availability while out of service, with reason visible to staff. Restored items become bookable again immediately. Both actions are recorded in the audit trail. |  |  |
| TC-FUNC-20 | Check real-time availability calendar and blocked dates accuracy. Precondition: Item with one confirmed booking. Steps: Open Availability Calendar and item detail calendar. Try selecting overlapping dates as a customer and observe the prompt. | Calendars accurately shade booked ranges without exposing customer personal data. Overlapping selections are disabled with a clear unavailable message. Free dates remain selectable for new bookings. |  |  |

## Table 03. Functional Test Cases for Customer Booking Portal Modules

Covers Objective 2.1 Online Booking System, 2.2 Product Browsing with Availability Checking, 2.3 Customer Notifications, and 2.4 Secure Online Payment.

| Test Case ID | Test Case Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| TC-FUNC-21 | Browse the collection with search, category filter, and On Sale filter. Precondition: Catalog with mixed types, sizes, and sale items. Steps: Type a gown or barong name in search, apply type and size filters, toggle On Sale and Available-only, and sort by price. | Interface filters the directory and displays household-style cards with photo, name, price, sale price, and status. Active filters show removable chips. Out-of-service and deleted items remain hidden from customers. |  |  |
| TC-FUNC-22 | Display personalized customer home with recommendations and rentals. Precondition: Customer with selected interest chips and at least one past rental. Steps: Log in and open Home. Then change interests in Profile Settings and return to Home. | Dashboard opens presenting greeting by name, Recommended for You based on preferences, On Sale collection, and Your Rentals summary. Preference changes are saved and recommendations update right away. Booking form prefills saved contact and address. |  |  |
| TC-FUNC-23 | Complete an online booking with dates, sizes, promo code, and saved details. Precondition: Logged-in customer with saved phone and address. Steps: Select an item, pick pickup and return dates using schedule chips, enter sizes, apply a valid promo code, confirm contact details, and submit. | Volumetric-style totals including rental fee, discount, downpayment, and balance are computed accurately. Booking is saved as Reserved with a booking code. Unsaved entries trigger a discard-changes confirmation when exiting mid-flow. |  |  |
| TC-FUNC-24 | Pay the downpayment through Maya QR and track payment return status. Precondition: Booking awaiting downpayment with Maya selected as gateway. Steps: Click Pay, scan or open the dynamic QR, complete payment, and stay on the payment return page. Test an expired QR with Pay Again. | System issues a one-time QR with a one-hour expiry and redirects instead of falsely marking success. Payment return page polls every few seconds and shows pending, partial, succeeded, or expired states honestly. Expired QR allows creating a fresh charge for the remaining amount. |  |  |
| TC-FUNC-25 | Render booking receipt with booking code, QR code, and payment breakdown. Precondition: Paid or partially paid booking. Steps: Open the transaction from History, view the receipt, and download the receipt image. | System displays a structured digital receipt with booking code, item name, dates, downpayment, balance, and promo line. QR code resolves to the correct booking and the downloaded image is clear and shareable. |  |  |
| TC-FUNC-26 | Receive booking, pickup, due-date, overdue, and announcement notifications. Precondition: Customer with active, due-today, and overdue rentals plus a new admin announcement. Steps: Trigger each event, then open the bell dropdown and Notifications page as customer. Check SMS and email inbox as well. | Notification counter indicates unread alerts, and clicking displays the full advisory message text. In-app, SMS, and email copies are consistent and show outstanding balance without penalty-rate wording. Customer messages to admin appear only in the admin inbox. |  |  |
| TC-FUNC-27 | Update profile preferences, sizes, and notification switches. Precondition: Logged-in customer. Steps: Open Profile Settings, edit phone, address, usual sizes, style notes, and item interests. Toggle SMS, email, reminder, and late-return switches, then save. | Saved details are stored and reused to prefill future bookings and personalize home recommendations. Disabled reminder or late-return switches stop those customer SMS messages while staff alerts still fire. Master email switch stops marketing and order emails as expected. |  |  |

## Table 04. Functional Test Cases for Decision Support and Analytics Modules

Covers Objective 3.1 Generative AI Business Insights and Customer Assistant, 3.2 Rule-Based Demand Forecasting for Rental and Reservation Trends, 3.3 Smart Inventory and Sales Optimization, and 3.4 Revenue Monitoring and Forecast-Based Projections.

| Test Case ID | Test Case Description | Expected Result | Actual Result | Status |
|---|---|---|---|---|
| TC-FUNC-28 | Chat with the AI stylist for occasion-based outfit recommendations. Precondition: Logged in as Customer with Available gowns and suits in catalog. Steps: Ask for a wedding, debut, or graduation outfit with size and budget. Click a suggested item link and ask an unrelated non-outfit question. | System replies conversationally and recommends only real available items with correct prices and sale tags. Each reply shows its source label and follow-up chips. Item links open the catalog prefilled with that item. Non-outfit queries are politely refused by the guardrail. |  |  |
| TC-FUNC-29 | Generate an AI business report with sales, rentals, and recommendations. Precondition: Logged in as Admin with at least two months of transactions. Steps: Open AI Insights or Reports, select Overall or Monthly range, click Generate Report, and review figures and recommendations. | System processes historical records and plots or lists real totals traceable to the database. Every peso amount matches stored data and invented figures are blocked with a flagged warning. Recommendations section is parsed and displayed with fallback insights when AI is rate-limited. |  |  |
| TC-FUNC-30 | Render rental demand forecast across selected weekly and monthly timelines. Precondition: Database with sufficient rental history. Steps: Open forecast charts, switch between Overall, Yearly, and Monthly views, and hover data points. | Charts render comparative rental and reservation trends across selected periods. Projected values are plotted clearly apart from actual values with correct labels and totals. |  |  |
| TC-FUNC-31 | Handle demand forecasting requests gracefully when historical records are insufficient. Precondition: Fresh database with less than two months of records. Steps: Open forecast or generate AI report with minimal data. | System displays an informative alert stating minimum baseline data is required, avoiding application error. No crash, empty chart error, or invented projection is shown. |  |  |
| TC-FUNC-32 | View inventory analytics, top performers, and slow-moving items for sales optimization. Precondition: Logged in as Admin with varied item turnover. Steps: Open Inventory Analytics, review turnover and category charts, and click a low-turnover row to drill down. | Charts update to show item performance, slow movers, and categories needing sale or promotion. Row click jumps to filtered transaction history for that item. Data loads once without duplicate requests and cached views refresh in the background. |  |  |
| TC-FUNC-33 | Monitor revenue, collections, outstanding balances, and forecast-based projections. Precondition: Ledger with paid and partially paid transactions. Steps: Open Admin Dashboard and Reports, compare KPI cards, revenue charts, and projections against payment logs. | Dashboard dynamically updates summary cards for total billed, collected, outstanding, and projected revenue. Figures reconcile with payment records and respect partial payments honestly. Forecast projections are clearly labeled as projections, not actual sales. |  |  |
| TC-FUNC-34 | Export transaction, revenue, and inventory summaries as downloadable reports. Precondition: Logged in as Admin or Staff with existing records. Steps: Open History or Reports, select a date range, click Export workbook, transactions, revenue, or inventory, and open the downloaded file. | System compiles and downloads a formatted file containing the selected records with correct headers and totals. Spreadsheet formulas in names are neutralized to prevent formula injection. Customers are blocked from export routes. |  |  |
| TC-FUNC-35 | Check SMS log, delivery states, and admin integrations health. Precondition: Sent manual and automatic SMS plus configured AI, SMS, and payment providers. Steps: Open Messages then SMS Log, filter by All, Manual, Automatic, Sent, and Queued, search, sort, and paginate. Open Settings then Integrations status. | Interface lists each send with type, status, and timestamp, distinguishing Sent from Queued not confirmed and Failed. Admin can delete log entries without unsending messages. Integrations page shows per-provider reachable state, latency, and detail for AI, Brevo, and Maya. |  |  |

---

## Table 05. Corrective Action and Retest Log for Failed Functional Tests

(To be populated during testing if defects are discovered)

| Test Case ID | Initial Result | Corrective Action | Retest Result |
|---|---|---|---|
| (e.g., TC-FUNC-08) | (Failed) | (e.g., Fixed downpayment validation to require minimum 50 percent of system-computed fee) | (Passed) |
| (e.g., TC-FUNC-15) | (Failed) | (e.g., Corrected sale price logic so booking charges the discounted price instead of regular price) | (Passed) |
| (e.g., TC-FUNC-24) | (Failed) | (e.g., Fixed payment return polling to show partial payment honestly instead of false success) | (Passed) |
|  |  |  |  |
|  |  |  |  |
|  |  |  |  |

**Sign-off:**

- Tester: ________________
- Date: ________________
- Defects found: ________________
- Defects fixed and retested: ________________
