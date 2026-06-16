'use strict';

const axios    = require('axios');
const { pool } = require('../config/db');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_PAGES    = 5;
const DEV          = process.env.NODE_ENV === 'development';

// ── GitHub Axios client ───────────────────────────────────────
const gh = axios.create({
  baseURL: 'https://api.github.com',
  timeout: 15_000,
  headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
  },
});

// ── Helpers ───────────────────────────────────────────────────
async function fetchRepos(login) {
  const repos = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await gh.get(`/users/${login}/repos`, {
      params: { per_page: 100, page, sort: 'updated', type: 'owner' },
    });
    if (!data.length) break;
    repos.push(...data);
    if (data.length < 100) break;
  }
  return repos;
}

function topLanguage(repos) {
  const tally = repos.reduce((acc, r) => {
    if (r.language) acc[r.language] = (acc[r.language] || 0) + 1;
    return acc;
  }, {});
  const sorted = Object.entries(tally).sort(([, a], [, b]) => b - a);
  return { top: sorted[0]?.[0] ?? null, breakdown: Object.fromEntries(sorted) };
}

function engagementScore(stars, forks, repos) {
  return repos ? parseFloat(((stars + forks) / repos).toFixed(4)) : 0;
}

function productivityIndex(repos, createdAt) {
  const years = Math.max((Date.now() - new Date(createdAt)) / (365.25 * 864e5), 1);
  return parseFloat((repos / years).toFixed(4));
}

function aggregateRepos(repos) {
  const stats = repos.reduce(
    (acc, r) => {
      acc.stars  += r.stargazers_count  || 0;
      acc.forks  += r.forks_count       || 0;
      acc.watch  += r.watchers_count    || 0;
      acc.issues += r.open_issues_count || 0;
      return acc;
    },
    { stars: 0, forks: 0, watch: 0, issues: 0 }
  );
  const top5 = [...repos]
    .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
    .slice(0, 5)
    .map(r => ({
      name: r.name, description: r.description || null, url: r.html_url,
      language: r.language || null, stars: r.stargazers_count || 0,
      forks: r.forks_count || 0, open_issues: r.open_issues_count || 0,
      created_at: r.created_at, updated_at: r.updated_at,
    }));
  return { ...stats, top5 };
}

function parseJSON(profile) {
  if (typeof profile.language_breakdown === 'string')
    profile.language_breakdown = JSON.parse(profile.language_breakdown);
  if (typeof profile.top_repositories === 'string')
    profile.top_repositories = JSON.parse(profile.top_repositories);
  return profile;
}

async function auditLog(username, source, status, ms = null, err = null) {
  try {
    await pool.execute(
      'INSERT INTO analysis_logs (username, source, http_status, response_ms, error_message) VALUES (?,?,?,?,?)',
      [username, source, status, ms, err]
    );
  } catch (e) { console.error('[audit]', e.message); }
}

