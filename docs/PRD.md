# Product Requirements Document (PRD): RENTECH — Mylene's Boutique Rental Management System

---

## 1. Introduction / Overview

RENTECH is a **Progressive Web App (PWA)** for Mylene's Boutique, a gown, suit, and costume rental shop in Balayan, Batangas. It replaces a fragmented manual/internal process with a modern, dual-interface system serving **customers** (online browsing, booking, payment) and **staff/admin** (inventory, transaction, return, and intelligence features). The system is built from an existing React + Tailwind frontend prototype and will gain a full Node.js/TypeScript backend.

---

## 2. Goals / Objectives

1. **Develop a Rental Management System** with Role-Based Access Control (RBAC), transaction management, and real-time inventory monitoring.
2. **Develop a Customer-Facing Booking Interface** with online catalog browsing, date-specific availability checks, secure downpayment, and automated SMS notifications.
3. **Integrate System-Level Intelligence and Demand Forecasting** via Generative AI (Gemini API) business insights, rule-based SMA forecasting, smart inventory optimization, and revenue projections.

---

## 3. Target Audience / User Personas

| Persona | Description | Needs |
|---|---|---|
| **Admin / Owner** (Mylene) | Boutique owner with full system oversight | Create staff accounts, view AI reports & forecasts, manage inventory, configure business rules, see revenue analytics |
| **Staff** | Boutique employees who handle daily operations | Process rentals & returns, check inventory, view customer info, capture condition photos, send SMS reminders, work offline when connectivity is poor |
| **Customer** | Event attendees (proms, debuts, pageants, social events) renting gowns, suits, costumes | Browse catalog, check availability by date, book & pay deposit online, receive SMS confirmations/reminders, get AI stylist recommendations |

---

## 4. User Stories / Use Cases

### 4.1 Admin

- As Admin, I can log in securely and access the full dashboard.
- As Admin, I can create, edit, and delete staff accounts with role-based permissions.
- As Admin, I can view AI-generated business reports (Gemini API) with revenue analysis, inventory insights, and forecasts.
- As Admin, I can view SMA-based demand forecasting with visual charts and trend projections.
- As Admin, I can add, edit, and remove inventory items with categories, pricing, and images.
- As Admin, I can view real-time overview KPIs (active rentals, pending returns, monthly revenue, damaged items).
- As Admin, I can view underperforming inventory and receive smart optimization suggestions.

### 4.2 Staff

- As Staff, I can log in and access the operations dashboard.
- As Staff, I can process new rental transactions (select item, enter customer details, set dates, collect optional downpayment, capture condition photo).
- As Staff, I can process returns with late penalty calculation (P500/day) and damage fee assessment (P1000), plus capture return condition photos.
- As Staff, I can view inventory in read-only mode with real-time status (Available, Rented, Cleaning, Damaged).
- As Staff, I can search customer records and transaction history.
- As Staff, I can view upcoming reservations and task lists.
- As Staff, I can send SMS reminders to customers via Semaphore API integration.
- As Staff, I can access key functions (view reservation list, mark returned, view customer contact) offline when internet is slow or unavailable.

### 4.3 Customer

- As Customer, I can browse the boutique's digital catalog with search and category filters.
- As Customer, I can check date-specific availability before booking.
- As Customer, I can register and log in to manage my bookings.
- As Customer, I can select a size and optionally provide custom measurements.
- As Customer, I can book an item with a minimum P200 downpayment via GCash or card.
- As Customer, I can receive SMS booking confirmation and return deadline reminders.
- As Customer, I can chat with the AI stylist (Gemini API) for outfit recommendations and FAQ answers.
- As Customer, I can view my transaction history and booking receipt with QR code.

---

## 5. Functional Requirements

### 5.1 User Management

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | System shall support registration and login with secure authentication | High |
| FR-02 | System shall implement RBAC with three roles: Admin, Staff, Customer | High |
| FR-03 | Admin shall be able to create, edit, and remove staff accounts | High |
| FR-04 | Customers shall have a personal profile with name, contact, address | Medium |

