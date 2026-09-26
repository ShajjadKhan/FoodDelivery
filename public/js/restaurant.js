// Restaurant Management Logic
let currentRestaurant = null;
let currentFoodItems = [];

// Switch Navigation Tabs
function switchTab(tabName) {
  document.querySelectorAll('main > section').forEach(sec => sec.style.display = 'none');
  document.querySelectorAll('.nav-links .nav-link').forEach(btn => btn.classList.remove('active'));

  const activeSec = document.getElementById(`tab-${tabName}`);
  if (activeSec) activeSec.style.display = 'block';

  // Find clicked button
  event.target.classList.add('active');

  if (tabName === 'orders') loadOrders();
  if (tabName === 'menu') loadProducts();
  if (tabName === 'users') loadUsers();
  if (tabName === 'bonding') loadRestBonds();
}

// Modal Helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function formatCodeInput(input) {
  let val = input.value.replace(/[^0-9]/g, '');
  if (val.length > 16) val = val.substring(0, 16);
  const parts = val.match(/.{1,4}/g);
  input.value = parts ? parts.join('-') : val;
}

function copyRestCode() {
  if (currentRestaurant && currentRestaurant.formatted_code) {
    navigator.clipboard.writeText(currentRestaurant.formatted_code);
    showToast(`Copied restaurant code: ${currentRestaurant.formatted_code}`, 'success');
  }
}

// Load Restaurant Profile
async function loadProfile() {
  try {
    const res = await fetch('/api/restaurant/profile');
    const data = await res.json();
    if (data.success && data.restaurant) {
      currentRestaurant = data.restaurant;
      document.getElementById('restaurantTitle').innerText = data.restaurant.name;
      document.getElementById('settingInterval').value = data.restaurant.check_interval_hours || 7;
      if (document.getElementById('restUniqueCodeDisplay')) {
        document.getElementById('restUniqueCodeDisplay').innerText = data.restaurant.formatted_code;
      }
    }
  } catch (e) {
    console.error('Error loading restaurant profile:', e);
  }
}