function errRes(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

// ── Controllers ───────────────────────────────────────────────

async function analyzeProfile(req, res) {
  const { username } = req.params;
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username))
    return errRes(res, 400, 'Invalid GitHub username format.');

  const t0 = Date.now();

  try {
    // Cache check ── SWAPPED TO .query TO SAFELY EXTRACT BINARY JSON LAYERS WITHOUT DRIVER BREAKAGE
    const [rows] = await pool.query(
      'SELECT * FROM github_profiles WHERE username = ? LIMIT 1',
      [username.toLowerCase()]
    );
    if (rows.length && Date.now() - new Date(rows[0].analyzed_at) < CACHE_TTL_MS) {
      await auditLog(username, 'cache', 200, Date.now() - t0);
      return res.json({ success: true, source: 'cache', cached_at: rows[0].analyzed_at, data: parseJSON(rows[0]) });
    }

    // Fetch GitHub user
    let user;
    try {
      ({ data: user } = await gh.get(`/users/${username}`));
    } catch (err) {
      if (err.response?.status === 404) {
        await auditLog(username, 'github_api', 404, Date.now() - t0, 'not found');
        return errRes(res, 404, `GitHub user '${username}' not found.`);
      }
      if (err.response?.status === 403) {
        await auditLog(username, 'github_api', 403, Date.now() - t0, 'rate limited');
        const reset = err.response.headers['x-ratelimit-reset'];
        return errRes(res, 429, 'GitHub API rate limit exceeded.', {
          retry_after: reset ? new Date(reset * 1000).toISOString() : null,
        });
      }
      throw err;
    }

    // Fetch repos & compute analytics
    const repos                                = await fetchRepos(user.login);
    const { stars, forks, watch, issues, top5 } = aggregateRepos(repos);
    const { top, breakdown }                   = topLanguage(repos);
    const engagement                           = engagementScore(stars, forks, user.public_repos);
    const productivity                         = productivityIndex(user.public_repos, user.created_at);

    // Upsert ── Keep as .execute since writing stringified JSON blobs works perfectly as primitives
    await pool.execute(`
      INSERT INTO github_profiles
        (username,github_id,full_name,avatar_url,bio,location,company,blog,email,twitter_username,
         public_repos,public_gists,followers,following,total_stars,total_forks,total_watchers,
         total_open_issues,top_language,engagement_score,productivity_index,
         language_breakdown,top_repositories,github_created_at,github_updated_at,analyzed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
        github_id=VALUES(github_id),full_name=VALUES(full_name),avatar_url=VALUES(avatar_url),
        bio=VALUES(bio),location=VALUES(location),company=VALUES(company),blog=VALUES(blog),
        email=VALUES(email),twitter_username=VALUES(twitter_username),
        public_repos=VALUES(public_repos),public_gists=VALUES(public_gists),
        followers=VALUES(followers),following=VALUES(following),
        total_stars=VALUES(total_stars),total_forks=VALUES(total_forks),
        total_watchers=VALUES(total_watchers),total_open_issues=VALUES(total_open_issues),
        top_language=VALUES(top_language),engagement_score=VALUES(engagement_score),
        productivity_index=VALUES(productivity_index),language_breakdown=VALUES(language_breakdown),
        top_repositories=VALUES(top_repositories),github_created_at=VALUES(github_created_at),
        github_updated_at=VALUES(github_updated_at),analyzed_at=CURRENT_TIMESTAMP
    `, [
      user.login.toLowerCase(), user.id, user.name||null, user.avatar_url||null,
      user.bio||null, user.location||null, user.company||null, user.blog||null,
      user.email||null, user.twitter_username||null,
      user.public_repos||0, user.public_gists||0, user.followers||0, user.following||0,
      stars, forks, watch, issues, top, engagement, productivity,
      JSON.stringify(breakdown), JSON.stringify(top5),
      new Date(user.created_at), new Date(user.updated_at),
    ]);

    const ms = Date.now() - t0;
    await auditLog(username, 'github_api', 200, ms);

    return res.json({
      success: true, source: 'github_api', response_ms: ms,
      data: {
        username: user.login, github_id: user.id, full_name: user.name||null,
        avatar_url: user.avatar_url, bio: user.bio||null, location: user.location||null,
        company: user.company||null, blog: user.blog||null, email: user.email||null,
        twitter_username: user.twitter_username||null, github_profile_url: user.html_url,
        public_repos: user.public_repos, public_gists: user.public_gists,
        followers: user.followers, following: user.following,
        total_stars: stars, total_forks: forks, total_watchers: watch, total_open_issues: issues,
        analytics: { top_language: top, engagement_score: engagement, productivity_index: productivity, language_breakdown: breakdown, top_repositories: top5 },
        github_created_at: user.created_at, github_updated_at: user.updated_at,
        analyzed_at: new Date().toISOString(),
      },
    });

  } catch (error) {
    await auditLog(username, 'github_api', 500, Date.now() - t0, error.message);
    console.error('[analyzeProfile]', error.message);
    return errRes(res, 500, 'Internal server error.', { ...(DEV && { error: error.message }) });
  }
}

