# 🍲 Real-Time Food Delivery Management Platform

A high-performance, real-time web-based food delivery and inventory management webapp with WebSocket push notifications, 8-digit OTP handover protection, Pathao-style cash float rules, and automated 7-hour food availability checks.

Deployed on port **3333** (`http://10.12.14.16:3333`).

---

## 🚀 Key Architectural Pillars

### 1. 👑 Platform Master Admin & Authority
- Full platform ownership control panel (`/admin.html`).
- Inspect gross order revenue volume, active outlets, fleet statistics, and live orders.
- Create & manage Restaurants, Riders, and Customers.
- Central **16-Digit Connection Bonding Center**: Directly establish or dissolve bonds between any restaurant and any rider or customer.

---

### 2. 🔗 16-Digit Unique Code Connection Bonding (ProcureFlow / TawreedFlow Style)
Every entity in the platform is generated an immutable **16-digit unique numeric code** (formatted as `XXXX-XXXX-XXXX-XXXX`):
- **Restaurant Code** (e.g. `8392-1049-5829-1029`)
- **Delivery Rider Code** (e.g. `1092-3849-2019-4829`)
- **Customer Code** (e.g. `4829-1029-3849-5720`)

**How Connection Bonding Operates:**
1. Any restaurant can enter a rider's or customer's 16-digit code to bond them into their delivery network.
2. Any delivery rider can enter a restaurant's 16-digit code to connect and receive dispatch orders from that kitchen.
3. Master Admin can bond any pairs globally with one click.
4. **Network Protection**: When an order is marked ready for delivery, the system prioritizes dispatch notifications to **bonded riders**, preventing open-access leaks.

---

### 3. 👥 Three Dedicated Stakeholder Roles
- **🏪 Restaurant / Shop**:
  - Live kitchen order management dispatch board.
  - Distinguishes **Fresh Food Items** (subject to 7-hour availability verification) vs. **Packaged Store Inventory** (tracked by quantity & expiry date).
  - Audio chimes upon incoming orders.
  - Generates 8-digit secure handover OTP when food is marked ready.
  - Own 16-digit code display and quick bonding interface.
- **🛵 Delivery Person (Rider)**:
  - Live radar listening for orders marked "Ready for Delivery".
  - **8-digit OTP Modal Requirement**: To prevent accidental clicks, riders must enter the 8-digit code received via Web push / WhatsApp.
  - **Pathao-style Cash Float Rule**: Riders can only accept orders if their cash in hand $\ge$ order total, unless granted credit authorization by the restaurant.
  - Customer handover confirmation with Customer OTP and cash collection.
- **🛒 Customer**:
  - Live menu browsing with real-time stock & fresh badge indicators.
  - Shopping cart with automatic fee calculation.
  - Visual real-time order tracking pipeline (`Placed` $\to$ `Accepted` $\to$ `Kitchen Preparing` $\to$ `Ready` $\to$ `Out for Delivery` $\to$ `Delivered`).
  - Displays customer confirmation OTP for secure final handover.

---

### 2. 🛡️ Anti-Fake Order Closed Ecosystem
To eliminate fraudulent orders and unauthorized accounts:
- Only authenticated restaurant owners can register authorized **Delivery Persons** and **Verified Customers**.
- Customers registered through this pipeline have verified contact phone numbers and records.

---

### 3. 💵 Pathao-Style Cash Float & Credit Balance Control
- Every delivery rider has a **Cash Float Balance** (amount of physical cash currently held).
- **Strict Float Check**: If `allow_credit` is `0`, the rider **cannot** accept any order whose total value exceeds their cash float.
- **Credit Privilege**: Restaurant owners can toggle `Allow Credit Collection` on specific riders to bypass the cash float limit.
- When an order is completed, the cash collected is credited directly into the rider's recorded balance.

---

### 4. ⏰ 7-Hour Food Availability Follow-up System
- Cooked food items can run out unpredictably in a busy kitchen.
- When creating products, items are categorized as:
  - `Food Item`: Fresh kitchen-prepared food. Requires periodic follow-up.
  - `Inventory Item`: Packaged goods with stock count and expiry date.
- Every **7 hours** (configurable in restaurant settings), the server triggers a reminder popup:
  > *"⏰ Kitchen Availability Check: Are your fresh food items still available in your kitchen right now?"*
- Restaurant managers can confirm availability or toggle sold-out items with one click, automatically updating customer menus in real time.

---

### 5. 🔐 Dual-OTP Verification Protocol
- **Delivery Acceptance OTP (8 Digits)**:
  - Sent via WebSocket push notification and WhatsApp simulator to riders.
  - Prevents riders from accidentally accepting jobs with accidental screen taps.
- **Customer Delivery Confirmation OTP (4 Digits)**:
  - Displayed on the customer's live tracker and WhatsApp receipt.
  - Given to the rider upon package arrival to ensure physical delivery and cash collection.

---

## 🌐 Network & Deployment

- **Port**: `3333` (TCP allowed via UFW firewall)
- **Host**: `http://10.12.14.16:3333`
- **Database**: SQLite with WAL mode (`data/food_delivery.db`), completely isolated in `/home/tserver/food_delivery` with **zero interference** with any other projects on the server.
- **Service**: Managed via Systemd (`food-delivery.service`).

---

## 🛠️ Portals & URLs

| Portal | URL | Purpose |
|---|---|---|
| **Portal Hub** | `http://10.12.14.16:3333/` | Central landing & role launcher |
| **Restaurant Portal** | `http://10.12.14.16:3333/restaurant.html` | Kitchen orders, menu & 7h check |
| **Delivery Radar** | `http://10.12.14.16:3333/delivery.html` | Live radar, 8-digit OTP & float check |
| **Customer Portal** | `http://10.12.14.16:3333/customer.html` | Menu, cart & real-time tracker |
