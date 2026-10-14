# User Acceptance Testing (UAT) Evaluation Forms for RenTech

## RenTech: A Rental Management System with Demand Forecasting for Mylene's Boutique

---

Dear Participant,

Warm greetings!

We are fourth-year BS Information Technology students with Specialization Track in Business Analytics, currently developing our capstone project, "RenTech: A Rental Management System with Demand Forecasting for Mylene's Boutique." This platform aims to replace the manual logbooks of Mylene's Boutique in Balayan, Batangas with a centralized digital system for gown and suit rentals, online bookings, inventory monitoring with photos, secure payments, customer notifications, and data-driven decision support with demand forecasting.

To verify that the system satisfies your daily needs and truly helps your work, we invite you to participate in this User Acceptance Testing (UAT). Please take a few minutes to test the features assigned to your role, follow the short test tasks in each section, and share your honest feedback by checking the rating that matches your experience.

Your participation is completely voluntary, and you may stop at any time without any consequence. In accordance with the Data Privacy Act of 2012 (RA 10173), all answers will remain strictly confidential and anonymous, and results will be used solely for academic research and system improvement.

Thank you for helping us improve rental service operations at Mylene's Boutique!

Sincerely,

The Researchers

**John Rey V. Bagunas**
**Baby Joy C. Dayao**
**Noilee Ann S. Pagkaliwagan**
BS Information Technology, Specialization Track in Business Analytics
College of Informatics and Computing Sciences
Batangas State University – The National Engineering University, Balayan Campus

Noted by:

**Mr. Ivan Gabriel B. Talaoc**
Adviser

---

## Document Control

**Project Title:** RenTech: A Rental Management System with Demand Forecasting for Mylene's Boutique
**Location:** Mylene's Boutique, Balayan, Batangas
**Respondents:** Boutique Owner / Admin, Boutique Staff, Customers
**Test Period:** _______________ to _______________
**Version:** 1.0 – May 2026

## Objectives Traceability

Each evaluation form maps directly to the study objectives so every objective is validated by its intended users.

| Objective | Validated By | Form Items |
|---|---|---|
| 1.1 Role-Based Access Control | Admin, Staff, Customer | AD-01 to AD-03, ST-01, CU-01 to CU-02 |
| 1.2 Transaction Management | Admin, Staff | AD-04, ST-02 to ST-05, ST-09 |
| 1.3 Real-Time Inventory Monitoring | Admin, Staff | AD-04 to AD-06, ST-06 to ST-08 |
| 2.1 Online Booking System | Customer, Staff | CU-05, ST-02 |
| 2.2 Product Browsing with Availability Checking | Customer, Staff | CU-03 to CU-04, ST-08 |
| 2.3 Customer Notifications | Customer, Staff, Admin | CU-08, ST-10 to ST-11, AD-11 |
| 2.4 Secure Online Payment | Customer | CU-06 to CU-07 |
| 3.1 Generative AI Business Insights and Customer Assistant | Admin, Customer | AD-07, CU-09 |
| 3.2 Rule-Based Demand Forecasting | Admin | AD-08 |
| 3.3 Smart Inventory and Sales Optimization | Admin | AD-05 to AD-06, AD-09 |
| 3.4 Revenue Monitoring and Forecast-Based Projections | Admin | AD-04, AD-09 to AD-10 |

## General Instructions

1. Please use the account and role assigned to you by the researchers (Admin, Staff, or Customer).
2. Follow the short test task described in each statement, then observe what the system actually does.
3. Please test the system features assigned to your role and rate how well they work for you by putting a check mark (✓) under the number that matches your opinion.
4. Be honest. There are no right or wrong answers. Low scores help us improve the system.
5. Write additional comments or problems encountered in the space provided after each form.

**Rating Scale:**

- 5 – Strongly Agree: Works exceptionally well and completely meets my needs.
- 4 – Agree: Works well and makes the task much easier.
- 3 – Neutral: Works acceptably, but is average.
- 2 – Disagree: Difficult to use or needs improvement.
- 1 – Strongly Disagree: Does not work well or is unsatisfactory.

