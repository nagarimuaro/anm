/**
 * Database Service — SQLite (better-sqlite3 compatible fallback to sqlite3)
 * Menyimpan session logs, voice cache, dan config kiosk
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Dalam mode production (packaged), __dirname ada di dalam app.asar (read-only).
// Gunakan app.getPath('userData') sebagai lokasi aman untuk menyimpan database.
let dbPath;
try {
  const { app } = require('electron');
  const userDataPath = app.getPath('userData');
  dbPath = process.env.DB_PATH
    ? path.resolve(userDataPath, process.env.DB_PATH)
    : path.join(userDataPath, 'data', 'anm.sqlite');
} catch (e) {
  // Fallback untuk non-Electron environment (testing, dll)
  dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.join(__dirname, '../../../data/anm.sqlite');
}

let db;

function init() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
      console.error('❌ Database connection error:', err.message);
    } else {
      console.log('✅ Connected to SQLite database at', dbPath);
      createTables();
    }
  });

  return db;
}

function createTables() {
  db.serialize(() => {
    // Tabel voice cache (dari arsitektur asli, ditambah last_used_at)
    db.run(`
      CREATE TABLE IF NOT EXISTS voice_cache (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        question_hash TEXT UNIQUE NOT NULL,
        audio_path    TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        last_used_at  TEXT
      )
    `);

    // Tabel settings - untuk config dinamis seperti logo
    db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key           TEXT PRIMARY KEY,
        value         TEXT NOT NULL
      )
    `);

    // Tabel sessions — tracking per interaksi user
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        nagari_id     TEXT NOT NULL,
        started_at    TEXT NOT NULL,
        ended_at      TEXT,
        phase         TEXT NOT NULL DEFAULT 'GREETING',
        intent        TEXT,
        jenis_surat   TEXT,
        slots_json    TEXT,
        result_json   TEXT,
        status        TEXT DEFAULT 'active'
      )
    `);

    // Indexes
    db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_cache_hash ON voice_cache(question_hash)`);

    // Cleanup: tandai session lama yang masih 'active' sebagai 'abandoned'
    db.run(`
      UPDATE sessions SET status = 'abandoned', ended_at = datetime('now')
      WHERE status = 'active'
    `);

    // Cleanup: hapus cache > 30 hari tidak terpakai
    db.run(`
      DELETE FROM voice_cache
      WHERE last_used_at IS NOT NULL AND last_used_at < datetime('now', '-30 days')
    `);

    console.log('📦 Database tables ready.');
  });
}

function getDb() {
  if (!db) return init();
  return db;
}

// --- Helper promisified wrappers ---

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  init,
  get db() { return getDb(); },
  dbGet,
  dbRun,
  dbAll,
};
