const raw = "INTENT: BUAT_SURAT_USAHA\nDATA_NIK:\nDATA_LAIN:";

function _parseIntentResponse(raw) {
  const intent = raw.match(/INTENT:\s*(\S+)/)?.[1] ?? 'TIDAK_DIKENAL';
  const nik = raw.match(/DATA_NIK:\s*(\d{16})/)?.[1] ?? null;
  const dataLain = raw.match(/DATA_LAIN:\s*(.+)/)?.[1]?.trim() || null;

  return {
    intent: intent.replace(/[^A-Z_]/g, ''),
    nik,
    dataLain: dataLain === 'kosong' || dataLain === '' ? null : dataLain,
  };
}

console.log(_parseIntentResponse(raw));
