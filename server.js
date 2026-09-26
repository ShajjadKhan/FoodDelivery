require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const { db, runAsync, getAsync, allAsync, initDatabase } = require('./db');
const {
  generate8DigitOTP,
  generateCustomerOTP,
  sendNotification,
  notifyDeliveryPersonOrderReady,
  notifyCustomerOrderUpdate
} = require('./notificationService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

const PORT = process.env.PORT || 3333;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Attach io to requests
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ==========================================
// 1. AUTH & USERS (Anti-Fake Order Control)
// ==========================================

// Get all users (filtered by role or all)
app.get('/api/users', async (req, res) => {
  try {
    const { role } = req.query;
    let query = 'SELECT id, name, phone, role, cash_balance, allow_credit, created_by, status, created_at FROM users';
    const params = [];
    if (role) {
      query += ' WHERE role = ?';
      params.push(role);
    }
    query += ' ORDER BY id ASC';
    const users = await allAsync(query, params);
    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new user (Restaurant creates delivery person or customer to prevent fake orders)
app.post('/api/users/create', async (req, res) => {
  try {
    const { name, phone, role, password, cash_balance, allow_credit, created_by } = req.body;
    if (!name || !phone || !role) {
      return res.status(400).json({ success: false, error: 'Name, phone, and role are required.' });
    }

    const existing = await getAsync('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing) {
      return res.status(400).json({ success: false, error: 'User with this phone number already exists.' });
    }

    const result = await runAsync(
      `INSERT INTO users (name, phone, role, password, cash_balance, allow_credit, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        phone,
        role,
        password || '1234',
        parseFloat(cash_balance) || 0.0,
        allow_credit ? 1 : 0,
        created_by || null
      ]
    );

    const newUser = await getAsync('SELECT * FROM users WHERE id = ?', [result.lastID]);

    // If restaurant role, create restaurant profile too
    if (role === 'restaurant') {
      await runAsync(
        `INSERT INTO restaurants (user_id, name, address, phone, check_interval_hours)
         VALUES (?, ?, ?, ?, 7)`,
        [newUser.id, name, 'Main Outlet, Dhaka', phone]
      );
    }

    res.json({ success: true, user: newUser });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Delivery Person float / credit permissions
app.put('/api/users/:id/delivery-settings', async (req, res) => {
  try {
    const { id } = req.params;
    const { cash_balance, allow_credit } = req.body;

    await runAsync(
      `UPDATE users SET cash_balance = ?, allow_credit = ? WHERE id = ?`,
      [parseFloat(cash_balance) || 0.0, allow_credit ? 1 : 0, id]
    );

    const updated = await getAsync('SELECT id, name, phone, role, cash_balance, allow_credit FROM users WHERE id = ?', [id]);
    io.emit('user:updated', updated);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. RESTAURANT SETTINGS & FOOD REMINDERS
// ==========================================

// Get restaurant profile and settings
app.get('/api/restaurant/profile', async (req, res) => {
  try {
    const restaurant = await getAsync('SELECT * FROM restaurants LIMIT 1');
    res.json({ success: true, restaurant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update restaurant settings (e.g. 7-hour reminder interval)
app.post('/api/restaurant/settings', async (req, res) => {
  try {
    const { check_interval_hours } = req.body;
    const hours = parseInt(check_interval_hours) || 7;
    await runAsync('UPDATE restaurants SET check_interval_hours = ?', [hours]);
    res.json({ success: true, message: `Reminder interval set to every ${hours} hours.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get food items needing availability follow-up
app.get('/api/restaurant/food-check-status', async (req, res) => {
  try {
    const restaurant = await getAsync('SELECT * FROM restaurants LIMIT 1');
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });

    const hours = restaurant.check_interval_hours || 7;
    // Find food items whose last verification was more than check_interval_hours ago
    const dueFoodItems = await allAsync(
      `SELECT * FROM products 
       WHERE restaurant_id = ? AND item_type = 'food' 
       AND (julianday('now') - julianday(last_verified_at)) * 24 >= ?`,
      [restaurant.id, hours]
    );

    // Also get all active food items
    const allFoodItems = await allAsync(
      `SELECT * FROM products WHERE restaurant_id = ? AND item_type = 'food'`,
      [restaurant.id]
    );

    res.json({
      success: true,
      intervalHours: hours,
      isDue: dueFoodItems.length > 0,
      dueFoodItems,
      allFoodItems
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Confirm food availability (resets 7-hour timer)
app.post('/api/restaurant/verify-food', async (req, res) => {
  try {
    const { updates } = req.body; // array of { id, is_available }
    if (Array.isArray(updates)) {
      for (const item of updates) {
        await runAsync(
          `UPDATE products SET is_available = ?, last_verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [item.is_available ? 1 : 0, item.id]
        );
      }
    } else {
      // Mark all food items as verified
      await runAsync(
        `UPDATE products SET last_verified_at = CURRENT_TIMESTAMP WHERE item_type = 'food'`
      );
    }

    await runAsync('UPDATE restaurants SET last_availability_check = CURRENT_TIMESTAMP');

    io.emit('menu:updated');
    res.json({ success: true, message: 'Food availability verified successfully. 7-hour reminder timer reset!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. PRODUCTS & INVENTORY
// ==========================================

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const products = await allAsync(`
      SELECT p.*, r.name as restaurant_name 
      FROM products p
      JOIN restaurants r ON p.restaurant_id = r.id
      ORDER BY p.id ASC
    `);
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add new product (with food item vs inventory item selection)
app.post('/api/products', async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      item_type, // 'food' or 'inventory'
      stock_quantity,
      expiry_date,
      is_available
    } = req.body;

    if (!name || !price || !item_type) {
      return res.status(400).json({ success: false, error: 'Name, price, and item type are required.' });
    }

    const restaurant = await getAsync('SELECT id FROM restaurants LIMIT 1');
    const restaurantId = restaurant ? restaurant.id : 1;

    const result = await runAsync(
      `INSERT INTO products (restaurant_id, name, description, price, category, item_type, stock_quantity, expiry_date, is_available, last_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        restaurantId,
        name,
        description || '',
        parseFloat(price),
        category || 'General',
        item_type,
        item_type === 'inventory' ? parseInt(stock_quantity) || 0 : 0,
        item_type === 'inventory' ? expiry_date || null : null,
        is_available !== undefined ? (is_available ? 1 : 0) : 1
      ]
    );

    const newProduct = await getAsync('SELECT * FROM products WHERE id = ?', [result.lastID]);
    io.emit('menu:updated');
    res.json({ success: true, product: newProduct });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update product availability or stock
app.put('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, item_type, stock_quantity, expiry_date, is_available } = req.body;

    await runAsync(
      `UPDATE products SET 
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        category = COALESCE(?, category),
        item_type = COALESCE(?, item_type),
        stock_quantity = COALESCE(?, stock_quantity),
        expiry_date = COALESCE(?, expiry_date),
        is_available = COALESCE(?, is_available),
        last_verified_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name, description, price, category, item_type, stock_quantity, expiry_date, is_available, id]
    );

    const updated = await getAsync('SELECT * FROM products WHERE id = ?', [id]);
    io.emit('menu:updated');
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete product
app.delete('/api/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await runAsync('DELETE FROM products WHERE id = ?', [id]);
    io.emit('menu:updated');
    res.json({ success: true, message: 'Product removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. ORDERS & WORKFLOW
// ==========================================

// Place Order (Customer)
app.post('/api/orders/place', async (req, res) => {
  try {
    const { customer_id, customer_phone, delivery_address, items, special_notes } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ success: false, error: 'Cart is empty!' });
    }

    const restaurant = await getAsync('SELECT * FROM restaurants LIMIT 1');
    const orderNumber = 'FD-' + Math.floor(1000 + Math.random() * 9000);
    const deliveryOTP = generate8DigitOTP(); // 8-digit OTP for Delivery Person
    const customerOTP = generateCustomerOTP(); // Confirmation OTP for Customer

    let subtotal = 0;
    for (const item of items) {
      const prod = await getAsync('SELECT * FROM products WHERE id = ?', [item.product_id]);
      if (!prod) {
        return res.status(400).json({ success: false, error: `Product ID ${item.product_id} not found.` });
      }
      if (prod.item_type === 'inventory' && prod.stock_quantity < item.quantity) {
        return res.status(400).json({ success: false, error: `Not enough stock for ${prod.name}. Available: ${prod.stock_quantity}` });
      }
      subtotal += prod.price * item.quantity;
    }

    const deliveryFee = 50.00;
    const totalAmount = subtotal + deliveryFee;

    // Create Order
    const orderResult = await runAsync(
      `INSERT INTO orders (order_number, restaurant_id, customer_id, status, total_amount, delivery_fee, delivery_otp, customer_otp, delivery_address, customer_phone, special_notes)
       VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        restaurant.id,
        customer_id || 1,
        totalAmount,
        deliveryFee,
        deliveryOTP,
        customerOTP,
        delivery_address || 'Customer Location, Dhaka',
        customer_phone || '01700000000',
        special_notes || ''
      ]
    );

    const orderId = orderResult.lastID;

    // Insert Order Items & decrement inventory stock if applicable
    for (const item of items) {
      const prod = await getAsync('SELECT * FROM products WHERE id = ?', [item.product_id]);
      const itemSubtotal = prod.price * item.quantity;
      await runAsync(
        `INSERT INTO order_items (order_id, product_id, product_name, price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, prod.id, prod.name, prod.price, item.quantity, itemSubtotal]
      );

      if (prod.item_type === 'inventory') {
        await runAsync(
          `UPDATE products SET stock_quantity = MAX(0, stock_quantity - ?) WHERE id = ?`,
          [item.quantity, prod.id]
        );
      }
    }

    const order = await getAsync(
      `SELECT o.*, r.name as restaurant_name, r.address as restaurant_address 
       FROM orders o 
       JOIN restaurants r ON o.restaurant_id = r.id 
       WHERE o.id = ?`,
      [orderId]
    );

    // Send WhatsApp notification to Customer
    await notifyCustomerOrderUpdate(
      order,
      order.customer_phone,
      'Order placed successfully and sent to restaurant for confirmation.',
      io
    );

    // Broadcast new order to restaurant room with sound alert trigger
    io.emit('order:new', {
      order,
      sound: true,
      message: `🔔 New Order #${order.order_number} received! (৳${order.total_amount})`
    });

    res.json({ success: true, order });
  } catch (err) {
    console.error('Order place error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List orders
app.get('/api/orders', async (req, res) => {
  try {
    const { status, delivery_person_id, customer_id } = req.query;
    let query = `
      SELECT o.*, r.name as restaurant_name, r.address as restaurant_address,
             u_c.name as customer_name,
             u_d.name as delivery_name, u_d.phone as delivery_phone
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      JOIN users u_c ON o.customer_id = u_c.id
      LEFT JOIN users u_d ON o.delivery_person_id = u_d.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND o.status = ?';
      params.push(status);
    }
    if (delivery_person_id) {
      query += ' AND o.delivery_person_id = ?';
      params.push(delivery_person_id);
    }
    if (customer_id) {
      query += ' AND o.customer_id = ?';
      params.push(customer_id);
    }

    query += ' ORDER BY o.id DESC';
    const orders = await allAsync(query, params);

    for (const order of orders) {
      order.items = await allAsync('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    }

    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restaurant Accepts Order
app.post('/api/orders/:id/accept', async (req, res) => {
  try {
    const { id } = req.params;
    await runAsync(`UPDATE orders SET status = 'ACCEPTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    const order = await getAsync(`SELECT * FROM orders WHERE id = ?`, [id]);

    await notifyCustomerOrderUpdate(order, order.customer_phone, 'Order accepted by restaurant! Food is being prepared.', io);

    io.emit('order:status_update', {
      orderId: order.id,
      status: 'ACCEPTED',
      orderNumber: order.order_number,
      message: `Restaurant accepted Order #${order.order_number}`
    });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Restaurant marks "Ready for Delivery"
// This triggers WhatsApp notification with 8-digit OTP & WebSocket push to delivery person radar!
app.post('/api/orders/:id/ready-for-delivery', async (req, res) => {
  try {
    const { id } = req.params;
    await runAsync(`UPDATE orders SET status = 'READY_FOR_DELIVERY', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);

    const order = await getAsync(
      `SELECT o.*, r.name as restaurant_name, r.address as restaurant_address 
       FROM orders o 
       JOIN restaurants r ON o.restaurant_id = r.id 
       WHERE o.id = ?`,
      [id]
    );

    // Get active delivery persons to send WhatsApp broadcast with 8-digit OTP
    const deliveryPersons = await allAsync("SELECT * FROM users WHERE role = 'delivery' AND status = 'active'");
    for (const dp of deliveryPersons) {
      await notifyDeliveryPersonOrderReady(order, dp.phone, io);
    }

    // Broadcast to delivery radar
    io.emit('order:ready_for_delivery', {
      order,
      sound: true,
      message: `🚀 Order #${order.order_number} is ready for pickup! 8-digit OTP required to claim.`
    });

    res.json({ success: true, order, delivery_otp: order.delivery_otp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delivery Person Accepts Order
// Must verify:
// 1. Pathao-style cash float rule: if allow_credit == 0, cash_balance must be >= total_amount!
// 2. 8-digit OTP to prevent accidental clicks!
app.post('/api/orders/:id/accept-delivery', async (req, res) => {
  try {
    const { id } = req.params;
    const { delivery_person_id, otp_code } = req.body;

    if (!delivery_person_id) {
      return res.status(400).json({ success: false, error: 'Delivery person ID is required.' });
    }

    if (!otp_code) {
      return res.status(400).json({ success: false, error: '8-digit acceptance code is required!' });
    }

    const order = await getAsync('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found.' });

    if (order.status !== 'READY_FOR_DELIVERY') {
      return res.status(400).json({
        success: false,
        error: `Order cannot be accepted. Current status: ${order.status}`
      });
    }

    // 1. Verify 8-Digit OTP to prevent accidental clicks
    if (order.delivery_otp.trim() !== otp_code.toString().trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid 8-digit OTP code! Please check your Web/WhatsApp notification.'
      });
    }

    // 2. Verify Pathao-style cash float or Credit allowance
    const deliveryUser = await getAsync('SELECT * FROM users WHERE id = ?', [delivery_person_id]);
    if (!deliveryUser) return res.status(404).json({ success: false, error: 'Delivery person not found.' });

    if (!deliveryUser.allow_credit && deliveryUser.cash_balance < order.total_amount) {
      return res.status(400).json({
        success: false,
        error: `❌ Insufficient cash float! Order value is ৳${order.total_amount}, but you only have ৳${deliveryUser.cash_balance} cash in hand. Please top up your cash balance or request credit authorization from restaurant owner.`
      });
    }

    // Assign order to delivery person
    await runAsync(
      `UPDATE orders SET delivery_person_id = ?, status = 'PICKED_UP', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [delivery_person_id, id]
    );

    const updatedOrder = await getAsync(
      `SELECT o.*, r.name as restaurant_name, r.address as restaurant_address,
              u.name as delivery_name, u.phone as delivery_phone
       FROM orders o
       JOIN restaurants r ON o.restaurant_id = r.id
       JOIN users u ON o.delivery_person_id = u.id
       WHERE o.id = ?`,
      [id]
    );

    // Notify Customer
    await notifyCustomerOrderUpdate(
      updatedOrder,
      updatedOrder.customer_phone,
      `Delivery person ${deliveryUser.name} (${deliveryUser.phone}) has picked up your food and is on the way!`,
      io
    );

    io.emit('order:status_update', {
      orderId: updatedOrder.id,
      status: 'PICKED_UP',
      deliveryPersonName: deliveryUser.name,
      message: `Rider ${deliveryUser.name} accepted Order #${order.order_number}`
    });

    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error('Accept delivery error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Out for delivery
app.post('/api/orders/:id/out-for-delivery', async (req, res) => {
  try {
    const { id } = req.params;
    await runAsync(`UPDATE orders SET status = 'OUT_FOR_DELIVERY', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [id]);
    const order = await getAsync('SELECT * FROM orders WHERE id = ?', [id]);

    await notifyCustomerOrderUpdate(
      order,
      order.customer_phone,
      'Rider is near your address. Please keep your cash ready and prepare confirmation OTP!',
      io
    );

    io.emit('order:status_update', {
      orderId: order.id,
      status: 'OUT_FOR_DELIVERY',
      message: `Order #${order.order_number} is out for delivery!`
    });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Complete Delivery (Customer OTP Verification + Cash Collection)
app.post('/api/orders/:id/complete-delivery', async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_otp } = req.body;

    const order = await getAsync('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    // Verify customer OTP
    if (customer_otp && order.customer_otp.trim() !== customer_otp.toString().trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Customer Confirmation OTP! Ask customer to check their WhatsApp/screen.'
      });
    }

    // Mark delivered and payment paid to delivery person
    await runAsync(
      `UPDATE orders SET status = 'DELIVERED', payment_status = 'PAID_TO_DELIVERY', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    // Update delivery person's cash balance
    if (order.delivery_person_id) {
      await runAsync(
        `UPDATE users SET cash_balance = cash_balance + ? WHERE id = ?`,
        [order.total_amount, order.delivery_person_id]
      );
    }

    const updated = await getAsync('SELECT * FROM orders WHERE id = ?', [id]);

    await notifyCustomerOrderUpdate(
      updated,
      updated.customer_phone,
      `🎉 Food delivered successfully! Thank you for ordering from our restaurant.`,
      io
    );

    io.emit('order:status_update', {
      orderId: updated.id,
      status: 'DELIVERED',
      message: `Order #${updated.order_number} completed and cash collected!`
    });

    res.json({ success: true, order: updated, message: 'Delivery completed successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get notification logs
app.get('/api/notifications', async (req, res) => {
  try {
    const logs = await allAsync('SELECT * FROM notifications_log ORDER BY id DESC LIMIT 50');
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 5. PERIODIC BACKGROUND REMINDER CHECKER
// ==========================================
setInterval(async () => {
  try {
    const restaurant = await getAsync('SELECT * FROM restaurants LIMIT 1');
    if (!restaurant) return;

    const hours = restaurant.check_interval_hours || 7;
    const dueFoodItems = await allAsync(
      `SELECT * FROM products 
       WHERE restaurant_id = ? AND item_type = 'food' 
       AND (julianday('now') - julianday(last_verified_at)) * 24 >= ?`,
      [restaurant.id, hours]
    );

    if (dueFoodItems.length > 0) {
      io.emit('food:availability_reminder', {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        intervalHours: hours,
        itemsCount: dueFoodItems.length,
        items: dueFoodItems,
        message: `⏰ [7-HOUR FOOD AVAILABILITY REMINDER] Are your ${dueFoodItems.length} kitchen food items still available right now? Please confirm your inventory!`
      });
    }
  } catch (e) {
    console.error('Periodic reminder check error:', e);
  }
}, 60 * 1000); // Check every minute

// ==========================================
// 6. SOCKET.IO REALTIME EVENTS
// ==========================================
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (room) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room: ${room}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Start Server
async function start() {
  await initDatabase();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🍽️  FOOD DELIVERY SYSTEM SERVER RUNNING ON PORT ${PORT}`);
    console.log(`📡 WebSocket push notifications active`);
    console.log(`🔗 Local / LAN URL: http://10.12.14.16:${PORT}`);
    console.log(`=======================================================`);
  });
}

start().catch(console.error);
