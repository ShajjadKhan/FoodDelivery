// Delivery Rider Portal Logic
let currentRider = null;
let ridersList = [];

// Modal Helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// 1. Load Riders List
async function loadRiders() {
  try {
    const res = await fetch('/api/users?role=delivery');
    const data = await res.json();
    if (data.success && data.users.length) {
      ridersList = data.users;
      const select = document.getElementById('riderSelect');
      select.innerHTML = data.users.map(u => `
        <option value="${u.id}">${u.name} (৳${u.cash_balance} ${u.allow_credit ? '• Credit' : '• Float'})</option>
      `).join('');

      // Default to first or saved rider
      const savedId = localStorage.getItem('activeRiderId') || ridersList[0].id;
      select.value = savedId;
      selectRiderById(savedId);
    }
  } catch (e) {
    console.error('Error loading riders:', e);
  }
}

function changeActiveRider() {
  const select = document.getElementById('riderSelect');
  const riderId = select.value;
  localStorage.setItem('activeRiderId', riderId);
  selectRiderById(riderId);
}

function selectRiderById(id) {
  currentRider = ridersList.find(r => r.id == id) || ridersList[0];
  if (!currentRider) return;

  document.getElementById('activeRiderName').innerText = currentRider.name;
  document.getElementById('activeRiderPhone').innerText = `Phone: ${currentRider.phone}`;
  document.getElementById('activeRiderBalance').innerText = `৳${currentRider.cash_balance.toFixed(2)}`;

  if (document.getElementById('riderUniqueCodeDisplay')) {
    document.getElementById('riderUniqueCodeDisplay').innerText = currentRider.formatted_code || '---- ---- ---- ----';
  }

  const badgeEl = document.getElementById('activeRiderCreditBadge');
  if (currentRider.allow_credit) {
    badgeEl.innerHTML = `<span class="badge badge-food" style="background:#d1fae5;color:#065f46;border-color:#a7f3d0;">💳 CREDIT APPROVED</span>`;
    document.getElementById('floatRuleExplainer').innerHTML = `
      <strong>Credit Collection Active:</strong> You are authorized to accept any delivery orders without cash float restrictions!
    `;
  } else {
    badgeEl.innerHTML = `<span class="badge badge-inventory" style="background:#fee2e2;color:#991b1b;border-color:#fecaca;">🔒 STRICT CASH FLOAT</span>`;
    document.getElementById('floatRuleExplainer').innerHTML = `
      <strong>Pathao Dispatch Rule:</strong> You have ৳${currentRider.cash_balance.toFixed(2)} cash float. You can only claim orders with total value ≤ ৳${currentRider.cash_balance.toFixed(2)}.
    `;
  }

  loadRadarOrders();
  loadMyActiveOrders();
}

function copyRiderCode() {
  if (currentRider && currentRider.formatted_code) {
    navigator.clipboard.writeText(currentRider.formatted_code);
    showToast(`Copied rider code: ${currentRider.formatted_code}`, 'success');
  }
}

function formatCodeInput(input) {
  let val = input.value.replace(/[^0-9]/g, '');
  if (val.length > 16) val = val.substring(0, 16);
  const parts = val.match(/.{1,4}/g);
  input.value = parts ? parts.join('-') : val;
}

async function submitRiderBond(e) {
  e.preventDefault();
  if (!currentRider) return;
  const targetCode = document.getElementById('riderConnectCode').value;

  try {
    const res = await fetch('/api/connections/bond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_code: targetCode,
        user_id: currentRider.id
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      playSuccessChime();
      document.getElementById('riderConnectCode').value = '';
      loadRadarOrders();
    } else {
      showToast(data.error || 'Failed to bond with restaurant', 'error');
    }
  } catch (err) {
    showToast('Network error bonding with restaurant', 'error');
  }
}

