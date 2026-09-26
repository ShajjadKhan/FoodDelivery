# 📋 Food Delivery System - End-to-End Workflow & Verification Guide

This document explains the lifecycle of an order and how each mechanism works.

---

## 🔄 End-to-End Order Lifecycle

```
[Customer Portal]             [Restaurant Portal]          [Delivery Radar]
      |                               |                           |
      |--- 1. Places Order ---------->|                           |
      |    (WebSocket + Sound)        |                           |
      |                               |--- 2. Accepts Order       |
      |<-- Status: Accepted ----------|                           |
      |                               |                           |
      |                               |--- 3. Kitchen Prepares    |
      |                               |                           |
      |                               |--- 4. "Ready for Pickup"  |
      |                               |       (Generates 8-digit) |
      |                               |                           |--- 5. Radar Beeps & WhatsApp
      |                               |                           |       (Shows 8-Digit OTP)
      |                               |                           |
      |                               |                           |--- 6. Rider clicks Accept
      |                               |                           |       * Pathao Float Verified
      |                               |                           |       * Enters 8-Digit OTP
      |                               |<-- 7. Assigned to Rider --|
      |<-- Status: Picked Up ---------|                           |
      |                               |                           |--- 8. Out for Delivery
      |<-- Status: Out for Delivery --|                           |
      |                                                           |--- 9. Arrives at Customer
      |--- 10. Hands over 4-digit OTP --------------------------->|       Collects Cash
      |                                                           |--- 11. Confirms Handover
      |<-- Status: DELIVERED -------------------------------------|
```

---

## 🧪 Testing Walkthrough

### Test Case 1: 7-Hour Food Reminder
1. Open Restaurant Portal (`/restaurant.html`).
2. Notice the yellow banner or click the **"⏰ Kitchen Food Check"** button.
3. A modal opens showing fresh food items.
4. Toggle availability or click **"✅ All Available"** to verify and reset the 7-hour interval.

### Test Case 2: Placing an Order & Restaurant Approval
1. Open Customer Portal (`/customer.html`).
2. Add "Royal Kacchi Biryani" and "Traditional Borhani" to cart.
3. Click "🛍️ Cart" and submit checkout.
4. Immediate sound chime rings on the Restaurant Portal!
5. In Restaurant Portal, click **"✅ Accept Order"**.
6. Customer screen immediately updates to "🍳 Kitchen Preparing".

### Test Case 3: 8-Digit OTP & Pathao Cash Float Verification
1. In Restaurant Portal, click **"📦 Mark Ready for Delivery"**.
2. Notice:
   - System displays the generated 8-digit OTP (e.g. `48291047`).
   - Radar chime sounds on the Delivery Portal (`/delivery.html`).
   - WhatsApp push notification drawer shows the message and 8-digit OTP.
3. In Delivery Portal:
   - Select rider **"Rahim Ahmed"** (Cash Float: ৳1,500, Strict mode).
   - If order value exceeds float balance, acceptance is prevented.
   - Click **"🚀 Accept Delivery"** $\to$ OTP verification modal pops up!
   - Enter the 8-digit OTP to claim the delivery.

### Test Case 4: Final Handover & Cash Collection
1. Rider clicks **"🚀 Start Journey (Out for Delivery)"**.
2. When arrived, rider clicks **"💰 Deliver & Collect Cash"**.
3. Rider inputs the 4-digit Customer Confirmation OTP (visible on customer's tracker screen).
4. System validates the code, marks order as `DELIVERED`, updates rider's cash in hand, and notifies all parties in real time.