**UAT Procedure per Participant:**

1. The researcher creates or assigns your test account and explains your role.
2. You log in on a phone or computer and explore your dashboard for 2 to 3 minutes.
3. You perform each numbered test task in your form in order, using the real buttons and pages indicated.
4. You check a rating from 1 to 5 for each statement immediately after testing it.
5. You answer the three open-ended questions and sign off (name optional).

---

## ADMIN EVALUATION FORM

**For:** Boutique Owner / Admin
**What to prepare:** Admin test account with multi-factor enabled, at least 5 sample items including one On Sale item, at least 5 sample transactions across two months.
**Where to test:** Dashboard, Inventory / Catalog, Promotions, Transactions / History, AI Insights / Reports, Settings (Team, Notifications, Integrations).

Name (Optional): _____________________________ Date: ___________________
Position / Role: ______________________________

| No. | Statement (Test Task + What to Check) | 5 (Strongly Agree) | 4 (Agree) | 3 (Neutral) | 2 (Disagree) | 1 (Strongly Disagree) |
|---|---|---|---|---|---|---|
| AD-01 | The login system keeps boutique records safe by ensuring only authorized admin users can access the dashboard, reports, and settings. Unauthorized pages show a clear authorization error and redirect to the correct dashboard instead of exposing restricted data. |  |  |  |  |  |
| AD-02 | Creating staff accounts with a one-time password is simple and organized. The staff name, email, and role are saved correctly, the password is shown only once in a copyable panel, and the new staff can log in successfully. |  |  |  |  |  |
| AD-03 | Setting up multi-factor authentication with an authenticator code is easy and properly protects sensitive actions. Scanning the QR code, entering the 6-digit code, and keeping backup codes work smoothly, and protected pages require verification before opening. |  |  |  |  |  |
| AD-04 | The admin dashboard gives a clear, easy-to-read summary of rentals, returns due today, overdue items, items in cleaning, and revenue. Cards and counts update correctly when filters change and match the actual transaction records. |  |  |  |  |  |
| AD-05 | Adding, editing, and archiving inventory items with photos is fast and organized. Item details and photos save immediately, photos display clearly in grids and detail views, and archived items are hidden from customers but kept for records. |  |  |  |  |  |
| AD-06 | Marking items on sale with discount percent or sale price and end date is easy and accurate. The sale badge with strikethrough regular price appears in the catalog, home page, and booking page, and bookings correctly charge the sale price until expiry. |  |  |  |  |  |
| AD-07 | The AI business report produces clear and truthful figures based on real sales and rentals. Every peso amount can be traced to actual records, invented figures are blocked, and the recommendations for promos and scheduling are practical for the boutique. |  |  |  |  |  |
| AD-08 | The demand forecast charts clearly show expected rental peaks and slow periods across weekly and monthly views. Projections for weddings, graduations, debuts, and peak seasons are easy to understand and help the boutique prepare inventory ahead of time. |  |  |  |  |  |
| AD-09 | The inventory analytics and revenue monitoring views clearly show top-performing items, slow-moving items, collections, and outstanding balances. Charts for turnover, category demand, and revenue projections update correctly and match payment records. |  |  |  |  |  |
| AD-10 | Creating and downloading transaction, revenue, and inventory reports produces clear, complete, and print-ready documents. Exported files contain the selected date range with correct headers and totals and open properly on a computer. |  |  |  |  |  |
| AD-11 | Managing promo codes, SMS templates, notification settings, and checking system integrations health is organized and convenient. Creating promos, editing message templates, and viewing the status of AI, email, and payment providers all work in one settings area. |  |  |  |  |  |
| AD-12 | Overall, the admin tools are much faster and more reliable than the manual logbook process. Finding records, tracking inventory, and making decisions takes less time and effort with fewer errors. |  |  |  |  |  |

Comments / Suggestions: ___________________________________________________________________________
___________________________________________________________________________________________________

Signature (Optional): _____________________________

---

