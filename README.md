# 🚀 GitHub Profile Analyzer API

A robust, enterprise-grade RESTful API built with **Node.js, Express, and MySQL (Aiven Cloud)** that fetches public GitHub profile data, computes deep analytical development metrics, and implements an optimized database-level caching mechanism.

---

## 🌟 Extra Features Added (Beyond Core Requirements)

While fulfilling all base requirements, this project integrates several production-ready engineering practices:
* **24-Hour Smart Performance Cache:** Prevents burning through GitHub API rate limits. If a profile was analyzed within the last 24 hours, the API streams the data instantly from the cloud database instead of hitting GitHub, dropping response times from **~1700ms to <15ms**.
* **Automated Schema Migration Engine:** The application automatically verifies, creates, and boots up your required MySQL tables on startup, removing the need to manually run external `.sql` scripts on the database engine.
* **Comprehensive Audit Logs & Latency Tracking:** Every single request—whether it's an API hit or a cache hit—is stamped with network latency metrics (`response_ms`) and written to a dedicated `analysis_logs` table for telemetry.
* **Advanced Analytics Engine:** Automatically calculates custom metrics including **Engagement Scores** ((Stars + Forks) / Public Repos), **Productivity Indices** (Public Repos / Account Age), and dynamic native MySQL JSON arrays for **Language Breakdowns** and **Top Repositories**.

---

## 🛠️ System Architecture & Tech Stack

* **Backend Runtime:** Node.js (v18+) & Express
* **Database Infrastructure:** Cloud MySQL 8.0 Managed Instance via **Aiven**
* **HTTP Client:** Axios (Configured with automated up-to-5-page public repository pagination processing loops)
* **Security Context Layer:** Helmet.js (HTTP header protection) & Cross-Origin Resource Sharing (CORS)

---

## 📋 API Endpoints Specification

### 1. Ingest & Analyze Profile
* **Route:** `POST /api/analyze/:username`
* **Description:** Fetches raw data from GitHub, runs analytics calculations, upserts rows to MySQL, and logs audit metrics.
* **Example:** `POST http://localhost:3000/api/analyze/Mohammed-Kamran-Ahmed`

### 2. Get All Stored Profiles
* **Route:** `GET /api/profiles`
* **Optional Query Params:** `?page=1&limit=20&search=Kamran`
* **Description:** Returns a light, paginated, and searchable collection array of all analyzed users.

### 3. Get Single Profile Deep Details
* **Route:** `GET /api/profiles/:username`
* **Description:** Extracts deep analytics structures (JSON breakdown maps) alongside a historical 10-row request audit trail.

### 4. Global Analytics Dashboard Statistics
* **Route:** `GET /api/stats`
* **Description:** Aggregates system-wide data metrics (e.g., total platform repos, cache hit ratios, and the most common language across the platform).

### 5. Delete Profile Snapshot
* **Route:** `DELETE /api/profiles/:username`
* **Description:** Permanently purges a user's tracking snapshot from the profile registry and cleanly wipes their analysis log history.

---

## 🚀 Local Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone <https://github.com/Mohammed-Kamran-Ahmed/educase-india>
   cd educase-project
