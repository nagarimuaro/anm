/**
 * Slot Definitions — Konfigurasi slot per jenis surat
 * Sesuai redesain.md Bagian 3.1
 */

const SLOT_DEFINITIONS = {
  keterangan_usaha: {
    label: 'Surat Keterangan Usaha',
    slots: [
      { key: 'nik',           label: 'NIK',           type: 'numeric_16', required: true,  inputMethod: 'keyboard' },
      { key: 'nama_usaha',    label: 'nama usaha',    type: 'text',       required: true,  inputMethod: 'voice' },
      { key: 'alamat_usaha',  label: 'alamat usaha',  type: 'text',       required: true,  inputMethod: 'voice' },
      { key: 'tujuan',        label: 'tujuan surat',  type: 'text',       required: false, inputMethod: 'voice' },
    ],
  },

  domisili: {
    label: 'Surat Domisili',
    slots: [
      { key: 'nik',     label: 'NIK',          type: 'numeric_16', required: true,  inputMethod: 'keyboard' },
      { key: 'tujuan',  label: 'tujuan surat', type: 'text',       required: true,  inputMethod: 'voice' },
    ],
  },

  tidak_mampu: {
    label: 'Surat Tidak Mampu',
    slots: [
      { key: 'nik',        label: 'NIK',        type: 'numeric_16', required: true,  inputMethod: 'keyboard' },
      { key: 'keperluan',  label: 'keperluan',  type: 'text',       required: true,  inputMethod: 'voice' },
    ],
  },
};

/**
 * Mapping intent → jenis surat
 */
const INTENT_TO_SURAT = {
  'BUAT_SURAT_USAHA':       'keterangan_usaha',
  'BUAT_SURAT_DOMISILI':    'domisili',
  'BUAT_SURAT_TIDAK_MAMPU': 'tidak_mampu',
};

/**
 * Validasi nilai slot berdasarkan tipe
 */
function validateSlotValue(value, type) {
  if (!value || value.trim().length === 0) return { valid: false, reason: 'Nilai kosong' };

  switch (type) {
    case 'numeric_16':
      const digits = value.replace(/\D/g, '');
      if (digits.length !== 16) {
        return { valid: false, reason: 'NIK harus 16 digit' };
      }
      return { valid: true, cleanValue: digits };

    case 'text':
      if (value.trim().length < 2) {
        return { valid: false, reason: 'Jawaban terlalu pendek' };
      }
      return { valid: true, cleanValue: value.trim() };

    default:
      return { valid: true, cleanValue: value.trim() };
  }
}

module.exports = {
  SLOT_DEFINITIONS,
  INTENT_TO_SURAT,
  validateSlotValue,
};
