// Customer Portal Logic
let currentCustomer = null;
let cart = [];
let activeOrder = null;

// Modal Helpers
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function toggleCartDrawer() {
  renderCart();
  openModal('cartModal');
}

// 1. Load Customers
async function loadCustomers() {
  try {
    const res = await fetch('/api/users?role=customer');
    const data = await res.json();
    if (data.success && data.users.length) {
      const select = document.getElementById('customerSelect');
      select.innerHTML = data.users.map(u => `
        <option value="${u.id}">${u.name} (${u.phone})</option>
      `).join('');

      currentCustomer = data.users[0];
      document.getElementById('orderPhone').value = currentCustomer.phone;
    }
  } catch (e) {
    console.error('Error loading customers:', e);
  }
}

function changeCustomer() {
  const select = document.getElementById('customerSelect');
  const userId = select.value;
  // find customer
  fetch('/api/users?role=customer')
    .then(r => r.json())
    .then(d => {
      currentCustomer = d.users.find(u => u.id == userId);
      if (currentCustomer) {
        document.getElementById('orderPhone').value = currentCustomer.phone;
      }
    });
}

// 2. Load Products Menu
async function loadMenu() {
  try {
    const res = await fetch('/api/products');
    const data = await res.json();
    const container = document.getElementById('customerMenuGrid');

    if (!data.success || !data.products.length) {
      container.innerHTML = '<div style="text-align: center; color: var(--gray-500); padding: 2rem; grid-column: 1 / -1;">No food items available right now.</div>';
      return;
    }

    container.innerHTML = data.products.map(p => {
      const isFood = p.item_type === 'food';
      const available = p.is_available === 1 && (isFood || p.stock_quantity > 0);

      const typeBadge = isFood
        ? `<span class="badge badge-food">🍲 Fresh Food</span>`
        : `<span class="badge badge-inventory">📦 In Stock: ${p.stock_quantity}</span>`;

      return `
        <div class="product-card" style="${!available ? 'opacity: 0.6;' : ''}">
          <div>
            <div class="product-header">
              <span class="product-title">${p.name}</span>
              ${typeBadge}
            </div>
            <div class="product-desc">${p.description || 'Specially prepared authentic culinary dish.'}</div>
            <div class="product-price">৳${p.price}</div>
          </div>

          <div style="margin-top: 1rem;">
            ${available ? `
              <button class="btn btn-primary btn-sm" style="width: 100%;" onclick="addToCart(${p.id}, '${p.name.replace(/'/g, "\\'")}', ${p.price}, ${isFood ? 99 : p.stock_quantity})">
                ➕ Add to Cart
              </button>
            ` : `
              <button class="btn btn-secondary btn-sm" style="width: 100%;" disabled>
                ❌ Out of Stock
              </button>
            `}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading menu:', e);
  }
}

// 3. Cart Management
function addToCart(productId, name, price, maxStock) {
  const existing = cart.find(i => i.product_id === productId);
  if (existing) {
    if (existing.quantity >= maxStock) {
      showToast(`Maximum stock reached for ${name}`, 'warning');
      return;
    }
    existing.quantity++;
  } else {
    cart.push({ product_id: productId, name, price, quantity: 1, maxStock });
  }

  showToast(`Added ${name} to cart`, 'info');
  updateCartBadge();
}

function updateCartBadge() {
  const totalCount = cart.reduce((sum, i) => sum + i.quantity, 0);
  document.getElementById('cartCount').innerText = totalCount;
}

function renderCart() {
  const container = document.getElementById('cartItemsList');
  if (!cart.length) {
    container.innerHTML = '<div style="text-align: center; color: var(--gray-500); padding: 1.5rem;">Your cart is empty. Pick some tasty food!</div>';
    document.getElementById('cartSubtotal').innerText = '৳0.00';
    document.getElementById('cartTotal').innerText = '৳50.00';
    return;
  }

  let subtotal = 0;
  container.innerHTML = cart.map((item, index) => {
    const itemTotal = item.price * item.quantity;
    subtotal += itemTotal;

    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--gray-200);">
        <div style="flex: 1;">
          <strong>${item.name}</strong>
          <div style="font-size: 0.8rem; color: var(--gray-500);">৳${item.price} each</div>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="changeQty(${index}, -1)" style="padding: 2px 8px;">-</button>
          <span style="font-weight: bold; min-width: 20px; text-align: center;">${item.quantity}</span>
          <button class="btn btn-secondary btn-sm" onclick="changeQty(${index}, 1)" style="padding: 2px 8px;">+</button>
          <span style="font-weight: 700; min-width: 60px; text-align: right; color: var(--primary-dark);">৳${itemTotal}</span>
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('cartSubtotal').innerText = `৳${subtotal.toFixed(2)}`;
  document.getElementById('cartTotal').innerText = `৳${(subtotal + 50).toFixed(2)}`;
}

function changeQty(index, delta) {
  if (!cart[index]) return;
  cart[index].quantity += delta;
  if (cart[index].quantity <= 0) {
    cart.splice(index, 1);
  }
  updateCartBadge();
  renderCart();
}

// 4. Checkout Order
async function submitCheckout(e) {
  e.preventDefault();
  if (!cart.length) {
    showToast('Your cart is empty!', 'error');
    return;
  }

  const payload = {
    customer_id: currentCustomer ? currentCustomer.id : 1,
    customer_phone: document.getElementById('orderPhone').value,
    delivery_address: document.getElementById('orderAddress').value,
    special_notes: document.getElementById('orderNotes').value,
    items: cart.map(i => ({ product_id: i.product_id, quantity: i.quantity }))
  };

  try {
    const res = await fetch('/api/orders/place', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Order #${data.order.order_number} placed successfully!`, 'success');
      playSuccessChime();
      cart = [];
      updateCartBadge();
      closeModal('cartModal');
      activeOrder = data.order;
      updateTrackerDisplay(data.order);
      loadMenu(); // Refresh stock
    } else {
      showToast(data.error || 'Failed to place order', 'error');
    }
  } catch (e) {
    showToast('Network error placing order', 'error');
  }
}

