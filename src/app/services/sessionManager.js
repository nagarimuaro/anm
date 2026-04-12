/**
 * Session Manager — 6-Phase Conversation State
 * Mengelola lifecycle satu interaksi user dari GREETING sampai DONE
 * Sesuai redesain.md Bagian 5
 */
const { v4: uuidv4 } = require('uuid');
const { dbRun, dbGet } = require('../../infrastructure/database/db');
const { SLOT_DEFINITIONS, INTENT_TO_SURAT } = require('../../modules/voice/slotDefinitions');
require('dotenv').config();

const NAGARI_ID = process.env.NAGARI_ID || 'default-nagari';
const MAX_SLOT_RETRY = 3;
const MAX_CONFIRMATION_RETRY = 3;
const SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 menit

/**
 * Buat session state baru
 */
function createSession() {
  return {
    session_id: uuidv4(),
    started_at: new Date().toISOString(),
    nagari_id: NAGARI_ID,

    // State mesin
    phase: 'GREETING',   // GREETING | INTENT | SLOT_FILLING | CONFIRMATION | EXECUTING | DONE
    system_state: 'STANDBY', // STANDBY | LISTENING | BUFFERING | TRANSCRIBING | PROCESSING

    // Data intent
    intent: null,
    jenis_surat: null,

    // Slot data
    slots: {},
    slotDefs: [],
    current_slot: null,

    // Tracking
    retry_count: 0,
    confirmation_retry: 0,

    // Conversation history (untuk context Phi-3)
    conversation: [],

    // Hasil akhir
    result: null,
  };
}

// Session aktif di memori
let activeSession = null;
let sessionTimer = null;

/**
 * Mulai session baru
 */
async function startSession() {
  // Jika ada session aktif, abandon dulu
  if (activeSession) {
    await abandonSession();
  }

  activeSession = createSession();

  // Start session timeout
  _resetSessionTimeout();

  // Log ke database
  try {
    await dbRun(
      `INSERT INTO sessions (id, nagari_id, started_at, phase, status) VALUES (?, ?, ?, ?, ?)`,
      [activeSession.session_id, activeSession.nagari_id, activeSession.started_at, 'GREETING', 'active']
    );
  } catch (err) {
    console.error('Session DB log error:', err.message);
  }

  console.log(`📋 Session started: ${activeSession.session_id}`);
  return activeSession;
}

/**
 * Get session aktif
 */
function getSession() {
  return activeSession;
}

/**
 * Update phase
 */
function setPhase(phase) {
  if (!activeSession) return;
  activeSession.phase = phase;
  _resetSessionTimeout();
  _updateSessionDB();
  console.log(`📋 Session phase → ${phase}`);
}

/**
 * Set intent dan inisialisasi slots
 */
function setIntent(intent) {
  if (!activeSession) return;

  activeSession.intent = intent;
  const jenisSurat = INTENT_TO_SURAT[intent];

  if (jenisSurat && SLOT_DEFINITIONS[jenisSurat]) {
    activeSession.jenis_surat = jenisSurat;
    activeSession.slotDefs = SLOT_DEFINITIONS[jenisSurat].slots;

    // Inisialisasi semua slot ke null
    activeSession.slots = {};
    activeSession.slotDefs.forEach(def => {
      activeSession.slots[def.key] = null;
    });

    // Set slot pertama yang perlu diisi
    _setNextSlot();
  }

  _updateSessionDB();
}

/**
 * Isi slot dengan nilai
 * @returns {{ success: boolean, allFilled: boolean, nextSlot: object|null }}
 */
function fillSlot(key, value) {
  if (!activeSession) return { success: false };

  activeSession.slots[key] = value;
  activeSession.retry_count = 0;

  // Cek apakah semua required slot terisi
  const allFilled = _areAllRequiredSlotsFilled();

  if (allFilled) {
    activeSession.current_slot = null;
    return { success: true, allFilled: true, nextSlot: null };
  }

  // Set slot berikutnya
  const nextSlot = _setNextSlot();
  return { success: true, allFilled: false, nextSlot };
}

/**
 * Increment retry count untuk slot saat ini
 * @returns {{ shouldSuggestKeyboard: boolean }}
 */
function incrementRetry() {
  if (!activeSession) return { shouldSuggestKeyboard: false };

  activeSession.retry_count++;
  return {
    shouldSuggestKeyboard: activeSession.retry_count >= MAX_SLOT_RETRY,
    retryCount: activeSession.retry_count,
  };
}

/**
 * Increment confirmation retry
 * @returns {{ maxReached: boolean }}
 */
