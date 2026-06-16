// ============================================================
// config/db.js — MySQL Connection Pool (Aiven Cloud Secure)
// ============================================================
// Uses the mysql2/promise driver so every query returns a native
// Promise, enabling clean async/await usage throughout the app.
//
// Pool configuration is driven entirely by environment variables
// so no credentials ever appear in source code.
// ============================================================

'use strict';

const mysql = require('mysql2/promise');

// ---------------------------------------------------------------------------
// Build the connection pool.
// A pool manages a set of pre-opened connections that are reused across
// requests, avoiding the overhead of establishing a new TCP connection on
// every SQL query.
// ---------------------------------------------------------------------------
const pool = mysql.createPool({
  // ── Connection details ────────────────────────────────────────────────────
  host:               process.env.DB_HOST     || 'localhost',
  port:               parseInt(process.env.DB_PORT, 10) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'github_analyzer',
  
  // ── Cloud Security Ingestion ──────────────────────────────────────────────
  // CRITICAL FOR AIVEN HOSTING: Forces SSL handshake encryption since Aiven 
  // explicitly blocks unencrypted traffic (ssl-mode=REQUIRED).
  ssl: {
    rejectUnauthorized: false
  },

  // ── Character set ─────────────────────────────────────────────────────────
  charset:            'utf8mb4',              // Required for emoji / full Unicode

  // ── Pool sizing ───────────────────────────────────────────────────────────
  // connectionLimit: maximum concurrent connections held in the pool.
  // Too high => exhausts MySQL's max_connections; too low => request queuing.
  connectionLimit:    parseInt(process.env.DB_POOL_LIMIT, 10) || 10,

  // queueLimit: 0 = unlimited request queue (safe default for light traffic).
  queueLimit:         0,

  // ── Reliability options ───────────────────────────────────────────────────
  // waitForConnections: queue requests when pool is at capacity instead of
  // throwing an immediate error.
  waitForConnections: true,

  // enableKeepAlive: sends periodic TCP keepalive packets so idle connections
  // are not silently dropped by firewalls or the DB server's wait_timeout.
  enableKeepAlive:    true,
  keepAliveInitialDelay: 10000,              // ms before first keepalive packet

  // timezone: store/retrieve DATETIME values as UTC regardless of the local
  // system clock — critical for portable timestamp handling.
  timezone:           'Z',

  // decimalNumbers: return DECIMAL columns as JS numbers (not strings).
  decimalNumbers:     true,
});

// ---------------------------------------------------------------------------
// testConnection
// Runs a lightweight SELECT 1 probe to verify the pool is healthy.
// Called once at application startup (see server.js).
// ---------------------------------------------------------------------------
async function testConnection() {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.query('SELECT 1');
    console.log('✅  Cloud Aiven MySQL connection pool established successfully.');
  } catch (error) {
    // CRITICAL: Print the raw error object to see the complete network diagnostic payload
    console.error('❌  Failed to connect to MySQL:', error); 
    throw error;
  } finally {
    if (connection) connection.release();
  }
}

module.exports = { pool, testConnection };