async function getAllProfiles(req, res) {
  try {
    const page   = Math.max(parseInt(req.query.page)  || 1, 1);
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const where  = search ? 'WHERE username LIKE ? OR full_name LIKE ?' : '';
    const params = search ? [search, search] : [];

    // SWAPPED TO .query FOR COMPATIBLE FIELD TYPE AGGREGATIONS OVER THE CLOUD STREAM
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM github_profiles ${where}`, params
    );
    const [profiles] = await pool.query(
      `SELECT id,username,full_name,avatar_url,location,company,public_repos,followers,following,
              total_stars,total_forks,top_language,engagement_score,productivity_index,
              github_created_at,analyzed_at
       FROM github_profiles ${where} ORDER BY analyzed_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({
      success: true,
      pagination: { page, limit, total, total_pages: Math.ceil(total / limit), has_next: page * limit < total, has_prev: page > 1 },
      count: profiles.length, data: profiles,
    });
  } catch (error) {
    console.error('[getAllProfiles]', error.message);
    return errRes(res, 500, 'Failed to retrieve profiles.', { ...(DEV && { error: error.message }) });
  }
}

async function getProfileByUsername(req, res) {
  const { username } = req.params;
  try {
    // SWAPPED TO .query TO SAFELY LET THE DRIVER INGEST THE LANGUAGE AND REPO SNAPSHOTS
    const [rows] = await pool.query(
      'SELECT * FROM github_profiles WHERE username = ? LIMIT 1',
      [username.toLowerCase()]
    );
    if (!rows.length)
      return errRes(res, 404, `No analysis found for '${username}'. Run POST /api/analyze/${username} first.`);

    const [logs] = await pool.query(
      'SELECT source,http_status,response_ms,requested_at FROM analysis_logs WHERE username=? ORDER BY requested_at DESC LIMIT 10',
      [username.toLowerCase()]
    );
    return res.json({ success: true, data: parseJSON(rows[0]), audit_trail: logs });
  } catch (error) {
    console.error('[getProfileByUsername]', error.message);
    return errRes(res, 500, 'Failed to retrieve profile.', { ...(DEV && { error: error.message }) });
  }
}

async function getAnalyticsStats(_req, res) {
  try {
    // SWAPPED TO .query TO ENSURE SYSTEM-WIDE CALCULATIONS ARE PROCESSED WITHOUT COERCION ERRORS
    const [[stats]]    = await pool.query(`
      SELECT COUNT(*) AS total_profiles, SUM(public_repos) AS total_repos,
             SUM(followers) AS total_followers, SUM(total_stars) AS total_stars,
             MAX(engagement_score) AS highest_engagement, AVG(engagement_score) AS avg_engagement,
             MAX(productivity_index) AS highest_productivity, AVG(productivity_index) AS avg_productivity,
             (SELECT top_language FROM github_profiles WHERE top_language IS NOT NULL
              GROUP BY top_language ORDER BY COUNT(*) DESC LIMIT 1) AS most_common_language,
             MIN(analyzed_at) AS earliest_analysis, MAX(analyzed_at) AS latest_analysis
      FROM github_profiles`);
    const [[logStats]] = await pool.query(`
      SELECT COUNT(*) AS total_requests, SUM(source='github_api') AS api_hits,
             SUM(source='cache') AS cache_hits, ROUND(AVG(response_ms)) AS avg_response_ms
      FROM analysis_logs`);
    return res.json({ success: true, data: { profile_stats: stats, request_stats: logStats } });
  } catch (error) {
    console.error('[getAnalyticsStats]', error.message);
    return errRes(res, 500, 'Failed to retrieve stats.', { ...(DEV && { error: error.message }) });
  }
}

async function deleteProfile(req, res) {
  const { username } = req.params;
  try {
    const [result] = await pool.execute(
      'DELETE FROM github_profiles WHERE username = ?', [username.toLowerCase()]
    );
    if (!result.affectedRows) return errRes(res, 404, `No profile found for '${username}'.`);
    await pool.execute('DELETE FROM analysis_logs WHERE username = ?', [username.toLowerCase()]);
    return res.json({ success: true, message: `Profile '${username}' deleted.` });
  } catch (error) {
    console.error('[deleteProfile]', error.message);
    return errRes(res, 500, 'Failed to delete profile.', { ...(DEV && { error: error.message }) });
  }
}

module.exports = { analyzeProfile, getAllProfiles, getProfileByUsername, getAnalyticsStats, deleteProfile };