### 5.2 Inventory Management

| ID | Requirement | Priority |
|---|---|---|
| FR-05 | Admin/Staff shall be able to add, update, and delete rental items | High |
| FR-06 | Items shall be categorized (Gown, Suit, Barong, Filipiniana, Costume) | High |
| FR-07 | Each item shall have: name, category, price, image, status (Available, Rented, Reserved, Cleaning, Damaged, Maintenance) | High |
| FR-08 | Item availability shall update in real-time based on transactions | High |
| FR-09 | Items shall support sizes (XS through XXL) and custom measurements | Medium |
| FR-10 | Staff shall capture and upload garment condition photos upon release and return | Medium |

### 5.3 Reservation / Booking System

| ID | Requirement | Priority |
|---|---|---|
| FR-11 | Customers shall browse catalog with search and category filtering | High |
| FR-12 | Customers shall check date-specific availability before booking | High |
| FR-13 | Customers shall book items with a 3-day rental period | High |
| FR-14 | Staff shall create rentals on behalf of customers (in-store) | High |
| FR-15 | System shall generate unique booking/transaction IDs | High |
| FR-16 | Customers and staff shall be able to cancel bookings | Medium |
| FR-17 | System shall display a reservation calendar for staff/admin | Medium |

### 5.4 Payment Management

| ID | Requirement | Priority |
|---|---|---|
| FR-18 | Customers shall make downpayments (minimum P200) via online payment gateway | High |
| FR-19 | System shall track downpayment and remaining balance per transaction | High |
| FR-20 | System shall generate invoices and receipts | Medium |
| FR-21 | System shall maintain full payment history records | Medium |

### 5.5 Return Processing

| ID | Requirement | Priority |
|---|---|---|
| FR-22 | Staff shall process returns with condition check | High |
| FR-23 | System shall auto-calculate late penalties (P500/day) based on return date vs. due date | High |
| FR-24 | System shall assess damage fees (P1000) via staff toggle | High |
| FR-25 | Staff shall capture return condition photos (linked to transaction) | Medium |
| FR-26 | Upon return, item status shall update to "Cleaning" then "Available" | High |

### 5.6 AI & Demand Forecasting

| ID | Requirement | Priority |
|---|---|---|
| FR-27 | System shall generate AI business reports via Google Gemini API with natural-language analysis of revenue, inventory, and trends | High |
| FR-28 | System shall implement rule-based SMA (3-month window) demand forecasting | High |
| FR-29 | System shall display demand forecast charts with projected rental counts and revenue | High |
| FR-30 | System shall identify underperforming items and suggest promotions | Medium |
| FR-31 | System shall provide an AI customer assistant chatbot (Gemini API with FAQ fallback) for personalized recommendations | High |

### 5.7 Notifications

| ID | Requirement | Priority |
|---|---|---|
| FR-32 | System shall send SMS booking confirmations via Semaphore API | High |
| FR-33 | System shall send SMS return deadline reminders | High |
| FR-34 | System shall send SMS late return notifications | Medium |
| FR-35 | Staff shall be able to manually send SMS messages to customers from the system | Medium |

### 5.8 Search & Filtering

| ID | Requirement | Priority |
|---|---|---|
| FR-36 | Customers/staff shall search inventory by item name | High |
| FR-37 | Inventory shall be filterable by category, price range, and availability status | High |
| FR-38 | Staff/admin shall search transactions by customer name, item, date, or status | Medium |

### 5.9 Dashboard & Reporting

| ID | Requirement | Priority |
|---|---|---|
| FR-39 | Admin/Staff dashboard shall show real-time KPIs (active rentals, pending returns, revenue, damaged items) | High |
| FR-40 | Admin dashboard shall include demand forecast chart and AI insights panel | High |
| FR-41 | System shall provide revenue, reservation, and customer activity reports | Medium |
| FR-42 | Customer dashboard shall show AI stylist prompt and recommended items | Medium |

### 5.10 Offline Capability (PWA)

