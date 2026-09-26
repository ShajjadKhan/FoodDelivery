// Master Admin Panel Logic
let allRestaurants = [];

function switchAdminTab(tabName) {
  document.querySelectorAll('main > section').forEach(sec => sec.style.display = 'none');
  document.querySelectorAll('.nav-links .nav-link').forEach(btn => {
    btn.classList.remove('active');
    btn.style.background = '#1e293b';
  });

  const target = document.getElementById(`admin-tab-${tabName}`);
  if (target) target.style.display = 'block';

  event.target.classList.add('active');
  event.target.style.background = '#10b981';

  if (tabName === 'bonding') loadConnections();
  if (tabName === 'restaurants') loadRestaurants();
  if (tabName === 'riders') loadRiders();
  if (tabName === 'customers') loadCustomers();
  if (tabName === 'orders') loadAdminOrders();
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Format 16-digit input as XXXX-XXXX-XXXX-XXXX while typing
function formatCodeInput(input) {
  let val = input.value.replace(/[^0-9]/g, '');
  if (val.length > 16) val = val.substring(0, 16);
  const parts = val.match(/.{1,4}/g);
  input.value = parts ? parts.join('-') : val;
}

// Copy Code to Clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied code: ${text}`, 'success');
  }).catch(() => {
    // fallback
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(`Copied code: ${text}`, 'success');
  });
}

// 1. Load Stats
async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats');
    const data = await res.json();
    if (data.success) {
      document.getElementById('statVolume').innerText = `৳${data.stats.totalVolume.toFixed(2)}`;
      document.getElementById('statOrdersCount').innerText = data.stats.totalOrders;
      document.getElementById('statRestaurants').innerText = data.stats.totalRestaurants;
      document.getElementById('statRiders').innerText = data.stats.totalRiders;
      document.getElementById('statConnections').innerText = data.stats.totalConnections;
    }
  } catch (e) {
    console.error('Error loading admin stats:', e);
  }
}