// ==========================================
// 1. ORDERS LOGIC
// ==========================================
async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const data = await res.json();
    const container = document.getElementById('ordersGrid');

    if (!data.success || !data.orders.length) {
      container.innerHTML = '<div style="text-align: center; color: var(--gray-500); padding: 2rem; grid-column: 1 / -1;">No active orders currently. Place an order in the Customer Portal!</div>';
      document.getElementById('pendingCount').innerText = '0';
      return;
    }

    const pendingOrders = data.orders.filter(o => o.status === 'PENDING');
    document.getElementById('pendingCount').innerText = pendingOrders.length;

    container.innerHTML = data.orders.map(order => {
      let statusBadge = `<span class="badge badge-pending">PENDING CONFIRMATION</span>`;
      let actionButtons = '';

      if (order.status === 'PENDING') {
        statusBadge = `<span class="badge badge-pending">NEW ORDER</span>`;
        actionButtons = `
          <button class="btn btn-primary btn-sm" onclick="acceptOrder(${order.id})">✅ Accept Order</button>
        `;
      } else if (order.status === 'ACCEPTED') {
        statusBadge = `<span class="badge badge-preparing">🍳 KITCHEN PREPARING</span>`;
        actionButtons = `
          <button class="btn btn-warning btn-sm" onclick="markReadyForDelivery(${order.id})">📦 Mark Ready for Delivery</button>
        `;
      } else if (order.status === 'READY_FOR_DELIVERY') {
        statusBadge = `<span class="badge badge-ready">🚀 READY FOR DELIVERY</span>`;
        actionButtons = `
          <div class="otp-display-box">
            <div>
              <div style="font-size: 0.7rem; text-transform: uppercase;">8-Digit Delivery OTP</div>
              <div class="otp-code">${order.delivery_otp}</div>
            </div>
            <div style="font-size: 0.72rem; max-width: 140px; text-align: right;">Rider must enter this code to claim job</div>
          </div>
          <small style="color: var(--secondary); font-weight: 700;">📡 Broadcasting to delivery riders...</small>
        `;
      } else if (order.status === 'PICKED_UP' || order.status === 'OUT_FOR_DELIVERY') {
        statusBadge = `<span class="badge badge-picked">🛵 ON THE ROAD</span>`;
        actionButtons = `
          <div style="font-size: 0.825rem; background: var(--gray-100); padding: 0.5rem; border-radius: 6px;">
            <strong>Assigned Rider:</strong> ${order.delivery_name || 'Rider'} (${order.delivery_phone || 'N/A'})
          </div>
        `;
      } else if (order.status === 'DELIVERED') {
        statusBadge = `<span class="badge badge-delivered">🎉 DELIVERED & COLLECTED</span>`;
      }

      const itemsList = (order.items || []).map(i => `
        <div style="display: flex; justify-content: space-between; font-size: 0.825rem; margin-bottom: 2px;">
          <span>${i.quantity}x ${i.product_name}</span>
          <span style="font-weight: 600;">৳${i.subtotal}</span>
        </div>
      `).join('');

      return `
        <div class="card order-card ${order.status.toLowerCase()}">
          <div class="order-top">
            <span class="order-id">#${order.order_number}</span>
            ${statusBadge}
          </div>
          <div style="font-size: 0.8rem; color: var(--gray-500); margin-bottom: 0.5rem;">
            Customer: <strong>${order.customer_name || 'Customer'}</strong> (${order.customer_phone})<br>
            📍 ${order.delivery_address}
          </div>

          <div style="border-top: 1px dashed var(--gray-200); border-bottom: 1px dashed var(--gray-200); padding: 0.5rem 0; margin-bottom: 0.5rem;">
            ${itemsList}
          </div>

          <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 1rem; margin-bottom: 0.75rem;">
            <span>Total to Collect:</span>
            <span style="color: var(--primary-dark);">৳${order.total_amount}</span>
          </div>

          <div>
            ${actionButtons}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading orders:', e);
  }
}

// Accept Order
async function acceptOrder(id) {
  try {
    const res = await fetch(`/api/orders/${id}/accept`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Order #${data.order.order_number} accepted! Kitchen notified.`, 'success');
      playSuccessChime();
      loadOrders();
    } else {
      showToast(data.error || 'Failed to accept order', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// Mark Ready for Delivery (generates 8-digit OTP & notifies delivery persons)
async function markReadyForDelivery(id) {
  try {
    const res = await fetch(`/api/orders/${id}/ready-for-delivery`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Order is Ready! 8-Digit OTP generated & sent to WhatsApp/Radar: ${data.delivery_otp}`, 'success');
      playSuccessChime();
      loadOrders();
    } else {
      showToast(data.error || 'Failed to mark ready', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// ==========================================
// 2. PRODUCTS & INVENTORY LOGIC
// ==========================================
async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    const container = document.getElementById('productsGrid');

    if (!data.success || !data.products.length) {
      container.innerHTML = '<div style="text-align: center; color: var(--gray-500); padding: 2rem; grid-column: 1 / -1;">No products found. Add your first item!</div>';
      return;
    }

    container.innerHTML = data.products.map(p => {
      const isFood = p.item_type === 'food';
      const badge = isFood
        ? `<span class="badge badge-food">🍲 Fresh Food (7h Check)</span>`
        : `<span class="badge badge-inventory">📦 Inventory Item</span>`;

      const inventoryInfo = isFood
        ? `<div class="product-meta">🕒 Last verified: ${new Date(p.last_verified_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>`
        : `<div class="product-meta">📊 Stock: <strong>${p.stock_quantity} units</strong> ${p.expiry_date ? `| Exp: ${p.expiry_date}` : ''}</div>`;

      return `
        <div class="product-card">
          <div>
            <div class="product-header">
              <span class="product-title">${p.name}</span>
              ${badge}
            </div>
            <div class="product-desc">${p.description || 'Delicious freshly prepared item.'}</div>
            <div class="product-price">৳${p.price}</div>
            ${inventoryInfo}
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--gray-200); padding-top: 0.75rem; margin-top: 0.5rem;">
            <label style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; cursor: pointer;">
              <input type="checkbox" ${p.is_available ? 'checked' : ''} onchange="toggleProductAvailability(${p.id}, this.checked)">
              <span style="font-weight: 600;">${p.is_available ? '✅ In Stock' : '❌ Out of Stock'}</span>
            </label>
            <button class="btn btn-secondary btn-sm" onclick="deleteProduct(${p.id})">🗑️ Delete</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading products:', e);
  }
}

function toggleItemTypeFields() {
  const isInventory = document.querySelector('input[name="item_type"][value="inventory"]').checked;
  document.getElementById('inventorySpecificFields').style.display = isInventory ? 'block' : 'none';
}

function openAddProductModal() {
  document.getElementById('addProductForm').reset();
  toggleItemTypeFields();
  openModal('addProductModal');
}

async function submitAddProduct(e) {
  e.preventDefault();
  const itemType = document.querySelector('input[name="item_type"]:checked').value;
  const payload = {
    name: document.getElementById('prodName').value,
    price: document.getElementById('prodPrice').value,
    category: document.getElementById('prodCat').value,
    description: document.getElementById('prodDesc').value,
    item_type: itemType,
    stock_quantity: itemType === 'inventory' ? document.getElementById('prodStock').value : 0,
    expiry_date: itemType === 'inventory' ? document.getElementById('prodExpiry').value : null,
    is_available: 1
  };

  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Product added successfully!', 'success');
      closeModal('addProductModal');
      loadProducts();
    } else {
      showToast(data.error || 'Failed to add product', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function toggleProductAvailability(id, is_available) {
  try {
    await fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_available: is_available ? 1 : 0 })
    });
    showToast('Availability updated', 'info');
    loadProducts();
  } catch (e) {
    showToast('Failed to update availability', 'error');
  }
}

async function deleteProduct(id) {
  if (!confirm('Remove this product from the menu?')) return;
  try {
    await fetch(`/api/products/${id}`, { method: 'DELETE' });
    showToast('Product removed', 'info');
    loadProducts();
  } catch (e) {
    showToast('Error removing product', 'error');
  }
}

// ==========================================
// 3. 7-HOUR FOOD AVAILABILITY REMINDER LOGIC
// ==========================================
async function checkFoodReminderStatus() {
  try {
    const res = await fetch('/api/restaurant/food-check-status');
    const data = await res.json();
    if (data.success) {
      currentFoodItems = data.allFoodItems || [];
      const banner = document.getElementById('availabilityBanner');
      if (data.isDue) {
        banner.style.display = 'block';
      } else {
        banner.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('Error checking food status:', e);
  }
}

function openFoodVerificationModal() {
  const container = document.getElementById('foodCheckItemList');
  if (!currentFoodItems.length) {
    container.innerHTML = '<p style="color:var(--gray-500);">No fresh food items currently in menu.</p>';
  } else {
    container.innerHTML = currentFoodItems.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--gray-200);">
        <div>
          <strong>${item.name}</strong> (৳${item.price})
          <div style="font-size: 0.75rem; color: var(--gray-500);">Fresh kitchen prepared item</div>
        </div>
        <div>
          <label style="display: flex; align-items: center; gap: 0.3rem; font-size: 0.85rem; cursor: pointer;">
            <input type="checkbox" class="food-verify-check" data-id="${item.id}" ${item.is_available ? 'checked' : ''}>
            <span>Still Available</span>
          </label>
        </div>
      </div>
    `).join('');
  }
  openModal('foodVerificationModal');
}

async function submitFoodVerification() {
  const checkboxes = document.querySelectorAll('.food-verify-check');
  const updates = Array.from(checkboxes).map(cb => ({
    id: parseInt(cb.dataset.id),
    is_available: cb.checked
  }));

  try {
    const res = await fetch('/api/restaurant/verify-food', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      playSuccessChime();
      closeModal('foodVerificationModal');
      document.getElementById('availabilityBanner').style.display = 'none';
      loadProducts();
    }
  } catch (e) {
    showToast('Failed to save food verification', 'error');
  }
}

async function quickVerifyAllFood() {
  try {
    const res = await fetch('/api/restaurant/verify-food', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      document.getElementById('availabilityBanner').style.display = 'none';
      playSuccessChime();
      loadProducts();
    }
  } catch (e) {
    showToast('Failed to verify food', 'error');
  }
}

// ==========================================
// 4. AUTHORIZED USERS & FLOAT MANAGEMENT
// ==========================================
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const data = await res.json();
    if (!data.success) return;

    const deliveryContainer = document.getElementById('deliveryUsersList');
    const customerContainer = document.getElementById('customerUsersList');

    const deliveryUsers = data.users.filter(u => u.role === 'delivery');
    const customerUsers = data.users.filter(u => u.role === 'customer');

    deliveryContainer.innerHTML = deliveryUsers.map(u => `
      <div style="border-bottom: 1px solid var(--gray-200); padding: 0.75rem 0;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <strong>${u.name}</strong>
            <div style="font-size: 0.8rem; color: var(--gray-500);">${u.phone}</div>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 800; color: var(--primary-dark); font-size: 1.05rem;">৳${u.cash_balance} Float</div>
            <span class="badge ${u.allow_credit ? 'badge-food' : 'badge-inventory'}">
              ${u.allow_credit ? '💳 Credit Allowed' : '🔒 Strict Cash Float'}
            </span>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="editRiderFloat(${u.id}, ${u.cash_balance}, ${u.allow_credit})">✏️ Adjust Float / Credit</button>
        </div>
      </div>
    `).join('') || '<p style="color:var(--gray-500);">No delivery riders created yet.</p>';

    customerContainer.innerHTML = customerUsers.map(u => `
      <div style="border-bottom: 1px solid var(--gray-200); padding: 0.75rem 0; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${u.name}</strong>
          <div style="font-size: 0.8rem; color: var(--gray-500);">${u.phone}</div>
        </div>
        <span class="badge badge-delivered">Verified Customer</span>
      </div>
    `).join('') || '<p style="color:var(--gray-500);">No verified customers created yet.</p>';
  } catch (e) {
    console.error('Error loading users:', e);
  }
}

function openAddUserModal(role) {
  document.getElementById('addUserForm').reset();
  document.getElementById('userRole').value = role;
  document.getElementById('addUserModalTitle').innerText = role === 'delivery' ? '➕ Register Delivery Rider' : '➕ Register Verified Customer';
  document.getElementById('deliveryRiderFields').style.display = role === 'delivery' ? 'block' : 'none';
  openModal('addUserModal');
}

async function submitAddUser(e) {
  e.preventDefault();
  const role = document.getElementById('userRole').value;
  const payload = {
    name: document.getElementById('userName').value,
    phone: document.getElementById('userPhone').value,
    role,
    password: document.getElementById('userPassword').value,
    cash_balance: role === 'delivery' ? document.getElementById('userCash').value : 0,
    allow_credit: role === 'delivery' && document.getElementById('userAllowCredit').checked ? 1 : 0
  };

  try {
    const res = await fetch('/api/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`User ${data.user.name} created successfully!`, 'success');
      closeModal('addUserModal');
      loadUsers();
    } else {
      showToast(data.error || 'Failed to create user', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function editRiderFloat(id, currentBalance, currentCredit) {
  const newBalance = prompt('Enter new cash float balance (৳):', currentBalance);
  if (newBalance === null) return;

  const newCredit = confirm('Allow this rider to collect orders on credit without cash balance restrictions?');

  try {
    const res = await fetch(`/api/users/${id}/delivery-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cash_balance: parseFloat(newBalance) || 0,
        allow_credit: newCredit ? 1 : 0
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Delivery rider settings updated', 'success');
      loadUsers();
    }
  } catch (e) {
    showToast('Failed to update rider', 'error');
  }
}

// ==========================================
// 5. SETTINGS & 16-DIGIT BONDING
// ==========================================
async function loadRestBonds() {
  if (!currentRestaurant) return;
  try {
    const res = await fetch(`/api/connections?restaurant_id=${currentRestaurant.id}`);
    const data = await res.json();
    if (!data.success) return;

    const ridersContainer = document.getElementById('restBondedRidersList');
    const customersContainer = document.getElementById('restBondedCustomersList');

    const riders = data.connections.filter(c => c.role === 'delivery');
    const customers = data.connections.filter(c => c.role === 'customer');

    ridersContainer.innerHTML = riders.map(r => `
      <div style="border-bottom: 1px solid var(--gray-200); padding: 0.6rem 0; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${r.user_name}</strong> (${r.user_phone})<br>
          <span style="font-family:monospace; background:#e2e8f0; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${r.formatted_user_code}</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="disconnectRestBond(${r.id})">Unbond</button>
      </div>
    `).join('') || '<p style="color:var(--gray-500); padding: 0.5rem 0;">No riders bonded yet. Enter a rider code to connect!</p>';

    customersContainer.innerHTML = customers.map(c => `
      <div style="border-bottom: 1px solid var(--gray-200); padding: 0.6rem 0; display: flex; justify-content: space-between; align-items: center;">
        <div>
          <strong>${c.user_name}</strong> (${c.user_phone})<br>
          <span style="font-family:monospace; background:#e2e8f0; padding:2px 6px; border-radius:4px; font-size:0.75rem;">${c.formatted_user_code}</span>
        </div>
        <button class="btn btn-danger btn-sm" onclick="disconnectRestBond(${c.id})">Unbond</button>
      </div>
    `).join('') || '<p style="color:var(--gray-500); padding: 0.5rem 0;">No customers bonded yet.</p>';
  } catch (e) {
    console.error('Error loading restaurant bonds:', e);
  }
}

async function submitRestaurantBond(e) {
  e.preventDefault();
  if (!currentRestaurant) return;
  const targetCode = document.getElementById('restTargetCode').value;

  try {
    const res = await fetch('/api/connections/bond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_code: targetCode,
        restaurant_id: currentRestaurant.id
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      playSuccessChime();
      document.getElementById('restTargetCode').value = '';
      loadRestBonds();
    } else {
      showToast(data.error || 'Bonding failed', 'error');
    }
  } catch (err) {
    showToast('Network error during bonding', 'error');
  }
}

async function disconnectRestBond(id) {
  if (!confirm('Unbond this user from your restaurant?')) return;
  try {
    const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Unbonded successfully', 'info');
      loadRestBonds();
    }
  } catch (e) {
    showToast('Failed to unbond', 'error');
  }
}

function openSettingsModal() {
  openModal('settingsModal');
}

async function saveSettings() {
  const hours = document.getElementById('settingInterval').value;
  try {
    const res = await fetch('/api/restaurant/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check_interval_hours: hours })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      closeModal('settingsModal');
    }
  } catch (e) {
    showToast('Failed to save settings', 'error');
  }
}

// ==========================================
// 6. REAL-TIME SOCKET EVENTS
// ==========================================
socket.on('order:new', (data) => {
  console.log('New order received:', data);
  playNewOrderChime();
  showToast(data.message, 'warning');
  loadOrders();
});

socket.on('order:status_update', () => {
  loadOrders();
});

socket.on('food:availability_reminder', (data) => {
  console.log('Food availability reminder triggered:', data);
  playRadarAlert();
  document.getElementById('availabilityBanner').style.display = 'block';
  openFoodVerificationModal();
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  loadProfile();
  loadOrders();
  loadProducts();
  checkFoodReminderStatus();
});