## STAFF EVALUATION FORM

**For:** Boutique Staff
**What to prepare:** Staff test account, at least 2 Available items, 1 Reserved booking due for pickup, 1 Rented item for return, 1 item in Cleaning Queue.
**Where to test:** Dashboard, Tasks, Catalog, Logs and Returns / History, Cleaning Queue, Notifications, Settings (profile only).

Name (Optional): _____________________________ Date: ___________________
Position / Role: ______________________________

| No. | Statement (Test Task + What to Check) | 5 (Strongly Agree) | 4 (Agree) | 3 (Neutral) | 2 (Disagree) | 1 (Strongly Disagree) |
|---|---|---|---|---|---|---|
| ST-01 | Logging in is simple, and I only see the tasks, catalog, logs, and settings meant for staff. Admin-only pages are properly blocked, and my dashboard clearly shows my pending pickups, returns, and cleaning work. |  |  |  |  |  |
| ST-02 | Creating a walk-in rental at the counter is fast and organized. Selecting the item, customer, and pickup and return dates works smoothly, and the booking code and QR code are generated immediately with correct downpayment computation. |  |  |  |  |  |
| ST-03 | Releasing a reserved item for customer pickup is quick and accurate. Confirming the release updates the status to Rented right away, records the assisting staff, and sends a pickup notice to the customer. |  |  |  |  |  |
| ST-04 | Processing an intact return correctly sends the item to the Cleaning Queue with complete details. The return receipt is saved, the cleaning count on the dashboard increases, and late returns correctly raise an alert for follow-up. |  |  |  |  |  |
| ST-05 | Processing a damaged return with damage reason and photo correctly moves the item to Out of Service. The damage reason is saved on both the item and the transaction, and the receipt clearly itemizes the damage for the record. |  |  |  |  |  |
| ST-06 | Marking multiple cleaned items as available at once in the Cleaning Queue is easy and saves time. Selecting several items and clicking Mark Selected as Cleaned updates all of them to Available, and the dashboard count decreases accordingly. |  |  |  |  |  |
| ST-07 | Marking an item as Out of Service with reason and restoring it later is clear and organized. The reason such as stain or broken zipper is visible to staff, the item is hidden from customer booking while under repair, and it becomes bookable again after restoration. |  |  |  |  |  |
| ST-08 | Checking item availability by date on the calendar prevents double booking and confusion. Booked ranges are clearly shaded, overlapping dates are disabled with a clear message, and free dates remain selectable for new bookings. |  |  |  |  |  |
| ST-09 | Scanning the booking QR code quickly opens the correct transaction for release or return. The scanned code resolves to the right customer, item, and dates without manual searching, which speeds up counter service. |  |  |  |  |  |
| ST-10 | Notifications for new bookings, due today, overdue, and no-show clearly tell me what needs action. The bell counter shows unread alerts, each message shows full details, and no-show bookings prompt whether to cancel the reservation. |  |  |  |  |  |
| ST-11 | Sending SMS manually and checking the SMS Log with Sent, Queued, and Failed states is clear and honest. The result popup never falsely claims success, and the log filters by manual, automatic, and delivery status with search and sorting. |  |  |  |  |  |
| ST-12 | Overall, handling rentals, returns, and cleaning in the system is much easier than writing in paper logbooks. Recording, finding, and updating transactions takes less time with fewer lost or damaged records. |  |  |  |  |  |

Comments / Suggestions: ___________________________________________________________________________
___________________________________________________________________________________________________

Signature (Optional): _____________________________

---

## CUSTOMER EVALUATION FORM

**For:** Customers / Renters
**What to prepare:** Customer test account with verified email, saved phone and address, at least one past rental, catalog with On Sale items.
**Where to test:** Home, Collection / Catalog, Booking flow, Transactions / History, Notifications bell, Profile, Help Guide, AI stylist chat.

Name (Optional): _____________________________ Date: ___________________

