'use strict';

require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const apiRoutes = require('./routes/apiRoutes');
const { pool, testConnection } = require('./config/db'); // Imported pool here to execute structural migrations

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ── Middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

console.log("USER:", process.env.DB_USER);
console.log("PASSWORD:", process.env.DB_PASSWORD);

// ── Base Routes ───────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  service:   'GitHub Profile Analyzer API',
  version:   '1.0.0',
  endpoints: {
    analyze:        'POST   /api/analyze/:username',
    list_profiles:  'GET    /api/profiles',
    get_profile:    'GET    /api/profiles/:username',
    delete_profile: 'DELETE /api/profiles/:username',
    global_stats:   'GET    /api/stats',
    health:         'GET    /health',
  },
}));

app.get('/health', (_req, res) => res.json({
  status:    'OK',
  uptime_s:  Math.floor(process.uptime()),
  timestamp: new Date().toISOString(),
}));

app.use('/api', apiRoutes);

// ── Global Error Handler ──────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Error]', err.message);
  const status = err.type === 'entity.parse.failed' ? 400 : (err.status || 500);
  res.status(status).json({
    success: false,
    message: err.type === 'entity.parse.failed' ? 'Invalid JSON in request body.' : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// ── Bootstrap ─────────────────────────────────────────────────
async function bootstrap() {
  try {
    // 1. Establish initial connection
    await testConnection();

    // 2. Run Automated Cloud Migration Check
    console.log('⏳ Verifying cloud database table schemas...');
    
    // Create Profile Store
    await pool.query(`
      CREATE TABLE IF NOT EXISTS github_profiles (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(39) NOT NULL,
        github_id BIGINT UNSIGNED NOT NULL,
        full_name VARCHAR(255) DEFAULT NULL,
        avatar_url TEXT DEFAULT NULL,
        bio TEXT DEFAULT NULL,
        location VARCHAR(255) DEFAULT NULL,
        company VARCHAR(255) DEFAULT NULL,
        blog TEXT DEFAULT NULL,
        email VARCHAR(255) DEFAULT NULL,
        twitter_username VARCHAR(50) DEFAULT NULL,
        public_repos INT UNSIGNED NOT NULL DEFAULT 0,
        public_gists INT UNSIGNED NOT NULL DEFAULT 0,
        followers INT UNSIGNED NOT NULL DEFAULT 0,
        following INT UNSIGNED NOT NULL DEFAULT 0,
        total_stars INT UNSIGNED NOT NULL DEFAULT 0,
        total_forks INT UNSIGNED NOT NULL DEFAULT 0,
        total_watchers INT UNSIGNED NOT NULL DEFAULT 0,
        total_open_issues INT UNSIGNED NOT NULL DEFAULT 0,
        top_language VARCHAR(100) DEFAULT NULL,
        engagement_score DECIMAL(12, 4) DEFAULT NULL,
        productivity_index DECIMAL(12, 4) DEFAULT NULL,
        language_breakdown JSON DEFAULT NULL,
        top_repositories JSON DEFAULT NULL,
        github_created_at DATETIME DEFAULT NULL,
        github_updated_at DATETIME DEFAULT NULL,
        analyzed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_username (username),
        UNIQUE KEY uq_github_id (github_id),
        INDEX idx_analyzed_at (analyzed_at),
        INDEX idx_followers (followers DESC),
        INDEX idx_public_repos (public_repos DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Create Audit Log Store
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analysis_logs (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(39) NOT NULL,
        source ENUM('github_api', 'cache') NOT NULL DEFAULT 'github_api',
        http_status SMALLINT NOT NULL DEFAULT 200,
        response_ms INT UNSIGNED DEFAULT NULL,
        error_message TEXT DEFAULT NULL,
        requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_username_log (username),
        INDEX idx_requested_at (requested_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log('🚀 Database tables verified and successfully matching template specifications!');

    // 3. Initialize HTTP listener
    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 GitHub Profile Analyzer API running → http://localhost:${PORT}`);
      console.log(`   ENV: ${process.env.NODE_ENV || 'development'} | DB: ${process.env.DB_NAME || 'github_analyzer'}`);
    });

    const shutdown = (signal) => {
      console.log(`\n[${signal}] Shutting down...`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
    process.on('unhandledRejection', (r) => { console.error('[UnhandledRejection]', r); shutdown('unhandledRejection'); });

  } catch (err) {
    console.error('❌ Bootstrap failed:', err.message);
    process.exit(1);
  }
}

bootstrap();