// 2. Load Radar Orders (Orders Ready for Delivery)
async function loadRadarOrders() {
  try {
    const res = await fetch('/api/orders?status=READY_FOR_DELIVERY');
    const data = await res.json();
    const container = document.getElementById('radarGrid');
    const countEl = document.getElementById('radarCount');

    if (!data.success || !data.orders.length) {
      container.innerHTML = '<div style="text-align: center; color: var(--gray-500); padding: 2rem; grid-column: 1 / -1;">No orders currently awaiting pickup. As soon as a kitchen marks an order ready, it will beep here!</div>';
      countEl.innerText = '0';
      return;
    }

    countEl.innerText = data.orders.length;

    container.innerHTML = data.orders.map(order => {
      const riderBalance = currentRider ? currentRider.cash_balance : 0;
      const creditAllowed = currentRider ? currentRider.allow_credit : 0;
      const canAfford = creditAllowed || (riderBalance >= order.total_amount);

      let floatWarning = '';
      if (!canAfford) {
        floatWarning = `
          <div style="background: #fee2e2; border-left: 3px solid #ef4444; color: #991b1b; padding: 0.5rem; border-radius: 4px; font-size: 0.75rem; margin-bottom: 0.5rem;">
            ⚠️ <strong>Insufficient Cash Float!</strong> You have ৳${riderBalance}, but order is ৳${order.total_amount}. Top up float or ask restaurant for credit permission.
          </div>
        `;
      }

      return `
        <div class="card order-card ready">
          <div class="order-top">
            <span class="order-id">#${order.order_number}</span>
            <span class="badge badge-ready">READY FOR PICKUP</span>
          </div>

          <div style="font-size: 0.85rem; margin-bottom: 0.75rem;">
            <div>🏪 <strong>${order.restaurant_name}</strong></div>
            <div style="color: var(--gray-500); font-size: 0.78rem;">📍 ${order.restaurant_address}</div>
            <div style="margin-top: 0.35rem;">🏠 <strong>Deliver to:</strong> ${order.delivery_address}</div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; background: white; padding: 0.6rem; border-radius: 6px; border: 1px solid var(--gray-200); margin-bottom: 0.75rem;">
            <div>
              <div style="font-size: 0.7rem; color: var(--gray-500);">ORDER VALUE</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: var(--primary-dark);">৳${order.total_amount}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 0.7rem; color: var(--gray-500);">DELIVERY EARNING</div>
              <div style="font-size: 1.15rem; font-weight: 800; color: #2563eb;">+৳${order.delivery_fee}</div>
            </div>
          </div>

          ${floatWarning}

          <button class="btn ${canAfford ? 'btn-primary' : 'btn-secondary'}" style="width: 100%;" onclick="openClaimModal(${order.id}, '${order.order_number}', ${order.total_amount}, ${canAfford})">
            🚀 Accept Delivery (8-Digit OTP)
          </button>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading radar:', e);
  }
}

// 3. Open Claim Modal with 8-Digit OTP input
function openClaimModal(orderId, orderNum, totalAmount, canAfford) {
  if (!currentRider) {
    showToast('Please select a rider first', 'error');
    return;
  }

  if (!canAfford) {
    showToast(`Cannot accept: Insufficient cash float! Order value is ৳${totalAmount}, you have ৳${currentRider.cash_balance}.`, 'error');
    return;
  }

  document.getElementById('acceptOrderId').value = orderId;
  document.getElementById('inputOtp').value = '';
  document.getElementById('otpOrderSummary').innerHTML = `
    <strong>Order #${orderNum}</strong> • Value: <strong>৳${totalAmount}</strong><br>
    Rider: <strong>${currentRider.name}</strong> (Cash: ৳${currentRider.cash_balance})
  `;

  openModal('otpAcceptModal');
  setTimeout(() => document.getElementById('inputOtp').focus(), 150);
}

// 4. Submit 8-Digit OTP to claim order
async function submitAcceptDelivery(e) {
  e.preventDefault();
  const orderId = document.getElementById('acceptOrderId').value;
  const otpCode = document.getElementById('inputOtp').value.trim();

  try {
    const res = await fetch(`/api/orders/${orderId}/accept-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        delivery_person_id: currentRider.id,
        otp_code: otpCode
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Order #${data.order.order_number} claimed successfully! Proceed to pickup.`, 'success');
      playSuccessChime();
      closeModal('otpAcceptModal');
      loadRadarOrders();
      loadMyActiveOrders();
    } else {
      showToast(data.error || 'Failed to claim order', 'error');
    }
  } catch (e) {
    showToast('Network error claiming order', 'error');
  }
}

// 5. Load My Active Orders
async function loadMyActiveOrders() {
  if (!currentRider) return;
  try {
    const res = await fetch(`/api/orders?delivery_person_id=${currentRider.id}`);
    const data = await res.json();
    const container = document.getElementById('myActiveOrdersGrid');
    const countEl = document.getElementById('myActiveCount');

    if (!data.success) return;

    const activeList = data.orders.filter(o => o.status === 'PICKED_UP' || o.status === 'OUT_FOR_DELIVERY');
    countEl.innerText = activeList.length;

    if (!activeList.length) {
      container.innerHTML = '<div style="color: var(--gray-500); padding: 1rem; grid-column: 1 / -1;">No active deliveries in progress. Claim one from the Radar below!</div>';
      return;
    }

    container.innerHTML = activeList.map(order => {
      const isPickedUp = order.status === 'PICKED_UP';

      return `
        <div class="card order-card active-delivery">
          <div class="order-top">
            <span class="order-id">#${order.order_number}</span>
            <span class="badge ${isPickedUp ? 'badge-picked' : 'badge-ready'}">
              ${isPickedUp ? '📦 PICKED UP AT RESTAURANT' : '🛵 OUT FOR DELIVERY'}
            </span>
          </div>

          <div style="font-size: 0.85rem; margin-bottom: 0.75rem;">
            <div>🏪 <strong>${order.restaurant_name}</strong> (${order.restaurant_address})</div>
            <div style="margin-top: 0.35rem;">🏠 <strong>Deliver to:</strong> ${order.delivery_address}</div>
            <div style="margin-top: 0.35rem;">👤 <strong>Customer:</strong> ${order.customer_name} (${order.customer_phone})</div>
          </div>

          <div style="background: #f8fafc; border: 1px solid var(--gray-200); padding: 0.6rem; border-radius: 6px; margin-bottom: 0.75rem; font-size: 0.85rem;">
            <div style="display: flex; justify-content: space-between;">
              <span>Total Cash to Collect:</span>
              <strong style="color: var(--primary-dark); font-size: 1.05rem;">৳${order.total_amount}</strong>
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem;">
            ${isPickedUp ? `
              <button class="btn btn-warning btn-sm" style="flex: 1;" onclick="startOutForDelivery(${order.id})">
                🚀 Start Journey (Out for Delivery)
              </button>
            ` : ''}

            <button class="btn btn-primary btn-sm" style="flex: 1;" onclick="openCompleteModal(${order.id}, '${order.order_number}', ${order.total_amount}, '${order.customer_phone}')">
              💰 Deliver & Collect Cash
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading active deliveries:', e);
  }
}

// 6. Start Out for Delivery
async function startOutForDelivery(id) {
  try {
    const res = await fetch(`/api/orders/${id}/out-for-delivery`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('Order is now Out for Delivery! Customer notified.', 'info');
      loadMyActiveOrders();
    }
  } catch (e) {
    showToast('Failed to update status', 'error');
  }
}

// 7. Complete Delivery with Customer OTP
function openCompleteModal(orderId, orderNum, totalAmount, customerPhone) {
  document.getElementById('completeOrderId').value = orderId;
  document.getElementById('inputCustomerOtp').value = '';
  document.getElementById('completeOrderSummary').innerHTML = `
    Order: <strong>#${orderNum}</strong><br>
    Customer Phone: <strong>${customerPhone}</strong><br>
    Collect Cash: <strong style="color: #059669; font-size: 1.1rem;">৳${totalAmount}</strong>
  `;
  openModal('completeDeliveryModal');
  setTimeout(() => document.getElementById('inputCustomerOtp').focus(), 150);
}

async function submitCompleteDelivery(e) {
  e.preventDefault();
  const orderId = document.getElementById('completeOrderId').value;
  const customerOtp = document.getElementById('inputCustomerOtp').value.trim();

  try {
    const res = await fetch(`/api/orders/${orderId}/complete-delivery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_otp: customerOtp })
    });
    const data = await res.json();
    if (data.success) {
      showToast('🎉 Delivery Completed and Cash Collected!', 'success');
      playSuccessChime();
      closeModal('completeDeliveryModal');
      // Refresh rider balance and lists
      await loadRiders();
      loadRadarOrders();
      loadMyActiveOrders();
    } else {
      showToast(data.error || 'Failed to complete delivery', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// 8. Update Cash Float Modal
function openUpdateCashModal() {
  if (!currentRider) return;
  document.getElementById('newCashInput').value = currentRider.cash_balance;
  openModal('updateCashModal');
}

async function submitUpdateCash(e) {
  e.preventDefault();
  const newBalance = document.getElementById('newCashInput').value;
  try {
    const res = await fetch(`/api/users/${currentRider.id}/delivery-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cash_balance: parseFloat(newBalance) || 0,
        allow_credit: currentRider.allow_credit
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Cash float updated', 'success');
      closeModal('updateCashModal');
      await loadRiders();
    }
  } catch (e) {
    showToast('Failed to update balance', 'error');
  }
}

// Socket Events
socket.on('order:ready_for_delivery', (data) => {
  console.log('Order Ready Radar Push:', data);
  playRadarAlert();
  showToast(data.message, 'warning');
  loadRadarOrders();
});

socket.on('order:status_update', () => {
  loadRadarOrders();
  loadMyActiveOrders();
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadRiders();
});