| No. | Statement (Test Task + What to Check) | 5 (Strongly Agree) | 4 (Agree) | 3 (Neutral) | 2 (Disagree) | 1 (Strongly Disagree) |
|---|---|---|---|---|---|---|
| CU-01 | Signing up is simple, and the email verification link clearly guides me to activate my account. Entering name, contact details, and interests works smoothly, and the verification email arrives with a link that confirms my account. |  |  |  |  |  |
| CU-02 | Logging in is simple, and my home page clearly shows my rentals and recommended items for me. The greeting uses my name, Recommended for You matches my interests, and Your Rentals summary shows my upcoming and past bookings. |  |  |  |  |  |
| CU-03 | Browsing the collection with search, category, size, and On Sale filters makes it easy to find gowns and suits I like. Results update immediately and each card clearly shows the photo, name, price, sale price, and availability status. |  |  |  |  |  |
| CU-04 | Item photos, prices, sale prices, sizes, and availability dates are clear and complete. Detail views load sharp images, show correct discounted prices until expiry, and the date picker clearly blocks already reserved dates. |  |  |  |  |  |
| CU-05 | Booking online by selecting dates, sizes, and promo code is fast and convenient. My saved contact details and sizes autofill correctly, the promo discount is computed accurately, sale prices are charged, and my booking is confirmed with a booking code. |  |  |  |  |  |
| CU-06 | Paying the downpayment through Maya QR is convenient, and the payment status page clearly shows the true result. The QR code shows its one-hour expiry, the page honestly displays pending, partial, successful, or expired states, and expired QR offers a Pay Again option. |  |  |  |  |  |
| CU-07 | The digital receipt clearly shows the booking code, QR code, dates, downpayment, and remaining balance. The receipt is well structured with item and promo breakdown, the QR opens the correct booking, and the downloadable image is clear and shareable. |  |  |  |  |  |
| CU-08 | Notifications for booking confirmation, pickup, return, due dates, and shop announcements are easy to see and read. The bell counter shows unread alerts, each message displays full text, and SMS and email copies match the in-app notice. |  |  |  |  |  |
| CU-09 | The AI stylist gives helpful outfit suggestions using real boutique items that I can actually book. Answers reference only available items with correct prices, show the source of the answer, and politely suggest visiting the shop when no match is found. |  |  |  |  |  |
| CU-10 | Updating my profile, sizes, preferences, and notification settings is easy and takes effect right away. Saved phone, address, interests, and on-off switches for SMS and email are stored correctly and applied to my home recommendations and booking form. |  |  |  |  |  |
| CU-11 | The website looks neat, fits my screen well, and is easy to use on both smartphone and computer. Buttons, text, photos, and forms adjust properly to screen size without overlapping or requiring excessive scrolling. |  |  |  |  |  |
| CU-12 | Overall, booking and renting from the boutique online is much more convenient than inquiring manually. Finding items, checking availability, paying, and tracking my rentals takes less time and effort with clearer information. |  |  |  |  |  |

Comments / Suggestions: ___________________________________________________________________________
___________________________________________________________________________________________________

Signature (Optional): _____________________________

---

## Open-Ended Feedback (All Roles, Optional)

1. What feature did you find most useful and why?
___________________________________________________________________________
___________________________________________________________________________

2. What problem or confusion did you encounter, if any? On which page and what were you doing?
___________________________________________________________________________
___________________________________________________________________________

3. What improvement would you suggest for Mylene's Boutique operations?
___________________________________________________________________________
___________________________________________________________________________

## UAT Sign-Off and Summary (For Researchers Only)

| Role | No. of Participants | Average Score (1-5) | Passed (>=4.0) | Remarks |
|---|---|---|---|---|
| Admin |  |  |  |  |
| Staff |  |  |  |  |
| Customer |  |  |  |  |

- Overall result: ________________ (Accepted / Accepted with minor revisions / Needs major revision)
- Critical issues found: ___________________________________________________________________________
- Corrective actions taken: ___________________________________________________________________________
- Retest date and result: ___________________________________________________________________________

Prepared by: _____________________________ Date: ___________________
Checked by (Adviser): _____________________________ Date: ___________________
