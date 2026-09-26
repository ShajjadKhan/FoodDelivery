require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const {
  db,
  runAsync,
  getAsync,
  allAsync,
  initDatabase,
  generate16DigitUniqueCode,
  clean16DigitCode,
  format16DigitCode
} = require('./db');

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
// 1. MASTER ADMIN & SYSTEM STATS
// ==========================================

// Global Platform Statistics for Master Admin
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalOrders = await getAsync('SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total_volume FROM orders');
    const totalRestaurants = await getAsync('SELECT COUNT(*) as count FROM restaurants');
    const totalRiders = await getAsync("SELECT COUNT(*) as count FROM users WHERE role = 'delivery'");
    const totalCustomers = await getAsync("SELECT COUNT(*) as count FROM users WHERE role = 'customer'");
    const totalConnections = await getAsync('SELECT COUNT(*) as count FROM connections WHERE is_active = 1');

    const recentOrders = await allAsync(`
      SELECT o.*, r.name as restaurant_name, u_c.name as customer_name, u_d.name as delivery_name
      FROM orders o
      JOIN restaurants r ON o.restaurant_id = r.id
      JOIN users u_c ON o.customer_id = u_c.id
      LEFT JOIN users u_d ON o.delivery_person_id = u_d.id
      ORDER BY o.id DESC LIMIT 15
    `);

    res.json({
      success: true,
      stats: {
        totalOrders: totalOrders.count,
        totalVolume: totalOrders.total_volume,
        totalRestaurants: totalRestaurants.count,
        totalRiders: totalRiders.count,
        totalCustomers: totalCustomers.count,
        totalConnections: totalConnections.count
      },
      recentOrders
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Master Admin: List all Restaurants
app.get('/api/admin/restaurants', async (req, res) => {
  try {
    const restaurants = await allAsync(`
      SELECT r.*, u.name as owner_name, u.phone as owner_phone,
             (SELECT COUNT(*) FROM connections c WHERE c.restaurant_id = r.id AND c.role = 'delivery' AND c.is_active = 1) as connected_riders,
             (SELECT COUNT(*) FROM connections c WHERE c.restaurant_id = r.id AND c.role = 'customer' AND c.is_active = 1) as connected_customers,
             (SELECT COUNT(*) FROM products p WHERE p.restaurant_id = r.id) as total_products,
             (SELECT COUNT(*) FROM orders o WHERE o.restaurant_id = r.id) as total_orders
      FROM restaurants r
      JOIN users u ON r.user_id = u.id
      ORDER BY r.id ASC
    `);

    restaurants.forEach(r => {
      r.formatted_code = format16DigitCode(r.unique_code);
    });

    res.json({ success: true, restaurants });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Master Admin: Create Restaurant
app.post('/api/admin/restaurants', async (req, res) => {
  try {
    const { owner_name, phone, password, restaurant_name, address, check_interval_hours } = req.body;
    if (!owner_name || !phone || !restaurant_name) {
      return res.status(400).json({ success: false, error: 'Owner name, phone, and restaurant name are required.' });
    }

    const existing = await getAsync('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing) {
      return res.status(400).json({ success: false, error: 'A user with this phone number already exists.' });
    }

    const userCode = await generate16DigitUniqueCode();
    const restCode = await generate16DigitUniqueCode();

    const userResult = await runAsync(
      `INSERT INTO users (unique_code, name, phone, role, password)
       VALUES (?, ?, ?, 'restaurant', ?)`,
      [userCode, owner_name, phone, password || '1234']
    );

    const restResult = await runAsync(
      `INSERT INTO restaurants (user_id, unique_code, name, address, phone, check_interval_hours)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userResult.lastID, restCode, restaurant_name, address || 'Dhaka', phone, parseInt(check_interval_hours) || 7]
    );

    const newRest = await getAsync('SELECT * FROM restaurants WHERE id = ?', [restResult.lastID]);
    newRest.formatted_code = format16DigitCode(newRest.unique_code);

    res.json({ success: true, restaurant: newRest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 2. 16-DIGIT CODE BONDING & CONNECTIONS
// ==========================================

// Lookup entity by 16-digit Unique Code
app.get('/api/connections/lookup/:code', async (req, res) => {
  try {
    const rawCode = clean16DigitCode(req.params.code);
    if (rawCode.length !== 16) {
      return res.status(400).json({ success: false, error: 'Unique code must be exactly 16 digits.' });
    }

    // Check if it is a restaurant
    const restaurant = await getAsync('SELECT id, unique_code, name, address, phone FROM restaurants WHERE unique_code = ?', [rawCode]);
    if (restaurant) {
      return res.json({
        success: true,
        type: 'restaurant',
        entity: {
          ...restaurant,
          formatted_code: format16DigitCode(restaurant.unique_code)
        }
      });
    }

    // Check if it is a user (delivery or customer)
    const user = await getAsync('SELECT id, unique_code, name, phone, role, cash_balance, allow_credit FROM users WHERE unique_code = ?', [rawCode]);
    if (user) {
      return res.json({
        success: true,
        type: user.role,
        entity: {
          ...user,
          formatted_code: format16DigitCode(user.unique_code)
        }
      });
    }

    return res.status(404).json({ success: false, error: 'No entity found matching this 16-digit unique code.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bond / Connect two entities using 16-Digit Unique Code
// (Modeled on ProcureFlow / TawreedFlow connection bonding)
app.post('/api/connections/bond', async (req, res) => {
  try {
    const { target_code, restaurant_id, user_id, initiator_role } = req.body;
    const cleanCode = clean16DigitCode(target_code);

    if (cleanCode.length !== 16) {
      return res.status(400).json({ success: false, error: 'The connection code must be exactly 16 digits.' });
    }

    let targetRest = null;
    let targetUser = null;

    // 1. Identify target
    const restMatch = await getAsync('SELECT * FROM restaurants WHERE unique_code = ?', [cleanCode]);
    if (restMatch) {
      targetRest = restMatch;
    } else {
      const userMatch = await getAsync('SELECT * FROM users WHERE unique_code = ?', [cleanCode]);
      if (userMatch) {
        targetUser = userMatch;
      }
    }

    if (!targetRest && !targetUser) {
      return res.status(404).json({ success: false, error: 'No restaurant or user found with this 16-digit code.' });
    }

    let finalRestId = null;
    let finalUserId = null;
    let finalRole = null;

    // Case A: A restaurant is connecting to a user (rider or customer) using the user's 16-digit code
    if (restaurant_id && targetUser) {
      finalRestId = restaurant_id;
      finalUserId = targetUser.id;
      finalRole = targetUser.role;
    }
    // Case B: A user (rider or customer) is connecting to a restaurant using the restaurant's 16-digit code
    else if (user_id && targetRest) {
      const currentUser = await getAsync('SELECT * FROM users WHERE id = ?', [user_id]);
      if (!currentUser) return res.status(404).json({ success: false, error: 'User not found.' });
      finalRestId = targetRest.id;
      finalUserId = user_id;
      finalRole = currentUser.role;
    }
    // Case C: Master Admin connecting restaurant and user directly
    else if (targetRest && user_id) {
      const u = await getAsync('SELECT * FROM users WHERE id = ?', [user_id]);
      finalRestId = targetRest.id;
      finalUserId = user_id;
      finalRole = u.role;
    } else if (targetUser && restaurant_id) {
      finalRestId = restaurant_id;
      finalUserId = targetUser.id;
      finalRole = targetUser.role;
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid connection pair. Must connect a Restaurant to a Delivery Rider or Customer.'
      });
    }

    // Insert or reactivate connection
    const existingConn = await getAsync(
      'SELECT * FROM connections WHERE restaurant_id = ? AND user_id = ?',
      [finalRestId, finalUserId]
    );

    if (existingConn) {
      if (existingConn.is_active) {
        return res.json({ success: true, message: 'Entities are already actively connected / bonded.', connection: existingConn });
      } else {
        await runAsync('UPDATE connections SET is_active = 1, connected_at = CURRENT_TIMESTAMP WHERE id = ?', [existingConn.id]);
      }
    } else {
      await runAsync(
        `INSERT INTO connections (restaurant_id, user_id, role, connected_by)
         VALUES (?, ?, ?, ?)`,
        [finalRestId, finalUserId, finalRole, 1]
      );
    }

    const restInfo = await getAsync('SELECT * FROM restaurants WHERE id = ?', [finalRestId]);
    const userInfo = await getAsync('SELECT * FROM users WHERE id = ?', [finalUserId]);

    io.emit('connection:bonded', {
      restaurantId: finalRestId,
      restaurantName: restInfo.name,
      userId: finalUserId,
      userName: userInfo.name,
      role: finalRole,
      message: `🔗 New Bond Established: ${restInfo.name} ↔ ${userInfo.name} (${finalRole.toUpperCase()})`
    });

    res.json({
      success: true,
      message: `🎉 Successfully bonded ${restInfo.name} with ${userInfo.name} (${finalRole})!`,
      restaurant: restInfo,
      user: userInfo
    });
  } catch (err) {
    console.error('Bonding error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// List Connections
app.get('/api/connections', async (req, res) => {
  try {
    const { restaurant_id, user_id, role } = req.query;
    let query = `
      SELECT c.*, r.name as restaurant_name, r.unique_code as restaurant_code, r.phone as restaurant_phone,
             u.name as user_name, u.unique_code as user_code, u.phone as user_phone, u.cash_balance, u.allow_credit
      FROM connections c
      JOIN restaurants r ON c.restaurant_id = r.id
      JOIN users u ON c.user_id = u.id
      WHERE c.is_active = 1
    `;
    const params = [];

    if (restaurant_id) {
      query += ' AND c.restaurant_id = ?';
      params.push(restaurant_id);
    }
    if (user_id) {
      query += ' AND c.user_id = ?';
      params.push(user_id);
    }
    if (role) {
      query += ' AND c.role = ?';
      params.push(role);
    }

    query += ' ORDER BY c.id DESC';
    const connections = await allAsync(query, params);

    connections.forEach(c => {
      c.formatted_restaurant_code = format16DigitCode(c.restaurant_code);
      c.formatted_user_code = format16DigitCode(c.user_code);
    });

    res.json({ success: true, connections });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Disconnect / Unbond
app.delete('/api/connections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await runAsync('UPDATE connections SET is_active = 0 WHERE id = ?', [id]);
    io.emit('connection:unbonded', { id });
    res.json({ success: true, message: 'Connection unbonded successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 3. USERS MANAGEMENT
// ==========================================

// Get all users (filtered by role or all)
app.get('/api/users', async (req, res) => {
  try {
    const { role } = req.query;
    let query = 'SELECT id, unique_code, name, phone, role, cash_balance, allow_credit, created_by, status, created_at FROM users';
    const params = [];
    if (role) {
      query += ' WHERE role = ?';
      params.push(role);
    }
    query += ' ORDER BY id ASC';
    const users = await allAsync(query, params);

    users.forEach(u => {
      u.formatted_code = format16DigitCode(u.unique_code);
    });

    res.json({ success: true, users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new user (Generates 16-Digit Unique Code)
app.post('/api/users/create', async (req, res) => {
  try {
    const { name, phone, role, password, cash_balance, allow_credit, created_by, restaurant_id } = req.body;
    if (!name || !phone || !role) {
      return res.status(400).json({ success: false, error: 'Name, phone, and role are required.' });
    }

    const existing = await getAsync('SELECT id FROM users WHERE phone = ?', [phone]);
    if (existing) {
      return res.status(400).json({ success: false, error: 'User with this phone number already exists.' });
    }

    const uniqueCode = await generate16DigitUniqueCode();

    const result = await runAsync(
      `INSERT INTO users (unique_code, name, phone, role, password, cash_balance, allow_credit, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uniqueCode,
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
    newUser.formatted_code = format16DigitCode(newUser.unique_code);

    // If restaurant role, create restaurant profile too
    if (role === 'restaurant') {
      const restCode = await generate16DigitUniqueCode();
      await runAsync(
        `INSERT INTO restaurants (user_id, unique_code, name, address, phone, check_interval_hours)
         VALUES (?, ?, ?, ?, ?, 7)`,
        [newUser.id, restCode, name, 'Main Outlet, Dhaka', phone]
      );
    }

    // If created by/for a restaurant, automatically bond them via connection table!
    if (restaurant_id && (role === 'delivery' || role === 'customer')) {
      await runAsync(
        `INSERT OR IGNORE INTO connections (restaurant_id, user_id, role, connected_by)
         VALUES (?, ?, ?, ?)`,
        [restaurant_id, newUser.id, role, created_by || 1]
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

    const updated = await getAsync('SELECT id, unique_code, name, phone, role, cash_balance, allow_credit FROM users WHERE id = ?', [id]);
    updated.formatted_code = format16DigitCode(updated.unique_code);
    io.emit('user:updated', updated);
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 4. RESTAURANT SETTINGS & FOOD REMINDERS
// ==========================================

// Get restaurant profile and settings
app.get('/api/restaurant/profile', async (req, res) => {
  try {
    const { id } = req.query;
    let restaurant;
    if (id) {
      restaurant = await getAsync('SELECT * FROM restaurants WHERE id = ?', [id]);
    } else {
      restaurant = await getAsync('SELECT * FROM restaurants LIMIT 1');
    }

    if (restaurant) {
      restaurant.formatted_code = format16DigitCode(restaurant.unique_code);
    }

    res.json({ success: true, restaurant });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update restaurant settings
app.post('/api/restaurant/settings', async (req, res) => {
  try {
    const { check_interval_hours, restaurant_id } = req.body;
    const hours = parseInt(check_interval_hours) || 7;
    const restId = restaurant_id || 1;
    await runAsync('UPDATE restaurants SET check_interval_hours = ? WHERE id = ?', [hours, restId]);
    res.json({ success: true, message: `Reminder interval set to every ${hours} hours.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Food check status
app.get('/api/restaurant/food-check-status', async (req, res) => {
  try {
    const restaurant = await getAsync('SELECT * FROM restaurants LIMIT 1');
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found' });

    const hours = restaurant.check_interval_hours || 7;
    const dueFoodItems = await allAsync(
      `SELECT * FROM products 
       WHERE restaurant_id = ? AND item_type = 'food' 
       AND (julianday('now') - julianday(last_verified_at)) * 24 >= ?`,
      [restaurant.id, hours]
    );

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

// Confirm food availability
app.post('/api/restaurant/verify-food', async (req, res) => {
  try {
    const { updates } = req.body;
    if (Array.isArray(updates)) {
      for (const item of updates) {
        await runAsync(
          `UPDATE products SET is_available = ?, last_verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [item.is_available ? 1 : 0, item.id]
        );
      }
    } else {
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
// 5. PRODUCTS & INVENTORY
// ==========================================

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const { restaurant_id } = req.query;
    let query = `
      SELECT p.*, r.name as restaurant_name 
      FROM products p
      JOIN restaurants r ON p.restaurant_id = r.id
    `;
    const params = [];
    if (restaurant_id) {
      query += ' WHERE p.restaurant_id = ?';
      params.push(restaurant_id);
    }
    query += ' ORDER BY p.id ASC';

    const products = await allAsync(query, params);
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add new product
app.post('/api/products', async (req, res) => {
  try {
    const {
      name,
      description,
      price,
      category,
      item_type,
      stock_quantity,
      expiry_date,
      is_available,
      restaurant_id
    } = req.body;

    if (!name || !price || !item_type) {
      return res.status(400).json({ success: false, error: 'Name, price, and item type are required.' });
    }

    let restId = restaurant_id;
    if (!restId) {
      const rest = await getAsync('SELECT id FROM restaurants LIMIT 1');
      restId = rest ? rest.id : 1;
    }

    const result = await runAsync(
      `INSERT INTO products (restaurant_id, name, description, price, category, item_type, stock_quantity, expiry_date, is_available, last_verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        restId,
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

// Update product
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
// 6. ORDERS & LIFECYCLE
// ==========================================

// Place Order
app.post('/api/orders/place', async (req, res) => {
  try {
    const { customer_id, customer_phone, delivery_address, items, special_notes, restaurant_id } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ success: false, error: 'Cart is empty!' });
    }

    let restId = restaurant_id;
    if (!restId) {
      const rest = await getAsync('SELECT * FROM restaurants LIMIT 1');
      restId = rest ? rest.id : 1;
    }

    const orderNumber = 'FD-' + Math.floor(1000 + Math.random() * 9000);
    const deliveryOTP = generate8DigitOTP();
    const customerOTP = generateCustomerOTP();

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

    const deliveryFee = 15.00;
    const totalAmount = subtotal + deliveryFee;

    const orderResult = await runAsync(
      `INSERT INTO orders (order_number, restaurant_id, customer_id, status, total_amount, delivery_fee, delivery_otp, customer_otp, delivery_address, customer_phone, special_notes)
       VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderNumber,
        restId,
        customer_id || 1,
        totalAmount,
        deliveryFee,
        deliveryOTP,
        customerOTP,
        delivery_address || 'طريق الملك فهد، حي الملقا، الرياض',
        customer_phone || '0558889900',
        special_notes || ''
      ]
    );

    const orderId = orderResult.lastID;

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

    // Notify Customer
    await notifyCustomerOrderUpdate(
      order,
      order.customer_phone,
      'Order placed successfully and sent to restaurant for confirmation.',
      io
    );

    // Broadcast to Restaurant
    io.emit('order:new', {
      order,
      sound: true,
      message: `🔔 طلب جديد #${order.order_number} بقيمة (${order.total_amount} ر.س / SAR)`
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
    const { status, delivery_person_id, customer_id, restaurant_id } = req.query;
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
    if (restaurant_id) {
      query += ' AND o.restaurant_id = ?';
      params.push(restaurant_id);
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
// Dispatches to connected bonded riders first, or all active riders
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

    // Get bonded delivery riders for this restaurant
    let deliveryPersons = await allAsync(`
      SELECT u.* FROM users u
      JOIN connections c ON c.user_id = u.id
      WHERE c.restaurant_id = ? AND c.role = 'delivery' AND c.is_active = 1 AND u.status = 'active'
    `, [order.restaurant_id]);

    // If no specifically bonded riders, broadcast to all active delivery riders
    if (!deliveryPersons.length) {
      deliveryPersons = await allAsync("SELECT * FROM users WHERE role = 'delivery' AND status = 'active'");
    }

    for (const dp of deliveryPersons) {
      await notifyDeliveryPersonOrderReady(order, dp.phone, io);
    }

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

// Delivery Person Accepts Order (8-digit OTP + Float check)
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

    // 1. Verify 8-Digit OTP
    if (order.delivery_otp.trim() !== otp_code.toString().trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid 8-digit OTP code! Please check your Web/WhatsApp notification.'
      });
    }

    // 2. Verify Pathao Cash Float / Credit
    const deliveryUser = await getAsync('SELECT * FROM users WHERE id = ?', [delivery_person_id]);
    if (!deliveryUser) return res.status(404).json({ success: false, error: 'Delivery person not found.' });

    if (!deliveryUser.allow_credit && deliveryUser.cash_balance < order.total_amount) {
      return res.status(400).json({
        success: false,
        error: `❌ رصيد العهدة النقدية غير كافٍ! قيمة الطلب ${order.total_amount} ر.س (SAR)، ورصيدك المتوفر حالياً ${deliveryUser.cash_balance} ر.س. يرجى زيادة العهدة النقدية أو طلب اعتماد التوصيل الآجل من إدارة المتجر.`
      });
    }

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

// Complete Delivery (Customer OTP + Cash Handover)
app.post('/api/orders/:id/complete-delivery', async (req, res) => {
  try {
    const { id } = req.params;
    const { customer_otp } = req.body;

    const order = await getAsync('SELECT * FROM orders WHERE id = ?', [id]);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });

    if (customer_otp && order.customer_otp.trim() !== customer_otp.toString().trim()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Customer Confirmation OTP! Ask customer to check their WhatsApp/screen.'
      });
    }

    await runAsync(
      `UPDATE orders SET status = 'DELIVERED', payment_status = 'PAID_TO_DELIVERY', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

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

// Notification logs
app.get('/api/notifications', async (req, res) => {
  try {
    const logs = await allAsync('SELECT * FROM notifications_log ORDER BY id DESC LIMIT 50');
    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// 7. PERIODIC 7-HOUR REMINDER DAEMON
// ==========================================
setInterval(async () => {
  try {
    const restaurants = await allAsync('SELECT * FROM restaurants');
    for (const rest of restaurants) {
      const hours = rest.check_interval_hours || 7;
      const dueFoodItems = await allAsync(
        `SELECT * FROM products 
         WHERE restaurant_id = ? AND item_type = 'food' 
         AND (julianday('now') - julianday(last_verified_at)) * 24 >= ?`,
        [rest.id, hours]
      );

      if (dueFoodItems.length > 0) {
        io.emit('food:availability_reminder', {
          restaurantId: rest.id,
          restaurantName: rest.name,
          intervalHours: hours,
          itemsCount: dueFoodItems.length,
          items: dueFoodItems,
          message: `⏰ [7-HOUR FOOD AVAILABILITY REMINDER] Are your ${dueFoodItems.length} kitchen food items still available right now? Please confirm your inventory!`
        });
      }
    }
  } catch (e) {
    console.error('Periodic reminder check error:', e);
  }
}, 60 * 1000);

// Socket.io Events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join', (room) => {
    socket.join(room);
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
    console.log(`👑 MASTER ADMIN & 16-DIGIT CODE BONDING ACTIVE`);
    console.log(`📡 WebSocket push notifications active`);
    console.log(`🔗 Local / LAN URL: http://10.12.14.16:${PORT}`);
    console.log(`=======================================================`);
  });
}

start().catch(console.error);
