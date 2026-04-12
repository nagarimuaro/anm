/**
 * Slot Filling Engine — Loop Pengumpulan Data
 * Orkestrasi tanya-jawab per slot menggunakan Phi-3
 * Sesuai redesain.md Bagian 3.2
 */
const ollamaService = require('../../infrastructure/llm/ollamaService');
const ttsService = require('../../infrastructure/tts/ttsService');
const sessionManager = require('../../app/services/sessionManager');
const { validateSlotValue } = require('./slotDefinitions');

class SlotFillingEngine {
  /**
   * Proses jawaban user untuk slot yang sedang aktif
   * @param {string} userAnswer - Jawaban user (dari STT atau keyboard)
   * @returns {Object} - { action, responseText, audioPath, slotKey, slotValue, allFilled, ... }
   */
  async processSlotAnswer(userAnswer) {
    const session = sessionManager.getSession();
    if (!session || session.phase !== 'SLOT_FILLING') {
      return { action: 'ERROR', responseText: 'Sesi tidak aktif.' };
    }

    const currentSlotDef = sessionManager.getCurrentSlotDef();
    if (!currentSlotDef) {
      return { action: 'ALL_FILLED', responseText: 'Semua data sudah terisi.' };
    }

    // Tambah ke history conversation
    sessionManager.addConversation('user', userAnswer);

    // Extract nilai dari jawaban user menggunakan Phi-3
    let extractedValue = userAnswer;
    if (currentSlotDef.type !== 'numeric_16') {
      // Untuk teks, gunakan Phi-3 untuk extract nilai yang relevan
      const extracted = await ollamaService.extractSlotValue(
        userAnswer,
        currentSlotDef.label,
        currentSlotDef.type
      );
      if (extracted) extractedValue = extracted;
    } else {
      // Untuk NIK, langsung extract angka
      extractedValue = userAnswer.replace(/\D/g, '');
    }

    // Validasi
    const validation = validateSlotValue(extractedValue, currentSlotDef.type);

    if (!validation.valid) {
      // Retry
      const retry = sessionManager.incrementRetry();

      if (retry.shouldSuggestKeyboard) {
        const responseText = `Maaf, saya kesulitan menangkap ${currentSlotDef.label} bapak/ibu. Silakan gunakan keyboard di layar untuk memasukkannya.`;
        const audioPath = await ttsService.generateAudio(responseText);
        sessionManager.addConversation('assistant', responseText);

        return {
          action: 'SUGGEST_KEYBOARD',
          responseText,
          audioPath,
          slotKey: currentSlotDef.key,
          slotLabel: currentSlotDef.label,
          slotType: currentSlotDef.type,
          retryCount: retry.retryCount,
        };
      }

      // Minta ulang
      const responseText = `${validation.reason}. Boleh diulangi ${currentSlotDef.label}-nya?`;
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      return {
        action: 'RETRY_SLOT',
        responseText,
        audioPath,
        slotKey: currentSlotDef.key,
        retryCount: retry.retryCount,
      };
    }

    // Slot valid — isi dan lanjut
    const fillResult = sessionManager.fillSlot(currentSlotDef.key, validation.cleanValue);

    if (fillResult.allFilled) {
      // Semua slot terisi → lanjut ke konfirmasi
      return await this._generateConfirmation();
    }

    // Masih ada slot → generate pertanyaan berikutnya
    return await this.askNextSlot();
  }

  /**
   * Generate pertanyaan untuk slot berikutnya
   * Menggunakan template langsung untuk kecepatan, bukan LLM
   */
  async askNextSlot() {
    const session = sessionManager.getSession();
    const currentSlotDef = sessionManager.getCurrentSlotDef();

    if (!currentSlotDef) {
      return await this._generateConfirmation();
    }

    // Jika slot butuh keyboard (NIK), minta keyboard langsung
    if (currentSlotDef.inputMethod === 'keyboard') {
      const responseText = `Silakan masukkan ${currentSlotDef.label} bapak/ibu di layar.`;
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      return {
        action: 'REQUEST_KEYBOARD',
        responseText,
        audioPath,
        slotKey: currentSlotDef.key,
        slotLabel: currentSlotDef.label,
        slotType: currentSlotDef.type,
      };
    }

    // Gunakan template pertanyaan langsung (lebih cepat dari LLM)
    const question = this._getSlotQuestion(currentSlotDef.label);
    const audioPath = await ttsService.generateAudio(question);
    sessionManager.addConversation('assistant', question);

    return {
      action: 'ASK_SLOT',
      responseText: question,
      audioPath,
      slotKey: currentSlotDef.key,
      slotLabel: currentSlotDef.label,
    };
  }

