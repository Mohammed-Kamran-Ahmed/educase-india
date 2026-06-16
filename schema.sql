-- ============================================================
-- GitHub Profile Analyzer — Database Schema
-- ============================================================
-- Engine  : MySQL 8.0+
-- Charset : utf8mb4 (full Unicode + emoji support)
-- Collation: utf8mb4_unicode_ci
-- ============================================================

-- Create the database if it does not already exist
CREATE DATABASE IF NOT EXISTS github_analyzer
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE github_analyzer;

-- ============================================================
-- TABLE: github_profiles
-- Primary store for every analyzed GitHub user.
-- ON DUPLICATE KEY UPDATE allows upsert semantics so the same
-- username can be re-analyzed and its record refreshed without
-- violating the UNIQUE constraint on `username`.
-- ============================================================
CREATE TABLE IF NOT EXISTS github_profiles (
  -- Surrogate primary key
  id                        INT UNSIGNED      NOT NULL AUTO_INCREMENT,

  -- ── Identity ────────────────────────────────────────────
  username                  VARCHAR(39)       NOT NULL,          -- GitHub max login length
  github_id                 BIGINT UNSIGNED   NOT NULL,          -- Stable numeric GitHub user ID
  full_name                 VARCHAR(255)      DEFAULT NULL,      -- Display name (may be NULL)
  avatar_url                TEXT              DEFAULT NULL,      -- Profile picture URL
  bio                       TEXT              DEFAULT NULL,      -- Free-text biography
  location                  VARCHAR(255)      DEFAULT NULL,      -- Self-reported location
  company                   VARCHAR(255)      DEFAULT NULL,      -- Self-reported company/org
  blog                      TEXT              DEFAULT NULL,      -- Personal website / blog URL
  email                     VARCHAR(255)      DEFAULT NULL,      -- Public e-mail (often NULL)
  twitter_username          VARCHAR(50)       DEFAULT NULL,      -- Twitter/X handle

  -- ── GitHub Core Metrics ─────────────────────────────────
  public_repos              INT UNSIGNED      NOT NULL DEFAULT 0,
  public_gists              INT UNSIGNED      NOT NULL DEFAULT 0,
  followers                 INT UNSIGNED      NOT NULL DEFAULT 0,
  following                 INT UNSIGNED      NOT NULL DEFAULT 0,
  total_stars               INT UNSIGNED      NOT NULL DEFAULT 0,  -- Aggregated across all public repos
  total_forks               INT UNSIGNED      NOT NULL DEFAULT 0,  -- Aggregated across all public repos
  total_watchers            INT UNSIGNED      NOT NULL DEFAULT 0,  -- Aggregated across all public repos
  total_open_issues         INT UNSIGNED      NOT NULL DEFAULT 0,  -- Aggregated across all public repos

  -- ── Computed Analytical Insights ────────────────────────
  top_language              VARCHAR(100)      DEFAULT NULL,      -- Most-used language across repos
  engagement_score          DECIMAL(12, 4)    DEFAULT NULL,      -- (stars + forks) / public_repos
  productivity_index        DECIMAL(12, 4)    DEFAULT NULL,      -- public_repos / years since account creation

  -- ── Repository Language Breakdown ───────────────────────
  -- Stored as a JSON object: { "JavaScript": 12, "Python": 5, ... }
  language_breakdown        JSON              DEFAULT NULL,

  -- ── Top Repositories Snapshot ───────────────────────────
  -- JSON array of top-5 repos by star count, each with name/stars/forks/language
  top_repositories          JSON              DEFAULT NULL,

  -- ── Account Lifecycle Timestamps ────────────────────────
  github_created_at         DATETIME          DEFAULT NULL,      -- When the GitHub account was created
  github_updated_at         DATETIME          DEFAULT NULL,      -- Last GitHub profile update

  -- ── Record Lifecycle Timestamps ─────────────────────────
  -- `analyzed_at` is updated every time the profile is (re-)analyzed.
  -- The 24-hour cache check uses this column.
  analyzed_at               TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP
                                              ON UPDATE CURRENT_TIMESTAMP,
  created_at                TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- ── Constraints ─────────────────────────────────────────
  PRIMARY KEY (id),
  UNIQUE KEY uq_username (username),
  UNIQUE KEY uq_github_id (github_id),
  INDEX idx_analyzed_at (analyzed_at),        -- fast cache-staleness checks
  INDEX idx_followers (followers DESC),        -- sort by popularity
  INDEX idx_public_repos (public_repos DESC)   -- sort by repo count
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Stores analyzed GitHub user profiles with computed insights';

-- ============================================================
-- TABLE: analysis_logs
-- Audit trail of every analysis request (hit vs. cache).
-- Useful for rate-limit monitoring and debugging.
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_logs (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username        VARCHAR(39)   NOT NULL,
  source          ENUM('github_api', 'cache') NOT NULL DEFAULT 'github_api',
  http_status     SMALLINT      NOT NULL DEFAULT 200,  -- GitHub API response code
  response_ms     INT UNSIGNED  DEFAULT NULL,          -- Round-trip latency in milliseconds
  error_message   TEXT          DEFAULT NULL,          -- Captured error detail (if any)
  requested_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_username_log (username),
  INDEX idx_requested_at (requested_at)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log of every analyze request with cache/API source tracking';

-- ============================================================
-- EXAMPLE: ON DUPLICATE KEY UPDATE pattern (used in code)
-- This illustrates how the upsert is structured in the app:
--
--   INSERT INTO github_profiles (username, ...) VALUES (?, ...)
--   ON DUPLICATE KEY UPDATE
--     full_name       = VALUES(full_name),
--     followers       = VALUES(followers),
--     analyzed_at     = CURRENT_TIMESTAMP,
--     ...;
--
-- This ensures a single write handles both first-time inserts
-- and subsequent refreshes without separate SELECT + INSERT logic.
-- ============================================================
