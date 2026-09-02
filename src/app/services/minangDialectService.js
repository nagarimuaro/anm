/**
 * Minang Dialect Service
 * Memanfaatkan korpus leksikon minangNLP untuk menerjemahkan / menormalisasi kata Minang ke Indonesia.
 */
const fs = require('fs');
const path = require('path');

const DICTIONARY_PATH = path.join(__dirname, '../data/minang_dictionary.json');

class MinangDialectService {
  constructor() {
    this.data = null;
    this.words = {};
    this.categories = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(DICTIONARY_PATH)) {
        const raw = fs.readFileSync(DICTIONARY_PATH, 'utf-8');
        this.data = JSON.parse(raw);
        this.words = this.data.words || {};
        this.categories = this.data.categories || {};
      }
    } catch (err) {
      console.warn('Gagal memuat minang_dictionary.json:', err.message);
    }
  }

  /**
   * Terjemahkan satu kata Minang ke padanan Bahasa Indonesia
   */
  translateWord(word) {
    if (!word) return word;
    const clean = String(word).trim().toLowerCase();
    return this.words[clean] || word;
  }

  /**
   * Normalisasi kalimat Minang ke kalimat Bahasa Indonesia
   */
  normalizeText(sentence) {
    if (!sentence) return sentence;
    const tokens = String(sentence).trim().split(/\s+/);
    const translated = tokens.map(token => {
      // Hilangkan tanda baca untuk lookup
      const clean = token.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const match = this.words[clean];
      if (match) {
        return match;
      }
      return token;
    });
    return translated.join(' ');
  }

  /**
   * Ambil kategori leksikon (misal: numbers, kiosk_intents, pronouns)
   */
  getCategory(categoryName) {
    return this.categories[categoryName] || null;
  }

  /**
   * Ambil seluruh data kamus
   */
  getAll() {
    return this.data;
  }
}

module.exports = new MinangDialectService();