// 2. Load Connections (ProcureFlow / TawreedFlow 16-Digit Bonding)
async function loadConnections() {
  try {
    const res = await fetch('/api/connections');
    const data = await res.json();
    const tbody = document.getElementById('connectionsTableBody');

    // Also populate restaurant selector for bonding
    await populateRestSelect();

    if (!data.success || !data.connections.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--gray-500); padding: 2rem;">No connection bonds established yet. Enter a 16-digit code above to bond!</td></tr>';
      return;
    }

    tbody.innerHTML = data.connections.map(c => `
      <tr>
        <td><strong>${c.restaurant_name}</strong></td>
        <td>
          <span class="code-box">
            ${c.formatted_restaurant_code}
            <button class="copy-btn" onclick="copyToClipboard('${c.formatted_restaurant_code}')" title="Copy">📋</button>
          </span>
        </td>
        <td>
          <strong>${c.user_name}</strong><br>
          <small style="color: var(--gray-500);">${c.user_phone}</small>
        </td>
        <td>
          <span class="code-box">
            ${c.formatted_user_code}
            <button class="copy-btn" onclick="copyToClipboard('${c.formatted_user_code}')" title="Copy">📋</button>
          </span>
        </td>
        <td>
          <span class="badge ${c.role === 'delivery' ? 'badge-food' : 'badge-inventory'}">
            ${c.role === 'delivery' ? '🛵 RIDER' : '🛒 CUSTOMER'}
          </span>
        </td>
        <td>${new Date(c.connected_at).toLocaleDateString()}</td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="disconnectBond(${c.id})">❌ Unbond</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading connections:', e);
  }
}

async function populateRestSelect() {
  try {
    const res = await fetch('/api/admin/restaurants');
    const data = await res.json();
    if (data.success) {
      allRestaurants = data.restaurants;
      const select = document.getElementById('bondRestSelect');
      select.innerHTML = '<option value="">Select Restaurant...</option>' + data.restaurants.map(r => `
        <option value="${r.id}">${r.name} (${r.formatted_code})</option>
      `).join('');
    }
  } catch (e) {
    console.error(e);
  }
}

// Submit Admin Bond
async function submitAdminBond(e) {
  e.preventDefault();
  const targetCode = document.getElementById('targetCodeInput').value;
  const restaurantId = document.getElementById('bondRestSelect').value;

  if (!restaurantId) {
    showToast('Please select a restaurant to bond with', 'error');
    return;
  }

  try {
    const res = await fetch('/api/connections/bond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_code: targetCode,
        restaurant_id: parseInt(restaurantId)
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success');
      playSuccessChime();
      document.getElementById('bondForm').reset();
      loadConnections();
      loadStats();
    } else {
      showToast(data.error || 'Bonding failed', 'error');
    }
  } catch (e) {
    showToast('Network error during bonding', 'error');
  }
}

// Disconnect Bond
async function disconnectBond(id) {
  if (!confirm('Are you sure you want to unbond this connection?')) return;
  try {
    const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'info');
      loadConnections();
      loadStats();
    }
  } catch (e) {
    showToast('Error disconnecting', 'error');
  }
}

// 3. Load Restaurants
async function loadRestaurants() {
  try {
    const res = await fetch('/api/admin/restaurants');
    const data = await res.json();
    const tbody = document.getElementById('restaurantsTableBody');

    if (!data.success || !data.restaurants.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--gray-500);">No restaurants registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.restaurants.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td><strong>${r.name}</strong></td>
        <td>
          <span class="code-box">
            ${r.formatted_code}
            <button class="copy-btn" onclick="copyToClipboard('${r.formatted_code}')" title="Copy">📋</button>
          </span>
        </td>
        <td>${r.owner_name} (${r.phone})</td>
        <td>${r.address}</td>
        <td><strong>${r.check_interval_hours || 7} Hours</strong></td>
        <td><span class="badge badge-food">${r.connected_riders} Riders</span></td>
        <td><strong>${r.total_orders}</strong></td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading restaurants:', e);
  }
}

async function submitAddRestaurant(e) {
  e.preventDefault();
  const payload = {
    restaurant_name: document.getElementById('adminRestName').value,
    owner_name: document.getElementById('adminOwnerName').value,
    phone: document.getElementById('adminRestPhone').value,
    address: document.getElementById('adminRestAddress').value,
    check_interval_hours: document.getElementById('adminRestInterval').value,
    password: document.getElementById('adminRestPassword').value
  };

  try {
    const res = await fetch('/api/admin/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Restaurant ${data.restaurant.name} created! Unique Code: ${data.restaurant.formatted_code}`, 'success');
      playSuccessChime();
      closeModal('addRestaurantModal');
      loadRestaurants();
      loadStats();
    } else {
      showToast(data.error || 'Failed to create restaurant', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// 4. Load Riders
async function loadRiders() {
  try {
    const res = await fetch('/api/users?role=delivery');
    const data = await res.json();
    const tbody = document.getElementById('ridersTableBody');

    if (!data.success || !data.users.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--gray-500);">No riders registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${u.name}</strong></td>
        <td>
          <span class="code-box">
            ${u.formatted_code}
            <button class="copy-btn" onclick="copyToClipboard('${u.formatted_code}')" title="Copy">📋</button>
          </span>
        </td>
        <td>${u.phone}</td>
        <td><strong style="color: var(--primary-dark); font-size: 1rem;">৳${u.cash_balance.toFixed(2)}</strong></td>
        <td>
          <span class="badge ${u.allow_credit ? 'badge-food' : 'badge-inventory'}">
            ${u.allow_credit ? '💳 CREDIT ALLOWED' : '🔒 STRICT FLOAT'}
          </span>
        </td>
        <td><span class="status-badge"><span class="status-dot"></span> Active</span></td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="adminEditRider(${u.id}, ${u.cash_balance}, ${u.allow_credit})">✏️ Float/Credit</button>
        </td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading riders:', e);
  }
}

async function adminEditRider(id, currentBalance, currentCredit) {
  const newBal = prompt('Update Cash Float Balance (৳):', currentBalance);
  if (newBal === null) return;
  const newCredit = confirm('Grant credit collection privilege (bypass cash float restriction)?');

  try {
    const res = await fetch(`/api/users/${id}/delivery-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cash_balance: parseFloat(newBal) || 0,
        allow_credit: newCredit ? 1 : 0
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Rider float updated', 'success');
      loadRiders();
    }
  } catch (e) {
    showToast('Failed to update', 'error');
  }
}

// 5. Load Customers
async function loadCustomers() {
  try {
    const res = await fetch('/api/users?role=customer');
    const data = await res.json();
    const tbody = document.getElementById('customersTableBody');

    if (!data.success || !data.users.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--gray-500);">No customers registered yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${u.name}</strong></td>
        <td>
          <span class="code-box">
            ${u.formatted_code}
            <button class="copy-btn" onclick="copyToClipboard('${u.formatted_code}')" title="Copy">📋</button>
          </span>
        </td>
        <td>${u.phone}</td>
        <td>${new Date(u.created_at).toLocaleDateString()}</td>
        <td><span class="badge badge-delivered">Verified</span></td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading customers:', e);
  }
}

function openAdminAddUserModal(role) {
  document.getElementById('adminUserRole').value = role;
  document.getElementById('adminAddUserTitle').innerText = role === 'delivery' ? '➕ Register Delivery Rider' : '➕ Register Verified Customer';
  document.getElementById('adminRiderFields').style.display = role === 'delivery' ? 'block' : 'none';
  openModal('adminAddUserModal');
}

async function submitAdminAddUser(e) {
  e.preventDefault();
  const role = document.getElementById('adminUserRole').value;
  const payload = {
    name: document.getElementById('adminUserName').value,
    phone: document.getElementById('adminUserPhone').value,
    role,
    password: document.getElementById('adminUserPassword').value,
    cash_balance: role === 'delivery' ? document.getElementById('adminUserCash').value : 0,
    allow_credit: role === 'delivery' && document.getElementById('adminUserCredit').checked ? 1 : 0
  };

  try {
    const res = await fetch('/api/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`User created! Unique Code: ${data.user.formatted_code}`, 'success');
      playSuccessChime();
      closeModal('adminAddUserModal');
      loadStats();
      if (role === 'delivery') loadRiders();
      else loadCustomers();
    } else {
      showToast(data.error || 'Failed to create user', 'error');
    }
  } catch (e) {
    showToast('Network error', 'error');
  }
}

// 6. Load Global Orders
async function loadAdminOrders() {
  try {
    const res = await fetch('/api/orders');
    const data = await res.json();
    const tbody = document.getElementById('adminOrdersTableBody');

    if (!data.success || !data.orders.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--gray-500);">No orders placed yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.orders.map(o => `
      <tr>
        <td><strong>#${o.order_number}</strong></td>
        <td>${o.restaurant_name}</td>
        <td>${o.customer_name} (${o.customer_phone})</td>
        <td>${o.delivery_name || '<em style="color:var(--gray-500);">Unassigned</em>'}</td>
        <td><strong style="color: var(--primary-dark);">৳${o.total_amount}</strong></td>
        <td><span class="badge badge-${o.status.toLowerCase()}">${o.status}</span></td>
        <td><code>${o.delivery_otp}</code></td>
        <td><code>${o.customer_otp}</code></td>
        <td>${new Date(o.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</td>
      </tr>
    `).join('');
  } catch (e) {
    console.error('Error loading global orders:', e);
  }
}

// Socket listener
socket.on('order:new', () => {
  loadStats();
});
socket.on('connection:bonded', (data) => {
  showToast(data.message, 'info');
  loadStats();
  loadConnections();
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  loadConnections();
});
