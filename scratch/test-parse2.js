const fs = require('fs');

const raw1 = "INTENT: BUAT_SURAT_USAHA\nDATA_NIK:\nDATA_LAIN:";
const raw2 = "**INTENT:** BUAT_SURAT_USAHA";
const raw3 = "INTENT: BUAT_SURAT_USAHA";

function _parseIntentResponse(raw) {
    const cleanRaw = raw.replace(/[`*"'{}]/g, '');
    const intent = cleanRaw.match(/INTENT\s*:\s*(\S+)/i)?.[1] ?? 'TIDAK_DIKENAL';
    return intent.replace(/[^A-Z_]/gi, '').toUpperCase();
}

console.log('raw1:', _parseIntentResponse(raw1));
console.log('raw2:', _parseIntentResponse(raw2));
console.log('raw3:', _parseIntentResponse(raw3));
