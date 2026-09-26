const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'food_delivery.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Failed to open database:', err.message);
  } else {
    console.log('Connected to isolated SQLite database at:', dbPath);
  }
});

// Enable WAL mode & foreign keys
db.serialize(() => {
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA foreign_keys = ON;');
});

// Promise wrappers
const runAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const getAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
};

const allAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
};

async function initDatabase() {
  // 1. Users table (Anti-fake protection: restaurants create delivery and customers)
  await runAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('restaurant', 'delivery', 'customer')),
      password TEXT DEFAULT '1234',
      cash_balance REAL DEFAULT 0.00,
      allow_credit INTEGER DEFAULT 0,
      created_by INTEGER,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Restaurants profile & settings (configurable 7-hour follow-up)
  await runAsync(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      check_interval_hours INTEGER DEFAULT 7,
      last_availability_check DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. Products table (item_type: 'food' vs 'inventory')
  await runAsync(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      category TEXT DEFAULT 'General',
      image_url TEXT,
      item_type TEXT NOT NULL CHECK(item_type IN ('food', 'inventory')),
      stock_quantity INTEGER DEFAULT 0,
      expiry_date TEXT,
      is_available INTEGER DEFAULT 1,
      last_verified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );
  `);

  // 4. Orders table
  await runAsync(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      restaurant_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      delivery_person_id INTEGER,
      status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'ACCEPTED', 'PREPARING', 'READY_FOR_DELIVERY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED')),
      total_amount REAL NOT NULL,
      delivery_fee REAL DEFAULT 50.00,
      payment_method TEXT DEFAULT 'CASH_ON_DELIVERY',
      payment_status TEXT DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID', 'PAID_TO_DELIVERY', 'SETTLED')),
      delivery_otp TEXT NOT NULL,
      customer_otp TEXT NOT NULL,
      delivery_address TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      special_notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (delivery_person_id) REFERENCES users(id)
    );
  `);

  // 5. Order items
  await runAsync(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
  `);

  // 6. Notification logs (WhatsApp & Web Push)
  await runAsync(`
    CREATE TABLE IF NOT EXISTS notifications_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_phone TEXT NOT NULL,
      recipient_role TEXT NOT NULL,
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      otp_code TEXT,
      status TEXT DEFAULT 'SENT',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. System settings
  await runAsync(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Check if we need to seed demo data
  const userCount = await getAsync('SELECT COUNT(*) as count FROM users');
  if (userCount.count === 0) {
    console.log('Seeding initial data for Food Delivery System...');

    // 1. Restaurant owner
    const restUser = await runAsync(
      `INSERT INTO users (name, phone, role, password) VALUES (?, ?, ?, ?)`,
      ["Sultan's Kitchen & Grill", '01711000001', 'restaurant', '1234']
    );

    // Restaurant details
    const restProfile = await runAsync(
      `INSERT INTO restaurants (user_id, name, address, phone, check_interval_hours) VALUES (?, ?, ?, ?, ?)`,
      [restUser.lastID, "Sultan's Kitchen & Grill", 'Road 11, Banani, Dhaka', '01711000001', 7]
    );

    const restaurantId = restProfile.lastID;

    // 2. Delivery Persons
    // Rahim: Cash in hand ৳1,500, no credit allowed (Pathao strict float mode)
    await runAsync(
      `INSERT INTO users (name, phone, role, password, cash_balance, allow_credit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Rahim Ahmed (Delivery)', '01811000002', 'delivery', '1234', 1500.00, 0, restUser.lastID]
    );

    // Karim: Credit collection allowed by restaurant owner (Can accept even with ৳0 balance)
    await runAsync(
      `INSERT INTO users (name, phone, role, password, cash_balance, allow_credit, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['Karim Khan (Credit Approved)', '01911000003', 'delivery', '1234', 0.00, 1, restUser.lastID]
    );

    // 3. Customer created by restaurant (Anti-fake order protection)
    await runAsync(
      `INSERT INTO users (name, phone, role, password, created_by) VALUES (?, ?, ?, ?, ?)`,
      ['Tanvir Hossain (Customer)', '01700000000', 'customer', '1234', restUser.lastID]
    );

    // 4. Products: Mix of fresh Food items (needs follow-up) and Packaged Inventory items (qty + expiry)
    const sampleProducts = [
      // Fresh Food items (needs periodic 7-hour follow-up verification)
      {
        name: 'Royal Kacchi Biryani (Full)',
        desc: 'Traditional Dum Kacchi with tender mutton, aromatic basmati rice & roasted potato.',
        price: 450.00,
        cat: 'Main Course',
        type: 'food',
        stock: 0,
        exp: null,
        avail: 1
      },
      {
        name: 'Special Beef Tehari',
        desc: 'Old Dhaka mustard oil beef tehari with fresh green chilies.',
        price: 280.00,
        cat: 'Main Course',
        type: 'food',
        stock: 0,
        exp: null,
        avail: 1
      },
      {
        name: 'Chicken Roast & Polao Platter',
        desc: 'Shahi chicken roast with rich masala gravy, served with aromatic chinigura polao.',
        price: 320.00,
        cat: 'Platters',
        type: 'food',
        stock: 0,
        exp: null,
        avail: 1
      },
      // Packaged / Store Inventory items (Quantity + Expiry date)
      {
        name: 'Traditional Borhani (500ml)',
        desc: 'Chilled spiced yogurt drink prepared with sour curd, mint and special masala.',
        price: 90.00,
        cat: 'Beverages',
        type: 'inventory',
        stock: 45,
        exp: '2026-10-15',
        avail: 1
      },
      {
        name: 'Shahi Jorda Sweet',
        desc: 'Authentic ceremonial sweet dessert with baby sweets and dry nuts.',
        price: 80.00,
        cat: 'Dessert',
        type: 'inventory',
        stock: 30,
        exp: '2026-10-12',
        avail: 1
      },
      {
        name: 'Premium Mineral Water (1 Liter)',
        desc: 'Purified mineral bottled drinking water.',
        price: 30.00,
        cat: 'Beverages',
        type: 'inventory',
        stock: 120,
        exp: '2027-01-01',
        avail: 1
      }
    ];

    for (const p of sampleProducts) {
      await runAsync(
        `INSERT INTO products (restaurant_id, name, description, price, category, item_type, stock_quantity, expiry_date, is_available, last_verified_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [restaurantId, p.name, p.desc, p.price, p.cat, p.type, p.stock, p.exp, p.avail]
      );
    }

    console.log('Sample data seeding complete!');
  }
}

module.exports = {
  db,
  runAsync,
  getAsync,
  allAsync,
  initDatabase
};