// 5. Live Order Tracker Pipeline
function updateTrackerDisplay(order) {
  if (!order) return;
  activeOrder = order;

  const section = document.getElementById('activeOrderSection');
  section.style.display = 'block';

  document.getElementById('trackerOrderNumber').innerText = `Order #${order.order_number} • ৳${order.total_amount}`;
  document.getElementById('customerOtpCode').innerText = order.customer_otp || '----';

  const badgeMap = {
    'PENDING': '<span class="badge badge-pending">PENDING RESTAURANT ACCEPTANCE</span>',
    'ACCEPTED': '<span class="badge badge-accepted">ORDER ACCEPTED</span>',
    'PREPARING': '<span class="badge badge-preparing">KITCHEN PREPARING FOOD</span>',
    'READY_FOR_DELIVERY': '<span class="badge badge-ready">READY FOR PICKUP</span>',
    'PICKED_UP': '<span class="badge badge-picked">RIDER PICKED UP FOOD</span>',
    'OUT_FOR_DELIVERY': '<span class="badge badge-ready">OUT FOR DELIVERY</span>',
    'DELIVERED': '<span class="badge badge-delivered">DELIVERED SUCCESSFULLY</span>'
  };

  document.getElementById('trackerStatusBadge').innerHTML = badgeMap[order.status] || `<span class="badge badge-food">${order.status}</span>`;

  // Step highlight
  const steps = ['pending', 'accepted', 'preparing', 'ready', 'out', 'delivered'];
  steps.forEach(s => {
    const stepEl = document.getElementById(`step-${s}`);
    if (stepEl) {
      stepEl.classList.remove('active', 'completed');
    }
  });

  const statusIndexMap = {
    'PENDING': 0,
    'ACCEPTED': 1,
    'PREPARING': 2,
    'READY_FOR_DELIVERY': 3,
    'PICKED_UP': 4,
    'OUT_FOR_DELIVERY': 4,
    'DELIVERED': 5
  };

  const currIndex = statusIndexMap[order.status] !== undefined ? statusIndexMap[order.status] : 0;
  for (let i = 0; i <= currIndex; i++) {
    const stepEl = document.getElementById(`step-${steps[i]}`);
    if (stepEl) {
      if (i === currIndex) stepEl.classList.add('active');
      else stepEl.classList.add('completed');
    }
  }

  let detailsHtml = `
    <div><strong>Delivery to:</strong> ${order.delivery_address}</div>
  `;
  if (order.delivery_name) {
    detailsHtml += `<div><strong>Assigned Delivery Rider:</strong> ${order.delivery_name} (${order.delivery_phone || ''})</div>`;
  }
  document.getElementById('trackerOrderDetails').innerHTML = detailsHtml;

  // Scroll to tracker
  section.scrollIntoView({ behavior: 'smooth' });
}

// Socket Events
socket.on('order:status_update', (data) => {
  if (activeOrder && activeOrder.id === data.orderId) {
    console.log('Order status updated:', data);
    playTone(700, 'sine', 0.2);
    showToast(`Order Update: ${data.message}`, 'info');

    // Refetch active order details
    fetch(`/api/orders`)
      .then(r => r.json())
      .then(d => {
        const updated = d.orders.find(o => o.id === data.orderId);
        if (updated) updateTrackerDisplay(updated);
      });
  }
});

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadCustomers();
  loadMenu();
});