function incrementConfirmationRetry() {
  if (!activeSession) return { maxReached: true };

  activeSession.confirmation_retry++;
  return {
    maxReached: activeSession.confirmation_retry >= MAX_CONFIRMATION_RETRY,
    retryCount: activeSession.confirmation_retry,
  };
}

/**
 * Add to conversation history
 */
function addConversation(role, content) {
  if (!activeSession) return;
  activeSession.conversation.push({ role, content });

  // Limit conversation history (keep last 20 messages untuk memory Phi-3)
  if (activeSession.conversation.length > 20) {
    activeSession.conversation = activeSession.conversation.slice(-20);
  }
}

/**
 * Set result dan tandai sebagai selesai
 */
async function completeSession(result) {
  if (!activeSession) return;

  activeSession.result = result;
  activeSession.phase = 'DONE';

  // Update DB
  try {
    await dbRun(
      `UPDATE sessions SET phase = ?, result_json = ?, status = 'completed', ended_at = datetime('now')
       WHERE id = ?`,
      ['DONE', JSON.stringify(result), activeSession.session_id]
    );
  } catch (err) {
    console.error('Session complete DB error:', err.message);
  }

  _clearSessionTimeout();
  console.log(`✅ Session completed: ${activeSession.session_id}`);

  const completedSession = { ...activeSession };
  activeSession = null;
  return completedSession;
}

/**
 * Abandon session (timeout atau user pergi)
 */
async function abandonSession() {
  if (!activeSession) return;

  try {
    await dbRun(
      `UPDATE sessions SET status = 'abandoned', ended_at = datetime('now') WHERE id = ?`,
      [activeSession.session_id]
    );
  } catch (err) {
    console.error('Session abandon DB error:', err.message);
  }

  _clearSessionTimeout();
  console.log(`⏹️ Session abandoned: ${activeSession.session_id}`);
  activeSession = null;
}

/**
 * Get filled slots as readable object
 */
function getFilledSlots() {
  if (!activeSession) return {};

  const filled = {};
  Object.entries(activeSession.slots).forEach(([key, value]) => {
    if (value !== null) {
      const def = activeSession.slotDefs.find(d => d.key === key);
      filled[def ? def.label : key] = value;
    }
  });
  return filled;
}

/**
 * Get current slot definition
 */
function getCurrentSlotDef() {
  if (!activeSession || !activeSession.current_slot) return null;
  return activeSession.slotDefs.find(d => d.key === activeSession.current_slot);
}

/**
 * Get jenis surat label
 */
function getSuratLabel() {
  if (!activeSession || !activeSession.jenis_surat) return '';
  return SLOT_DEFINITIONS[activeSession.jenis_surat]?.label || '';
}

// --- Internal helpers ---

function _setNextSlot() {
  if (!activeSession) return null;

  const nextDef = activeSession.slotDefs.find(
    def => def.required && activeSession.slots[def.key] === null
  );

  if (nextDef) {
    activeSession.current_slot = nextDef.key;
    activeSession.retry_count = 0;
    return nextDef;
  }

  // Cek optional slots juga
  const optionalNext = activeSession.slotDefs.find(
    def => !def.required && activeSession.slots[def.key] === null
  );

  if (optionalNext) {
    activeSession.current_slot = optionalNext.key;
    return optionalNext;
  }

  activeSession.current_slot = null;
  return null;
}

function _areAllRequiredSlotsFilled() {
  if (!activeSession) return false;
  return activeSession.slotDefs
    .filter(def => def.required)
    .every(def => activeSession.slots[def.key] !== null);
}

async function _updateSessionDB() {
  if (!activeSession) return;
  try {
    await dbRun(
      `UPDATE sessions SET phase = ?, intent = ?, jenis_surat = ?, slots_json = ? WHERE id = ?`,
      [activeSession.phase, activeSession.intent, activeSession.jenis_surat, JSON.stringify(activeSession.slots), activeSession.session_id]
    );
  } catch (err) {
    // Non-critical, just log
    console.error('Session DB update error:', err.message);
  }
}

function _resetSessionTimeout() {
  _clearSessionTimeout();
  sessionTimer = setTimeout(async () => {
    console.log('⏰ Session timeout (10 min) — abandoning');
    await abandonSession();
  }, SESSION_TIMEOUT_MS);
}

function _clearSessionTimeout() {
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
}

module.exports = {
  startSession,
  getSession,
  setPhase,
  setIntent,
  fillSlot,
  incrementRetry,
  incrementConfirmationRetry,
  addConversation,
  completeSession,
  abandonSession,
  getFilledSlots,
  getCurrentSlotDef,
  getSuratLabel,
};
