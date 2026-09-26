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

// 16-digit code generator (TawreedFlow / ProcureFlow architecture)
async function generate16DigitUniqueCode() {
  while (true) {
    let code = '';
    for (let i = 0; i < 16; i++) {
      code += Math.floor(Math.random() * 10).toString();
    }
    const userExists = await getAsync('SELECT id FROM users WHERE unique_code = ?', [code]);
    const restExists = await getAsync('SELECT id FROM restaurants WHERE unique_code = ?', [code]);
    if (!userExists && !restExists) {
      return code;
    }
  }
}

// Clean and normalize 16-digit code
function clean16DigitCode(input) {
  if (!input) return '';
  return input.toString().replace(/[^0-9]/g, '');
}

// Format 16-digit code as XXXX-XXXX-XXXX-XXXX
function format16DigitCode(code) {
  const clean = clean16DigitCode(code);
  if (clean.length !== 16) return clean;
  return clean.match(/.{1,4}/g).join('-');
}

async function initDatabase() {
  // 1. Users table (Anti-fake protection & 16-digit unique code bonding)
  await runAsync(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unique_code TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('master_admin', 'restaurant', 'delivery', 'customer')),
      password TEXT DEFAULT '1234',
      cash_balance REAL DEFAULT 0.00,
      allow_credit INTEGER DEFAULT 0,
      created_by INTEGER,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Ensure role CHECK constraint includes 'master_admin'
  try {
    const tableSql = await getAsync("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'");
    if (tableSql && tableSql.sql && !tableSql.sql.includes('master_admin')) {
      console.log('Migrating users table schema to allow master_admin role...');
      await runAsync('PRAGMA foreign_keys = OFF;');
      await runAsync(`
        CREATE TABLE users_temp (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          unique_code TEXT UNIQUE,
          name TEXT NOT NULL,
          phone TEXT UNIQUE NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('master_admin', 'restaurant', 'delivery', 'customer')),
          password TEXT DEFAULT '1234',
          cash_balance REAL DEFAULT 0.00,
          allow_credit INTEGER DEFAULT 0,
          created_by INTEGER,
          status TEXT DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
      await runAsync(`
        INSERT INTO users_temp (id, unique_code, name, phone, role, password, cash_balance, allow_credit, created_by, status, created_at)
        SELECT id, unique_code, name, phone, role, password, cash_balance, allow_credit, created_by, status, created_at FROM users;
      `);
      await runAsync('DROP TABLE users;');
      await runAsync('ALTER TABLE users_temp RENAME TO users;');
      await runAsync('PRAGMA foreign_keys = ON;');
      console.log('Users table schema migration completed.');
    }
  } catch (err) {
    console.error('Schema migration note:', err.message);
  }

  // Migration: Ensure unique_code column exists on users
  const userColumns = await allAsync("PRAGMA table_info(users)");
  if (!userColumns.some(c => c.name === 'unique_code')) {
    await runAsync('ALTER TABLE users ADD COLUMN unique_code TEXT');
  }

  // 2. Restaurants profile & settings (with 16-digit unique code)
  await runAsync(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      unique_code TEXT UNIQUE,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      phone TEXT NOT NULL,
      check_interval_hours INTEGER DEFAULT 7,
      last_availability_check DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Migration: Ensure unique_code column exists on restaurants
  const restColumns = await allAsync("PRAGMA table_info(restaurants)");
  if (!restColumns.some(c => c.name === 'unique_code')) {
    await runAsync('ALTER TABLE restaurants ADD COLUMN unique_code TEXT');
  }

  // 3. Connections table (16-Digit Code Bonding Mechanism from ProcureFlow / TawreedFlow)
  await runAsync(`
    CREATE TABLE IF NOT EXISTS connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('delivery', 'customer')),
      connected_by INTEGER,
      is_active INTEGER DEFAULT 1,
      connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(restaurant_id, user_id),
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. Products table (item_type: 'food' vs 'inventory')
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

  // 5. Orders table
  await runAsync(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      restaurant_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      delivery_person_id INTEGER,
      status TEXT DEFAULT 'PENDING',
      total_amount REAL NOT NULL,
      delivery_fee REAL DEFAULT 50.00,
      payment_method TEXT DEFAULT 'CASH_ON_DELIVERY',
      payment_status TEXT DEFAULT 'UNPAID',
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

  // 6. Order items
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

  // 7. Notification logs
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

  // 8. Ensure Master Admin account exists
  let masterAdmin = await getAsync("SELECT * FROM users WHERE role = 'master_admin'");
  if (!masterAdmin) {
    const adminCode = await generate16DigitUniqueCode();
    await runAsync(
      `INSERT INTO users (unique_code, name, phone, role, password)
       VALUES (?, ?, ?, 'master_admin', 'admin')`,
      [adminCode, 'Platform Owner (Master Admin)', '01799999999']
    );
    console.log(`Master Admin created with 16-digit unique code: ${adminCode}`);
  }

  // Populate missing unique codes for existing users
  const usersMissingCodes = await allAsync('SELECT id FROM users WHERE unique_code IS NULL OR unique_code = ""');
  for (const u of usersMissingCodes) {
    const code = await generate16DigitUniqueCode();
    await runAsync('UPDATE users SET unique_code = ? WHERE id = ?', [code, u.id]);
  }

  // Populate missing unique codes for existing restaurants
  const restsMissingCodes = await allAsync('SELECT id FROM restaurants WHERE unique_code IS NULL OR unique_code = ""');
  for (const r of restsMissingCodes) {
    const code = await generate16DigitUniqueCode();
    await runAsync('UPDATE restaurants SET unique_code = ? WHERE id = ?', [code, r.id]);
  }

  // Ensure default connections exist between demo restaurant and demo riders/customer
  const demoRest = await getAsync('SELECT id FROM restaurants LIMIT 1');
  if (demoRest) {
    const demoRiders = await allAsync("SELECT id FROM users WHERE role = 'delivery'");
    for (const rider of demoRiders) {
      await runAsync(
        `INSERT OR IGNORE INTO connections (restaurant_id, user_id, role, connected_by)
         VALUES (?, ?, 'delivery', 1)`,
        [demoRest.id, rider.id]
      );
    }

    const demoCustomer = await getAsync("SELECT id FROM users WHERE role = 'customer' LIMIT 1");
    if (demoCustomer) {
      await runAsync(
        `INSERT OR IGNORE INTO connections (restaurant_id, user_id, role, connected_by)
         VALUES (?, ?, 'customer', 1)`,
        [demoRest.id, demoCustomer.id]
      );
    }
  }

  console.log('Database initialization and connection bonding structure verified.');
}

module.exports = {
  db,
  runAsync,
  getAsync,
  allAsync,
  initDatabase,
  generate16DigitUniqueCode,
  clean16DigitCode,
  format16DigitCode
};
