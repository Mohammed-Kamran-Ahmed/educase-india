# GitHub Profile Analyzer API

A production-grade REST API built with **Node.js**, **Express.js**, and **MySQL** that analyzes GitHub user profiles, computes custom analytical insights, and caches results to conserve GitHub API rate limits.

---

## Features

- **Real-time GitHub analysis** — fetches user profile + all public repositories via the GitHub REST API
- **Computed insights** — Top Language, Engagement Score, Productivity Index, Language Breakdown, Top 5 Repositories
- **24-hour caching** — skips external API calls if a fresh record exists in MySQL
- **Audit logging** — every request is logged with source (`github_api` / `cache`), latency, and status
- **Paginated profile list** with optional search
- **Global analytics stats** endpoint
- **Graceful shutdown** — drains in-flight requests before closing
- **Helmet security headers** — hardens the API against common web vulnerabilities

---

## Project Structure

```
github-profile-analyzer/
├── server.js                    # Entry point — middleware, routing, bootstrap
├── package.json
├── schema.sql                   # MySQL DDL — CREATE TABLE statements
├── .env.example                 # Environment variable template
├── .gitignore
├── config/
│   └── db.js                    # MySQL connection pool (mysql2/promise)
├── controllers/
│   └── analyzerController.js    # All business logic, API calls, SQL writes
└── routes/
    └── apiRoutes.js             # Route → Controller mapping
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 18.0 |
| npm | ≥ 9.0 |
| MySQL | ≥ 8.0 |

---

## Setup Instructions

### 1. Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/github-profile-analyzer.git
cd github-profile-analyzer
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Open `.env` and fill in your values:

```env
PORT=3000
NODE_ENV=development

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=github_analyzer

# Highly recommended — raises rate limit from 60 to 5,000 req/hour
GITHUB_TOKEN=ghp_your_token_here
```

> **Get a GitHub token:** [https://github.com/settings/tokens](https://github.com/settings/tokens)  
> No special scopes are required for public data.

### 4. Initialize the Database

Log into MySQL and run the schema file:

```bash
mysql -u root -p < schema.sql
```

Or manually:

```sql
CREATE DATABASE IF NOT EXISTS github_analyzer;
USE github_analyzer;
SOURCE schema.sql;
```

### 5. Start the Server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

You should see:

```
✅  MySQL connection pool established successfully.

╔══════════════════════════════════════════════════╗
║      GitHub Profile Analyzer API — Running       ║
╚══════════════════════════════════════════════════╝
🚀  Server    : http://localhost:3000
🌍  Env       : development
🗄️  Database  : github_analyzer @ localhost
```

---

## API Reference

### Base URL
```
http://localhost:3000
```

---

### `POST /api/analyze/:username`
Analyze a GitHub user profile. Checks the 24-hour cache first; otherwise fetches from GitHub and upserts into MySQL.

**Example:**
```bash
curl -X POST http://localhost:3000/api/analyze/torvalds
```

**Response:**
```json
{
  "success": true,
  "source": "github_api",
  "response_ms": 1243,
  "data": {
    "username": "torvalds",
    "full_name": "Linus Torvalds",
    "followers": 245000,
    "public_repos": 8,
    "total_stars": 220450,
    "analytics": {
      "top_language": "C",
      "engagement_score": 27556.25,
      "productivity_index": 0.2488,
      "language_breakdown": { "C": 4, "Shell": 2, "Python": 1 },
      "top_repositories": [ ... ]
    }
  }
}
```

---

### `GET /api/profiles`
Returns a paginated list of all analyzed profiles, sorted by most recently analyzed.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Records per page (max 100) |
| `search` | string | — | Filter by username or full name |

**Example:**
```bash
curl http://localhost:3000/api/profiles?page=1&limit=10&search=linus
```

---

### `GET /api/profiles/:username`
Fetches the full analytical record (including JSON blobs and audit trail) for a single username.

**Example:**
```bash
curl http://localhost:3000/api/profiles/torvalds
```

Returns `404` if the username has never been analyzed.

---

### `DELETE /api/profiles/:username`
Removes a profile and its audit logs from the database, forcing a fresh API fetch on the next `POST /api/analyze/:username`.

**Example:**
```bash
curl -X DELETE http://localhost:3000/api/profiles/torvalds
```

---

### `GET /api/stats`
Returns aggregate statistics across all analyzed profiles.

**Example:**
```bash
curl http://localhost:3000/api/stats
```

---

### `GET /health`
Liveness probe for load balancers and monitoring services.

```bash
curl http://localhost:3000/health
```

---

## Computed Analytics Explained

| Metric | Formula | Description |
|--------|---------|-------------|
| **Top Language** | `max(language_tally)` | Most-used language across all public repos |
| **Engagement Score** | `(total_stars + total_forks) / public_repos` | Measures how engaging a user's work is per repo |
| **Productivity Index** | `public_repos / years_on_github` | Repos created per year since account registration |

---

## Database Schema

Two tables are created by `schema.sql`:

| Table | Purpose |
|-------|---------|
| `github_profiles` | Primary store — full profile + computed insights |
| `analysis_logs` | Audit trail — every request logged with source & latency |

Key design decisions:
- `ON DUPLICATE KEY UPDATE` enables atomic upsert on re-analysis
- `analyzed_at` column drives the 24-hour cache freshness check
- JSON columns store `language_breakdown` and `top_repositories`
- Indexes on `analyzed_at`, `followers`, and `public_repos` for fast queries

---

## Error Handling

| Scenario | HTTP Status | Response |
|----------|------------|---------|
| Invalid username format | 400 | `{ "success": false, "message": "Invalid GitHub username format." }` |
| GitHub user not found | 404 | `{ "success": false, "message": "GitHub user '...' was not found." }` |
| GitHub rate limit hit | 429 | `{ "success": false, "message": "...", "retry_after": "..." }` |
| Profile not in DB | 404 | `{ "success": false, "message": "No analysis found for '...'." }` |
| Internal server error | 500 | `{ "success": false, "message": "An internal server error occurred." }` |

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | HTTP server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `NODE_ENV` | No | `development` | Environment mode |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin |
| `DB_HOST` | Yes | `localhost` | MySQL host |
| `DB_PORT` | No | `3306` | MySQL port |
| `DB_USER` | Yes | `root` | MySQL username |
| `DB_PASSWORD` | Yes | — | MySQL password |
| `DB_NAME` | Yes | `github_analyzer` | MySQL database name |
| `DB_POOL_LIMIT` | No | `10` | Max pool connections |
| `GITHUB_TOKEN` | No | — | GitHub Personal Access Token |

---

## License

ISC