  /**
   * Template pertanyaan slot — tanpa LLM, cepat dan konsisten
   */
  _getSlotQuestion(slotLabel) {
    const templates = {
      'nama usaha': 'Bapak/Ibu, apa nama usaha yang akan dicantumkan di surat?',
      'alamat usaha': 'Dimana alamat usaha bapak/ibu?',
      'tujuan surat': 'Untuk keperluan apa surat ini dibuat?',
      'tujuan': 'Untuk keperluan apa surat ini dibuat?',
      'keperluan': 'Untuk keperluan apa surat ini dibuat?',
    };
    return templates[slotLabel] || `Bapak/Ibu, silakan sebutkan ${slotLabel}.`;
  }

  /**
   * Proses konfirmasi dari user (YA/TIDAK)
   * Menggunakan keyword matching — BUKAN LLM (lebih cepat dan reliable)
   */
  async processConfirmation(userResponse) {
    sessionManager.addConversation('user', userResponse);

    const lower = userResponse.toLowerCase().trim();

    // Hardcoded keyword matching — jauh lebih reliable dari LLM untuk yes/no
    const yesWords = ['ya', 'iya', 'yaa', 'iyaa', 'yes', 'benar', 'betul', 'ok', 'oke', 'setuju', 'sudah', 'bener', 'yup', 'yep', 'sip'];
    const noWords = ['tidak', 'bukan', 'no', 'salah', 'belum', 'ngak', 'nggak', 'gak', 'enggak', 'jangan', 'koreksi', 'ubah', 'ganti', 'ulangi'];

    const isYes = yesWords.some(w => lower.includes(w));
    const isNo = noWords.some(w => lower.includes(w));

    if (isYes && !isNo) {
      console.log(`✅ Confirmation: YES (matched from "${userResponse}")`);
      return { action: 'CONFIRMED', responseText: 'Baik, data sedang diproses.' };
    }

    if (isNo) {
      console.log(`❌ Confirmation: NO (matched from "${userResponse}")`);
      const responseText = 'Baik, mari kita ulangi. Saya akan tanyakan lagi dari awal.';
      const audioPath = await ttsService.generateAudio(responseText);
      sessionManager.addConversation('assistant', responseText);

      // Reset slots
      const session = sessionManager.getSession();
      session.slotDefs.forEach(def => {
        session.slots[def.key] = null;
      });
      session.current_slot = session.slotDefs[0]?.key;
      session.retry_count = 0;
      sessionManager.setPhase('SLOT_FILLING');

      return {
        action: 'RESTART_SLOTS',
        responseText,
        audioPath,
      };
    }

    // Tidak jelas — tanya ulang
    console.log(`❓ Confirmation: UNCLEAR ("${userResponse}")`);
    const retry = sessionManager.incrementConfirmationRetry();

    if (retry.maxReached) {
      const responseText = 'Maaf saya tidak mengerti. Saya akan proses data yang ada.';
      const audioPath = await ttsService.generateAudio(responseText);
      return { action: 'CONFIRMED', responseText, audioPath };
    }

    const responseText = 'Maaf, apakah data sudah benar? Jawab ya atau tidak.';
    const audioPath = await ttsService.generateAudio(responseText);
    sessionManager.addConversation('assistant', responseText);

    return {
      action: 'RETRY_CONFIRMATION',
      responseText,
      audioPath,
      retryCount: retry.retryCount,
    };
  }

  /**
   * Generate rangkuman konfirmasi — menggunakan template langsung (tanpa LLM)
   */
  async _generateConfirmation() {
    const session = sessionManager.getSession();
    const filledSlots = sessionManager.getFilledSlots();
    const suratLabel = sessionManager.getSuratLabel();

    sessionManager.setPhase('CONFIRMATION');

    // Build summary dari template — jauh lebih cepat dari LLM
    let summary = `Berikut data untuk ${suratLabel}: `;
    const parts = Object.entries(filledSlots).map(([label, value]) => `${label}: ${value}`);
    summary += parts.join(', ') + '. Apakah data sudah benar?';

    const audioPath = await ttsService.generateAudio(summary);
    sessionManager.addConversation('assistant', summary);

    return {
      action: 'CONFIRM_DATA',
      responseText: summary,
      audioPath,
      data: session.slots,
    };
  }
}

module.exports = new SlotFillingEngine();
