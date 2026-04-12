/**
 * Kiosk Controller — IPC Handler untuk operasi non-voice
 */
const kioskService = require('../services/kioskService');

function register(ipc) {
  ipc.handle('kiosk:session:start', async () => {
    return await kioskService.startSession();
  });

  ipc.handle('kiosk:session:end', async () => {
    return await kioskService.endSession();
  });

  ipc.handle('kiosk:api:getWarga', async (event, nik) => {
    return await kioskService.getWarga(nik);
  });

  ipc.handle('kiosk:api:cekBansos', async (event, nik) => {
    return await kioskService.cekBansos(nik);
  });

  ipc.handle('kiosk:api:buatSurat', async (event, data) => {
    return await kioskService.buatSurat(data);
  });
}

module.exports = { register };