| ID | Requirement | Priority |
|---|---|---|
| FR-43 | System shall function as a Progressive Web App (installable, service worker) | High |
| FR-44 | Staff shall be able to view reservation lists, mark returns, and view customer contact info while offline | High |
| FR-45 | Offline actions shall sync when connectivity is restored | High |

---

## 6. Non-Functional Requirements

### 6.1 Performance

- Page load time under 3 seconds on standard broadband
- Offline staff operations respond within 1 second
- Backend API responses under 500ms for inventory/catalog queries

### 6.2 Security

- Secure authentication (JWT-based sessions)
- Role-based access enforced at both frontend and API level
- Data backup and recovery procedures
- Audit logs for all transaction modifications
- Environment variables for all API keys (Gemini, Semaphore, payment gateway)

### 6.3 Usability

- Mobile-responsive design matching existing prototype's aesthetic
- Plus Jakarta Sans font family, consistent with prototype
- Framer Motion animations for smooth transitions
- Accessibility: minimum WCAG 2.1 AA compliance

### 6.4 Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Tailwind CSS 3, Framer Motion, Lucide Icons |
| Backend | Node.js / TypeScript |
| Database | TBD |
| PWA | Vite PWA plugin (service worker + manifest) |
| AI | Google Gemini API (gemini-2.5-flash) |
| SMS | Semaphore API |
| Payment | TBD |
| Design | Existing prototype design (replicated/retained) |

### 6.5 Reliability

- Target 99.5% uptime
- Graceful degradation when APIs (Gemini, Semaphore) are unavailable
- Offline queue with conflict resolution

---

## 7. Design Considerations

### 7.1 Visual Direction

- Retain existing design from the prototype (color palette: `#bf4a53` primary, gray-950 backgrounds, white cards, Plus Jakarta Sans font, rounded-3xl cards, shadow-sm treatments)
- All screens, spacing, typography, and component styles from the prototype preserved as the baseline
- Customer portal: elegant, fashion-forward aesthetic
- Admin/Staff portal: functional, data-dense but clean

### 7.2 Existing Prototype Pages

| Route/View | Role(s) | Status |
|---|---|---|
| Landing Page | Public | Built |
| Login | All | Built |
| Admin Dashboard | Admin, Staff | Built |
| Customer Dashboard (Home) | Customer | Built |
| Catalog/Inventory | All | Built |
| Transaction History | All | Built |
| AI Insights | Admin | Built |
| AI Report Modal | Admin | Built |
| AI Chatbot (Stylist) | Customer | Built |
| Staff New Rental | Staff | Built |
| Process Return | Staff | Built |
| Add/Edit Inventory Item | Admin, Staff | Built |
| Profile/Settings | All | Built |
| Staff Tasks | Staff | Built |
| Notifications Dropdown | All | Built |

### 7.3 Mockups

Existing prototype serves as the UI reference. No additional mockups required unless new screens are added (e.g., admin staff management, full customer registration).

---

## 8. Success Metrics

| Metric | Target |
|---|---|
| Customer bookings per month | 30% increase over manual process within 6 months |
| Staff transaction processing time | Reduced by 50% (from manual logbook to digital) |
| No-show rate | Reduced to below 5% via downpayment requirement |
| System uptime | 99.5% |
| Offline reliability | 100% of critical staff functions available offline |
| AI report usage | Admin generates at least 1 report per week |
| Customer satisfaction | 4.5/5 average rating from post-return surveys |

---

## 9. Open Questions / Future Considerations

| Question / Item | Status |
|---|---|
| **Payment gateway selection** | TBD |
| **Database technology** | TBD |
| **Hosting / deployment** | TBD |
| **Customer registration flow** | TBD |
| **Service worker / manifest** | Needs setup |
| **Photo upload storage** | TBD |
| **Dynamic pricing rules** | Future consideration |
| **Automated recommendation system** | Future consideration |
| **Multi-language support** | Future consideration |
| **Barcode/QR scanner for returns** | Future consideration |
| **Inventory barcode labeling** | Future consideration |
