/**
 * Voice Repository — CRUD untuk voice_cache dan sessions
 */
const { dbGet, dbRun, dbAll } = require('../../infrastructure/database/db');

// --- Voice Cache ---

async function getCachedAudio(hash) {
  const row = await dbGet('SELECT * FROM voice_cache WHERE question_hash = ?', [hash]);
  if (row) {
    // Update last_used_at
    await dbRun('UPDATE voice_cache SET last_used_at = datetime("now") WHERE id = ?', [row.id]);
  }
  return row;
}

async function saveCachedAudio(hash, audioPath) {
  return await dbRun(
    'INSERT OR REPLACE INTO voice_cache (question_hash, audio_path, created_at, last_used_at) VALUES (?, ?, datetime("now"), datetime("now"))',
    [hash, audioPath]
  );
}

// --- Sessions ---

async function getActiveSession() {
  return await dbGet('SELECT * FROM sessions WHERE status = "active" ORDER BY started_at DESC LIMIT 1');
}

async function getSessionById(id) {
  return await dbGet('SELECT * FROM sessions WHERE id = ?', [id]);
}

async function getRecentSessions(limit = 10) {
  return await dbAll('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?', [limit]);
}

module.exports = {
  getCachedAudio,
  saveCachedAudio,
  getActiveSession,
  getSessionById,
  getRecentSessions,
};
