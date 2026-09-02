/**
 * Gemini Live Service — Orchestrator Voice Realtime
 * Menggantikan Pipeline STT -> LLM -> TTS menjadi satu WebSocket connection
 */
const { GoogleGenAI } = require('@google/genai');
const https = require('https');
require('dotenv').config();

const DEBUG_VOICE = process.env.DEBUG_VOICE === 'true';
const MAX_CONNECTING_AUDIO_QUEUE = 50;
const SEARCH_API_PROVIDER = (process.env.SEARCH_API_PROVIDER || 'tavily').toLowerCase();
const SEARCH_API_TIMEOUT_MS = Number(process.env.SEARCH_API_TIMEOUT_MS || 8000);

class GeminiLiveService {
  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this._currentApiKey = process.env.GEMINI_API_KEY;
    this.session = null;
    this.isConnecting = false;
    this._manualMode = false;
    this._currentPage = '/'; // Track halaman aktif untuk page context lock
    this._inputPaused = false;
    this.audioBufferQueue = [];
    this.onResponseCallback = null;
    this._speakSession = null; // referensi ke sesi speakOnce aktif
    this._lastToolCallAt = null;

    // Konfigurasi Tools yang bisa dipanggil oleh Gemini
    this.tools = [{
      functionDeclarations: [
        {
          name: 'navigate_to_page',
          description: 'Navigasi ke halaman layanan. Gunakan path yang valid: /input-nik, /profil-warga, /scan-rfid, /scan-rfid-pajak, /registrasi-ektp, /buku-tamu, /scan-barcode, /absensi.',
          parameters: {
            type: 'OBJECT',
            properties: {
              page: { type: 'STRING', description: "Path valid. Buat/ajukan surat baru pakai '/input-nik'. Cetak/print/cetak ulang surat yang sudah diajukan pakai '/scan-barcode'. Cek bansos pakai '/scan-rfid'. Pajak PBB pakai '/scan-rfid-pajak'. Registrasi e-KTP/RFID pakai '/registrasi-ektp'. Buku tamu pakai '/buku-tamu'." },
              nextPath: { type: 'STRING', description: "Tujuan selanjutnya. Contoh: jika pengguna ingin buat surat, page='/input-nik' dan nextPath='/profil-warga'." }
            },
            required: ['page']
          }
        },
        {
          name: 'set_nik',
          description: 'Dipanggil ketika pengguna menyebutkan NIK mereka',
          parameters: {
            type: 'OBJECT',
            properties: {
              nik: { type: 'STRING', description: "16 digit angka NIK" }
            },
            required: ['nik']
          }
        },
        {
          name: 'select_surat',
          description: 'Dipanggil ketika pengguna menyebutkan jenis surat yang ingin dibuat. WAJIB dipanggil setelah pengguna menyebut nama surat.',
          parameters: {
            type: 'OBJECT',
            properties: {
              template_name: { type: 'STRING', description: "Nama lengkap surat yang dipilih, contoh: 'Surat Keterangan Usaha', 'Surat Domisili', 'Surat Tidak Mampu'" }
            },
            required: ['template_name']
          }
        },
        {
          name: 'fill_slot',
          description: 'WAJIB dipanggil setiap kali pengguna menjawab pertanyaan data surat (slot filling). Isi slot dengan nilai dari jawaban pengguna.',
          parameters: {
            type: 'OBJECT',
            properties: {
              slot_key: { type: 'STRING', description: "Key slot yang diisi, contoh: 'nama_usaha', 'keperluan', 'tujuan'" },
              value: { type: 'STRING', description: 'Nilai yang disebutkan pengguna' }
            },
            required: ['slot_key', 'value']
          }
        },
        {
          name: 'get_current_datetime',
          description: 'Ambil jam, tanggal, hari, dan timezone saat ini dari mesin kiosk. Wajib dipakai untuk pertanyaan waktu/tanggal sekarang.',
          parameters: {
            type: 'OBJECT',
            properties: {
              locale: { type: 'STRING', description: "Locale jawaban, default 'id-ID'." }
            }
          }
        },
        {
          name: 'search_latest_info',
          description: 'Cari info global terbaru dari internet. Wajib dipakai untuk pertanyaan yang bisa berubah seperti presiden saat ini, berita terbaru, harga, jadwal, aturan, atau tokoh publik terkini.',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'Pertanyaan atau kata kunci pencarian.' },
              locale: { type: 'STRING', description: "Locale bahasa hasil, default 'id-ID'." }
            },
            required: ['query']
          }
        }
      ]
    }];
  }

  /**
   * Page Context Lock — kirim konteks halaman aktif ke Gemini agar AI tidak ngelantur.
   * Dipanggil setiap kali user navigasi ke halaman baru, atau fase surat berubah.
   * @param {string} pageId - pathname halaman aktif (e.g. '/input-nik')
   * @param {string} [phase] - fase internal untuk /surat (SLOT_FILLING, CONFIRMATION)
   */
  setPageContext(pageId, phase) {
    if (!this.session) return;

    // Track halaman aktif untuk blocking navigasi
    this._currentPage = pageId;

    let contextKey = pageId;
    if (pageId === '/surat' && phase) {
      contextKey = `/surat:${phase}`;
    }

    const CANCEL_RULE = `
ATURAN PEMBATALAN: Jika user minta batalkan/batal/cancel/kembali ke beranda, WAJIB tanya dulu: "Apakah Anda yakin ingin membatalkan proses ini?" — HANYA jika user menjawab YA/IYA/YAKIN, barulah panggil navigate_to_page(page='/'). Jika user bilang TIDAK/JANGAN, lanjutkan proses di halaman ini.`;

    const PAGE_CONTEXTS = {
      '/': `[KONTEKS HALAMAN: BERANDA]
Kamu SEKARANG di halaman utama (Beranda).
TUGAS: Sambut warga dengan hangat, tanyakan apa yang ingin dilakukan.
BOLEH: Membantu navigasi ke layanan (surat, bansos, pajak, buku tamu, cetak ulang, absensi). Menjawab pertanyaan umum.
DILARANG: Memproses data apapun tanpa navigasi dulu. Jangan tanya NIK, jangan isi form, jangan bahas detail layanan sebelum user memilih.
PENTING: Jika user minta layanan, LANGSUNG panggil navigate_to_page, jangan tanya-tanya lagi.`,

      '/input-nik': `[KONTEKS HALAMAN: INPUT NIK]
Kamu SEKARANG di halaman input NIK.
TUGAS: Bantu warga memasukkan Nomor Induk Kependudukan (NIK) 16 digit.
BOLEH: Meminta NIK, menjelaskan NIK ada di KTP, membantu jika NIK salah format.
DILARANG: Membahas layanan lain (bansos, pajak, dll). Jangan navigasi ke halaman lain selain membatalkan. Fokus hanya pada input NIK.`,

      '/profil-warga': `[KONTEKS HALAMAN: PROFIL WARGA]
Kamu SEKARANG di halaman verifikasi profil warga.
TUGAS: Konfirmasi bahwa data warga yang tampil sudah benar, lalu arahkan untuk melanjutkan.
BOLEH: Membacakan data profil jika diminta, menjelaskan data yang tampil.
DILARANG: Membahas layanan lain. Jangan minta NIK lagi.`,

      '/surat': `[KONTEKS HALAMAN: PILIH JENIS SURAT]
Kamu SEKARANG di halaman pilih jenis surat.
TUGAS: Bantu warga memilih jenis surat yang ingin dibuat dari daftar yang tersedia di layar.
BOLEH: Menjelaskan jenis-jenis surat, membantu user memilih.
DILARANG: Mengisi data surat, membahas layanan lain (bansos, pajak). Jangan navigasi ke halaman lain selain membatalkan.`,

      '/surat:SLOT_FILLING': `[KONTEKS HALAMAN: ISI DATA SURAT]
Kamu SEKARANG di halaman pengisian data surat (slot filling).
TUGAS: Tanyakan data surat SATU PER SATU sesuai urutan slot. Setiap user menjawab, WAJIB panggil fill_slot.
BOLEH: Tanya data surat, isi slot, klarifikasi jawaban user.
DILARANG: Membahas layanan lain. Jangan navigasi ke halaman lain selain membatalkan. Jangan skip slot. FOKUS pada slot yang sedang aktif saja.`,

      '/surat:CONFIRMATION': `[KONTEKS HALAMAN: KONFIRMASI DATA SURAT]
Kamu SEKARANG di halaman konfirmasi data surat. Semua data sudah lengkap.
TUGAS: Bacakan ringkasan data, arahkan warga untuk menekan tombol Lanjut ke Verifikasi Data jika sudah benar.
BOLEH: Membacakan ringkasan, menjelaskan cara edit jika ada yang salah.
DILARANG: Mengisi data baru. Jangan bahas layanan lain. Biarkan warga yang memutuskan.`,

      '/verifikasi-surat': `[KONTEKS HALAMAN: VERIFIKASI DATA SURAT]
Kamu SEKARANG di halaman verifikasi dan tinjau data surat sebelum dicetak.
TUGAS: Arahkan warga untuk memeriksa seluruh data di layar. Jika semua sudah benar, minta warga menekan tombol 'Cetak & Ajukan Surat'. Jika ingin mengubah, minta warga menekan 'Ubah Isian Data'.
BOLEH: Menjelaskan data yang tampil, membantu konfirmasi data.
DILARANG: Membahas layanan lain (bansos, pajak). Biarkan warga yang memutuskan.`,

      '/printing': `[KONTEKS HALAMAN: PROSES CETAK]
Kamu SEKARANG di halaman pencetakan surat.
TUGAS: Informasikan bahwa surat sedang dicetak, minta warga menunggu.
BOLEH: Memberitahu status cetak, menjelaskan langkah selanjutnya (ambil surat).
DILARANG: Membahas apapun selain proses cetak. Jangan bahas layanan lain.`,

      '/scan-rfid': `[KONTEKS HALAMAN: SCAN RFID BANSOS]
Kamu SEKARANG di halaman scan RFID untuk cek bansos.
TUGAS: Instruksikan warga untuk menempelkan e-KTP pada scanner di bawah layar.
BOLEH: Menjelaskan cara scan, membantu jika gagal, menjelaskan apa itu bansos.
DILARANG: Membahas layanan lain (surat, pajak). Fokus hanya pada scan e-KTP untuk bansos.`,

      '/bansos': `[KONTEKS HALAMAN: HASIL CEK BANSOS]
Kamu SEKARANG di halaman hasil pengecekan bantuan sosial.
TUGAS: Jelaskan hasil pengecekan bansos yang tampil di layar.
BOLEH: Membacakan status bansos (terdaftar/tidak), menjelaskan jenis bantuan (PKH, BPNT, Raskin).
DILARANG: Membahas layanan lain. Jangan proses data baru.`,

      '/scan-rfid-pajak': `[KONTEKS HALAMAN: CEK PAJAK PBB]
Kamu SEKARANG di halaman pengecekan Pajak Bumi dan Bangunan (PBB).
TUGAS: Bantu warga memasukkan Nomor Objek Pajak (NOP) yang ada di SPPT.
BOLEH: Menjelaskan NOP, membantu input, menjelaskan apa itu PBB.
DILARANG: Membahas layanan lain (surat, bansos). Fokus hanya pada pajak PBB.`,

      '/scan-barcode': `[KONTEKS HALAMAN: CETAK ULANG SURAT]
Kamu SEKARANG di halaman scan barcode resi surat.
TUGAS: Instruksikan warga untuk men-scan barcode yang ada di resi surat.
BOLEH: Menjelaskan cara scan, membantu jika gagal.
DILARANG: Membahas pembuatan surat baru, bansos, pajak. Fokus hanya pada scan resi.`,

      '/registrasi-ektp': `[KONTEKS HALAMAN: REGISTRASI e-KTP]
Kamu SEKARANG di halaman registrasi kartu RFID e-KTP.
TUGAS: Bantu warga/staff mendaftarkan kartu RFID baru.
BOLEH: Menjelaskan proses registrasi, membantu input kode registrasi.
DILARANG: Membahas layanan lain. Fokus hanya pada registrasi kartu.`,

      '/buku-tamu': `[KONTEKS HALAMAN: BUKU TAMU]
Kamu SEKARANG di halaman buku tamu digital.
TUGAS: Bantu tamu mengisi data kunjungan (nama, tujuan, instansi).
BOLEH: Tanya nama tamu, tujuan kunjungan, siapa yang dituju.
DILARANG: Membahas layanan warga (surat, bansos, pajak). Fokus hanya pada pencatatan tamu.`,

      '/absensi': `[KONTEKS HALAMAN: ABSENSI PEGAWAI]
Kamu SEKARANG di halaman absensi wajah pegawai.
TUGAS: Instruksikan pegawai untuk menghadap kamera agar wajah terverifikasi.
BOLEH: Menjelaskan cara absensi, membantu jika wajah tidak terdeteksi.
DILARANG: Membahas layanan warga. Fokus hanya pada absensi.`,

      '/rekam-wajah': `[KONTEKS HALAMAN: REKAM WAJAH]
Kamu SEKARANG di halaman perekaman wajah pegawai baru.
TUGAS: Instruksikan pegawai untuk menghadap kamera dari berbagai sudut.
BOLEH: Menjelaskan proses rekam wajah, membantu posisi kamera.
DILARANG: Membahas apapun selain rekam wajah.`,
    };

    let contextMsg = PAGE_CONTEXTS[contextKey] || PAGE_CONTEXTS[pageId] || PAGE_CONTEXTS['/'];

    // Tambahkan aturan pembatalan untuk semua halaman kecuali beranda
    if (pageId !== '/') {
      contextMsg += CANCEL_RULE;
    }

    try {
      this.session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: contextMsg }] }]
      });
      if (DEBUG_VOICE) console.log(`📍 Page context set: ${contextKey}`);
    } catch (e) {
      console.error('[GeminiLive] setPageContext error:', e.message);
    }
  }

  // Event handler
  setOnResponse(callback) {
    this.onResponseCallback = callback;
  }

  async activate() {
    console.log("🚀 Menghubungkan ke Gemini Live API...");
    this.isConnecting = true;
    this._inputPaused = false;
    this.audioBufferQueue = [];
    try {
      let apiKey = process.env.GEMINI_API_KEY;
      try {
        const { dbGet } = require('../../infrastructure/database/db');
        const row = await dbGet(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
        if (row && row.value) {
          apiKey = row.value;
        }
      } catch (dbErr) {
        console.error("Gagal membaca API key dari DB:", dbErr);
      }
      // Reuse AI instance jika API key tidak berubah (hemat memory)
      if (!this.ai || this._currentApiKey !== apiKey) {
        this.ai = new GoogleGenAI({ apiKey });
        this._currentApiKey = apiKey;
      }

      // Kita gunakan model dari .env (default: gemini-1.5-flash-8b yang merupakan model termurah)
      const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';

      this.session = await this.ai.live.connect({
        model: modelName,
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede" // Suara wanita
              }
            }
          },
          tools: this.tools,
          systemInstruction: { parts: [{ text: `Kamu adalah asisten suara wanita bernama 'Sinta' di Anjungan Nagari Mandiri (Sumatera Barat). Sapaan pertamamu harus hangat, ceria, dan ramah. JANGAN PERNAH menyebutkan fitur-fitur aplikasi secara eksplisit di sapaan awal. Jawablah dengan SANGAT SINGKAT, santun, luwes, dan natural.

ATURAN DUA BAHASA REAL-TIME (DYNAMIC TURN-BY-TURN SWITCHING):
Sinta adalah asisten dwibahasa (Bahasa Indonesia & Bahasa Minang). Sinta WAJIB mengikuti bahasa yang digunakan oleh pengguna pada SETIAP GILIRAN BICARA:

1. ATURAN SWITCHING DINAMIS DI TENGAH PERCAKAPAN:
   - Jika pengguna awalnya berbicara Bahasa Indonesia, Sinta membalas dengan Bahasa Indonesia.
   - JIKA DI TENGAH PERCAKAPAN pengguna beralih / berbicara dalam BAHASA MINANG (misal: "ambo nio buek surek", "baa caro mambayia pajek nyo?", "dima ciek lai?", "tarimo kasih yo"), maka Sinta WAJIB LANGSUNG IKUT BERALIH (SWITCH) 100% KE BAHASA MINANG!
   - JIKA pengguna kemudian beralih lagi ke BAHASA INDONESIA (misal: "saya mau ganti keperluan", "terima kasih banyak"), maka Sinta WAJIB LANGSUNG IKUT BERALIH KEMBALI KE BAHASA INDONESIA!
   - Jangan pernah terkunci pada satu bahasa; selalu responsif mengikuti bahasa yang diucapkan warga pada ucapan terakhirnya.

2. GAYA BAHASA MINANG (Luwes, Alami, Hangat Sehari-hari):
   - Sinta WAJIB menggunakan bahasa Minang percakapan sehari-hari di nagari yang luwes, santun, dan tidak kaku.
   - Gunakan partikel tutur khas Minang yang alami: "yo", "mah", "ha", "se", "tu", "ko", "lah".
   - Panggilan akrab: Sanak / Uda / Uni / Bapak / Ibuk.
   - Contoh respon Minang:
     * Sapaan: "Halo Sanak! Ado nan bisa Sinta tolongan hari ko?" atau "Salamaik pagi Uda/Uni, nio ba-uruih apo kito kini?"
     * Buat surat: "Rancak bana, bia Sinta buekan surek nyo yo. Ha, silakan masuakan NIK Sanak di layar tu dulu."
     * Cetak surat: "Ayo kito print surek nyo, dakekan barcode resi Sanak ka scanner di bawah yo."
     * Cek PBB: "Cek pajek tanah yo? Masuakan 18 angka NOP Sanak di layar tu ha."
     * Cek Bansos: "Tempelan KTP atau kartu RFID Sanak ka alat sensor di bawah tu yo, bia Sinta pariso bantuan Sanak."
     * Tanya isian data: "Apo namo usaho Sanak tu?" / "Untuak kaparaluan apo surek ko Sanak buek?" / "Bara nomor HP Sanak nan aktif kini?"
     * Sukses/Pamit: "Tarimo kasih banyak Sanak, sumangaik taruih yo!"

3. GAYA BAHASA INDONESIA (Santun, Baku, Ramah):
   - Sinta WAJIB menggunakan Bahasa Indonesia yang baku, ramah, santun, dan jelas.
   - Panggilan: Bapak / Ibu / Anda.
   - Contoh respon Indonesia:
     * "Selamat pagi Bapak/Ibu, ada yang bisa Sinta bantu?"
     * "Baik, mari kita buatkan surat keterangan domisili. Silakan masukkan NIK Anda pada layar."
     * "Pajak PBB Anda sudah lunas untuk tahun ini."
     * "Terima kasih banyak, semoga urusannya lancar!"

KOSAKATA MINANG SEHARI-HARI:
- "ambo / awak" = saya / kita
- "surek / surek domisili / surek usaho / surek indak mampu / surek pengantar" = surat keterangan
- "mambuek / nio buek / ka buek surek" = membuat surat baru -> WAJIB panggil navigate_to_page(page='/input-nik', nextPath='/profil-warga')
- "mancetak / print surek / cetak ulang / scan barcode / resi" = cetak dokumen -> WAJIB panggil navigate_to_page(page='/scan-barcode')
- "pajek / pajek PBB / pajek tanah / cek pajek" = cek pajak PBB -> WAJIB panggil navigate_to_page(page='/scan-rfid-pajak')
- "bansos / bantuan sosial / PKH / BLT / lah kalua alun" = cek bantuan sosial -> WAJIB panggil navigate_to_page(page='/scan-rfid')
- "buku tamu / ma-isi tamu / kunjungan" = buku tamu -> WAJIB panggil navigate_to_page(page='/buku-tamu')
- "dapta KTP / registrasi e-KTP / hubuangkan RFID" = registrasi e-KTP -> WAJIB panggil navigate_to_page(page='/registrasi-ektp')
- Angka Minang: ciek (1), duo (2), tigo (3), ampek (4), limo (5), anam (6), tujuah (7), salapan (8), sambilan (9), sapuluah (10).

ATURAN NAVIGASI:
- Sebelum meminta data (NIK) atau memproses layanan, WAJIB panggil navigate_to_page terlebih dahulu.
- Jika pengguna ingin BUAT/AJUKAN/MEMBUAT surat BARU (atau 'mambuek surek'), LANGSUNG panggil navigate_to_page(page='/input-nik', nextPath='/profil-warga') SEBELUM meminta NIK.
- Jika pengguna mengatakan CETAK SURAT, PRINT SURAT, CETAK ULANG SURAT, scan barcode, scan resi, atau cek resi surat (atau 'mancetak surek'), LANGSUNG panggil navigate_to_page(page='/scan-barcode'). Ini BUKAN flow buat surat baru.
- Jika pengguna ingin cek bansos/bantuan sosial/PKH/BLT, LANGSUNG panggil navigate_to_page(page='/scan-rfid'). JANGAN pakai '/bansos' karena itu halaman hasil setelah scan RFID.
- Jika pengguna ingin cek Pajak PBB / pajek tanah, LANGSUNG panggil navigate_to_page(page='/scan-rfid-pajak'). JANGAN pakai '/pajak'.
- Jika pengguna ingin registrasi e-KTP, daftar KTP, atau hubungkan RFID warga, LANGSUNG panggil navigate_to_page(page='/registrasi-ektp').
- Jika pengguna ingin buku tamu, LANGSUNG panggil navigate_to_page(page='/buku-tamu').
- Jangan pernah meminta NIK secara lisan jika belum memanggil tool navigasi!

ATURAN INFO TERBARU:
- Jika pengguna bertanya jam, tanggal, hari ini, bulan ini, atau waktu sekarang, WAJIB panggil get_current_datetime sebelum menjawab.
- Jika pengguna bertanya info yang bisa berubah seperti presiden saat ini, pejabat, berita terbaru, harga, jadwal, cuaca, aturan, regulasi, status publik, atau info global terkini, WAJIB panggil search_latest_info sebelum menjawab.
- Jangan menjawab info terbaru dari memori model. Jika tool search gagal atau tidak tersedia, katakan singkat bahwa Sinta belum bisa mengambil info terbaru saat ini.
- Untuk data layanan lokal seperti surat, bansos, pajak, absensi, dan buku tamu, tetap gunakan alur aplikasi/backend, bukan search internet.

ATURAN PENGUMPULAN DATA SURAT (SLOT FILLING):
- Saat mengumpulkan data surat, tanyakan SATU pertanyaan per giliran dengan bahasa yang sesuai (Minang atau Indonesia).
- Ketika pengguna menjawab pertanyaan data surat, WAJIB panggil tool fill_slot(slot_key, value) SEGERA sebelum merespons secara lisan.
- Setelah fill_slot dipanggil, lanjutkan tanya slot berikutnya ATAU bacakan ringkasan jika semua data sudah lengkap.
- PENTING: slot_key harus sesuai dengan nama field yang sedang ditanyakan (contoh: 'nama_usaha', 'keperluan', 'tujuan', 'nama_ahli_waris').
- Contoh: User bilang 'nama usaha saya Toko Sepatu' atau 'usaho ambo kadai kopi' → panggil fill_slot(slot_key='nama_usaha', value='Kadai Kopi') lalu konfirmasi.
- Jangan lewati pemanggilan fill_slot saat user memberikan jawaban.

ATURAN KONFIRMASI DATA:
- Setelah SEMUA data terkumpul, bacakan ringkasan semua data yang telah diisi satu per satu dengan ramah (sesuaikan bahasa yang digunakan warga).
- Jika warga berbahasa Minang, katakan: "Kok ado data nan kurang tapek, silakan takan ikon pensil ✏️ di sabalah data tu untuak maubahnyo. Kok alah batua sadonyo, silakan takan tombol Cetak Surek."
- Jika warga berbahasa Indonesia, katakan: "Jika ada data yang kurang tepat, silakan tekan ikon pensil ✏️ di samping data tersebut untuk mengubahnya. Jika semua sudah benar, tekan tombol Cetak Surat."
- JANGAN navigasi atau lakukan aksi apapun setelah konfirmasi — biarkan warga yang memutuskan.` }] }
        },
        callbacks: {
          onopen: () => {
            console.log("\u2705 Terhubung ke Gemini Live!");
            this._emitResponse({ type: 'stateChange', state: 'CONNECTED' });
          },
          onmessage: (e) => {
            // Cek di seluruh struktur `e` untuk menemukan usage
            if (e.serverContent) {
              if (DEBUG_VOICE && e.serverContent.modelTurn && e.serverContent.modelTurn.usage) {
                console.log('📊 Token Usage (Turn):', e.serverContent.modelTurn.usage);
              }
              if (DEBUG_VOICE && e.serverContent.turnComplete) {
                // Terkadang Live API tidak menyediakan field usage secara default, 
                // tapi kita bisa intercept turnComplete
                console.log('🏁 Turn Complete (Sesi Gemini Selesai Bicara)');
              }
              this._handleContent(e.serverContent);
            }
            if (DEBUG_VOICE && e.usage) {
              console.log('📊 Token Usage Total:', e.usage);
            }
            if (e.toolCall) {
              this._lastToolCallAt = Date.now();
              this._handleToolCall(e.toolCall).catch(error => {
                console.error('[GeminiLive] Tool call error:', error);
              });
            }
          },
          onclose: (e) => {
            console.log('Koneksi Gemini Live ditutup.', e ? `Code: ${e.code}, Reason: ${e.reason}` : '');
          },
          onerror: (err) => console.error('Gemini Live error:', err)
        }
      });

      this.isConnecting = false;
      // Flush buffered audio chunks
      while (this.audioBufferQueue.length > 0) {
        const chunk = this.audioBufferQueue.shift();
        this.session.sendRealtimeInput(chunk);
      }

      return true;
    } catch (error) {
      this.isConnecting = false;
      this.audioBufferQueue = [];
      console.error("Gagal terhubung ke Gemini Live:", error);
      this._emitResponse({ type: 'ai_error', message: 'AI Sedang Ada Gangguan' });
      return false;
    }

  }

  deactivate() {
    this.isConnecting = false;
    this._inputPaused = false;
    this.audioBufferQueue = [];
    if (this.session) {
      try {
        if (typeof this.session.close === 'function') {
          this.session.close();
        }
      } catch (e) {
        console.error('Error menutup sesi Gemini Live:', e);
      }
      this.session = null;
    }
  }

  async resetConversation({ reactivate = true } = {}) {
    console.log('🔄 Reset percakapan Gemini Live');
    this.cancelSpeakOnce();
    this.deactivate();
    this._manualMode = false;
    this._inputPaused = false;
    this.audioBufferQueue = [];
    this._chunkCount = 0;

    try {
      const sessionManager = require('./sessionManager');
      if (sessionManager.getSession()) {
        await sessionManager.abandonSession();
      }
    } catch (error) {
      console.error('[GeminiLive] Gagal reset session bisnis:', error.message);
    }

    if (!reactivate) {
      this._emitResponse({ type: 'stateChange', state: 'STANDBY' });
      return true;
    }

    const activated = await this.activate();
    if (!activated) {
      this._emitResponse({ type: 'stateChange', state: 'STANDBY' });
    }
    return activated;
  }

  pauseInput() {
    this._inputPaused = true;
  }

  resumeInput() {
    this._inputPaused = false;
  }

  /**
   * speakOnce — Sesi Gemini khusus untuk TTS one-shot (absensi, notifikasi)
   * Emit state 'SPEAKING' bukan 'CONNECTED', agar useVoiceSession tidak buka mic/greeting.
   * Auto-disconnect setelah timeout.
   */
  async speakOnce(text, timeoutMs = 10000) {
    if (DEBUG_VOICE) console.log('🔊 speakOnce:', text.substring(0, 60) + '...');
    // Tutup sesi speakOnce sebelumnya jika masih aktif
    this.cancelSpeakOnce();

    // Jika sudah ada sesi aktif, gunakan saja
    if (this.session) {
      try {
        this.session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: `[SISTEM] Ucapkan kalimat berikut persis seperti adanya, hangat dan ramah, tanpa tambahan kata lain: "${text}"` }] }]
        });
      } catch (e) { console.error('speakOnce on existing session error:', e); }
      return;
    }
    const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash-8b';
    let speakSession = null;
    const pendingText = `[SISTEM] Ucapkan persis dengan hangat dan ramah, tanpa tambahan: "${text}"`;
    try {
      let apiKey = process.env.GEMINI_API_KEY;
      try {
        const { dbGet } = require('../../infrastructure/database/db');
        const row = await dbGet(`SELECT value FROM settings WHERE key = 'gemini_api_key'`);
        if (row && row.value) {
          apiKey = row.value;
        }
      } catch (dbErr) {}
      // Reuse AI instance jika API key tidak berubah (hemat memory)
      if (!this.ai || this._currentApiKey !== apiKey) {
        this.ai = new GoogleGenAI({ apiKey });
        this._currentApiKey = apiKey;
      }

      speakSession = await this.ai.live.connect({
        model: modelName,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          systemInstruction: { parts: [{ text: 'Kamu adalah asisten Sinta. Ucapkan persis apa yang diminta sistem.' }] }
        },
        callbacks: {
          onopen: () => {
            if (DEBUG_VOICE) console.log('🔊 speakOnce connected OK');
            this._emitResponse({ type: 'stateChange', state: 'SPEAKING' });
          },
          onmessage: (e) => {
            if (e.serverContent) this._handleContent(e.serverContent);
          },
          onclose: (e) => { if (DEBUG_VOICE) console.log(`🔊 speakOnce closed. Code: ${e?.code}, Reason: "${e?.reason}"`); },
          onerror: (err) => console.error('speakOnce error:', err)
        }
      });

      // Tambahkan turnComplete:true agar Gemini tahu user turn selesai dan harus merespons
      if (DEBUG_VOICE) console.log('🔊 Sending content to speakOnce session...');

      // Gemini Live butuh audio context untuk menghasilkan audio output.
      // Kirim beberapa frame audio senyap (silent) untuk membuka audio stream, 
      // lalu kirim teks. Ini meniru perilaku main session yang punya mic aktif.
      const silentFrame = Buffer.alloc(320, 0); // 160 samples @ 16kHz = 10ms silence
      for (let i = 0; i < 5; i++) {
        speakSession.sendRealtimeInput({
          audio: { data: silentFrame.toString('base64'), mimeType: 'audio/pcm;rate=16000' }
        });
      }

      // Tunggu singkat agar audio context terbuka, lalu kirim teks
      await new Promise(r => setTimeout(r, 80));
      speakSession.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: pendingText }] }],
        turnComplete: true
      });

      this._speakSession = speakSession;
      setTimeout(() => { this.cancelSpeakOnce(); }, timeoutMs);
    } catch (err) {
      console.error('speakOnce connect error:', err);
      this._emitResponse({ type: 'ai_error', message: 'AI Sedang Ada Gangguan' });
    }
  }

  /** Hentikan sesi speakOnce yang sedang aktif */
  cancelSpeakOnce() {
    if (this._speakSession) {
      if (DEBUG_VOICE) console.log('🔇 Cancelling active speakOnce session');
      try { this._speakSession.close(); } catch (_) {}
      this._speakSession = null;
    }
  }

  // (Legacy) Frontend mengirim chunk audio sebagai Buffer
  processAudioChunk(chunk) {
    if (this._inputPaused) return;
    if (!this.session) return;
    if (!this._chunkCount) this._chunkCount = 0;
    this._chunkCount++;

    const int16View = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2);
    let sumSq = 0;
    for (let i = 0; i < int16View.length; i++) sumSq += int16View[i] * int16View[i];
    const rms = Math.sqrt(sumSq / int16View.length);

    if (DEBUG_VOICE && this._chunkCount % 16 === 1) {
      console.log(`🎤 Audio chunk #${this._chunkCount}, size: ${chunk.length}B, RMS: ${rms.toFixed(0)} ${rms > 500 ? '🔊 SUARA TERDETEKSI' : '🔇 hening'}`);
    }
    this.session.sendRealtimeInput({
      audio: {
        data: Buffer.from(chunk).toString('base64'),
        mimeType: "audio/pcm;rate=16000"
      }
    });
  }

  // Frontend mengirim base64 (format baru dari useVoiceSession)
  processAudioChunkBase64(base64pcm, frontendRms) {
    if (this._inputPaused) return;
    if (!this.session) {
      if (this.isConnecting) {
        if (this.audioBufferQueue.length >= MAX_CONNECTING_AUDIO_QUEUE) {
          this.audioBufferQueue.shift();
        }
        this.audioBufferQueue.push({
          audio: {
            data: base64pcm,
            mimeType: 'audio/pcm;rate=16000'
          }
        });
      }
      return;
    }

    if (!this._chunkCount) this._chunkCount = 0;
    this._chunkCount++;

    if (DEBUG_VOICE && this._chunkCount % 64 === 1) {
      const rmsLabel = (frontendRms || 0) > 0.003 ? '🔊 SUARA TERDETEKSI' : '🔇 hening';
      console.log(`🎤 Audio chunk #${this._chunkCount}, RMS: ${(frontendRms || 0).toFixed(4)} ${rmsLabel}`);
    }

    this.session.sendRealtimeInput({
      audio: {
        data: base64pcm,
        mimeType: 'audio/pcm;rate=16000'
      }
    });
  }

  // Handle balasan dari Gemini (Audio 24kHz)
  _handleContent(content) {
    if (DEBUG_VOICE && this._lastToolCallAt) {
      console.log(`[GeminiLive] First content after tool: ${Date.now() - this._lastToolCallAt}ms`);
      this._lastToolCallAt = null;
    }
    if (content.modelTurn && content.modelTurn.parts) {
      content.modelTurn.parts.forEach(part => {
        if (part.inlineData && part.inlineData.data) {
          this._emitResponse({
            type: 'audio_stream',
            audioData: part.inlineData.data
          });
        }
        if (DEBUG_VOICE && part.text) {
          console.log('🗣️ Gemini:', part.text);
        }
      });
    }
    if (DEBUG_VOICE && content.outputTranscription) {
      console.log('🗣️ Gemini:', content.outputTranscription.text);
    }
    if (DEBUG_VOICE && content.inputTranscription) {
      console.log('🎤 User:', content.inputTranscription.text);
    }
    if (DEBUG_VOICE && content.interrupted) {
      console.log('⏸️ Gemini interrupted');
    }
    if (DEBUG_VOICE && content.turnComplete) {
      console.log('🏁 Turn Complete (Sesi Gemini Selesai Bicara)');
    }
  }

  // Handle ketika Gemini memanggil fungsi (navigate_to_page, set_nik)
  async _handleToolCall(call) {
    const fnCalls = call.functionCalls;
    for (const fn of fnCalls) {
      if (DEBUG_VOICE) console.log(`🤖 Gemini memanggil fungsi: ${fn.name}`, fn.args);
      let toolResponse = { success: true };

      if (fn.name === 'navigate_to_page') {
        const targetPage = fn.args.page;
        const allowedPages = ['/', '/profil-warga']; // Halaman yang boleh navigasi bebas
        const isGoingHome = targetPage === '/'; // Cancel/batalkan → kembali ke beranda

        if (isGoingHome || allowedPages.includes(this._currentPage)) {
          // Izinkan: kembali ke beranda (cancel) atau navigasi dari halaman yang diizinkan
          this._emitResponse({
            type: 'response',
            action: 'NAVIGATE',
            path: targetPage,
            nextPath: fn.args.nextPath,
            timestamp: Date.now()
          });
        } else {
          console.log(`🚫 Navigasi DITOLAK: AI coba navigasi ke ${targetPage} dari ${this._currentPage}`);
          toolResponse = { success: false, error: `Navigasi tidak diizinkan. Kamu sedang di halaman ${this._currentPage}. Selesaikan proses di halaman ini terlebih dahulu. Jangan pindah halaman kecuali kembali ke beranda jika user yakin ingin membatalkan.` };
        }
      } else if (fn.name === 'set_nik') {
        this._emitResponse({
          type: 'response',
          action: 'NAVIGATE',
          path: '/profil-warga',
          sessionData: { nik: fn.args.nik },
          timestamp: Date.now()
        });
      } else if (fn.name === 'select_surat') {
        this._emitResponse({
          type: 'response',
          action: 'SELECT_TEMPLATE',
          templateName: fn.args.template_name,
          timestamp: Date.now()
        });
      } else if (fn.name === 'fill_slot') {
        // Isi slot di session manager dengan nilai yang disebutkan warga
        const sessionManager = require('./sessionManager');
        const session = sessionManager.getSession();
        if (session && session.phase === 'SLOT_FILLING') {
          let value = fn.args.value;
          try {
            const minangDialectService = require('./minangDialectService');
            if (typeof value === 'string') {
              const numMap = minangDialectService.getCategory('numbers');
              const lower = value.toLowerCase().trim();
              if (numMap && numMap[lower] !== undefined && typeof numMap[lower] === 'number') {
                value = String(numMap[lower]);
              }
            }
          } catch (e) {
            console.warn('[GeminiLive] Minang slot normalization error:', e.message);
          }

          const fillResult = sessionManager.fillSlot(fn.args.slot_key, value);
          if (DEBUG_VOICE) console.log(`✅ Slot filled via voice: ${fn.args.slot_key} = "${value}" | allFilled: ${fillResult?.allFilled}`);
          // Emit session update ke frontend agar form langsung ter-update
          this._emitResponse({
            type: 'session_update',
            slots: session.slots,
            slotDefs: session.slotDefs,
            current_slot: session.current_slot,
            phase: session.phase,
            jenis_surat: session.jenis_surat,
            timestamp: Date.now()
          });

          // Jika semua slot sudah terisi, kirim prompt ke Gemini untuk bacakan ringkasan
          if (fillResult?.allFilled) {
            // Susun ringkasan data yang terisi
            const ringkasan = session.slotDefs
              .filter(def => session.slots[def.key])
              .map(def => `${def.label}: ${session.slots[def.key]}`)
              .join(', ');

            const confirmPrompt = `[SISTEM] Semua data surat telah terkumpul. Ringkasan data: ${ringkasan}. Tolong bacakan semua data ini kepada warga secara ramah dan jelas satu per satu menggunakan bahasa yang sama dengan yang digunakan warga (Bahasa Minang jika warga berbahasa Minang, atau Bahasa Indonesia jika warga berbahasa Indonesia). Setelah selesai, beri tahu warga: jika ada data yang kurang tepat, silakan tekan ikon pensil di samping data yang ingin diubah; jika semua sudah benar, tekan tombol Cetak Surat. Jangan lakukan navigasi apapun.`;

            try {
              this.session.sendClientContent({
                turns: [{ role: 'user', parts: [{ text: confirmPrompt }] }]
              });
            } catch (e) {
              console.error('[GeminiLive] Error sending confirmation prompt:', e);
            }
          }
        }
      } else if (fn.name === 'get_current_datetime') {
        toolResponse = this._getCurrentDateTime(fn.args?.locale || 'id-ID');
      } else if (fn.name === 'search_latest_info') {
        toolResponse = await this._searchLatestInfo(fn.args?.query, fn.args?.locale || 'id-ID');
      }

      // Kirim hasil balasan fungsi ke Gemini (wajib agar Gemini tahu fungsinya berhasil dieksekusi)
      if (this.session) {
        this.session.sendToolResponse({
          functionResponses: [{
            id: fn.id,
            name: fn.name,
            response: toolResponse
          }]
        });
      }
    }
  }

  _emitResponse(data) {
    if (this.onResponseCallback) this.onResponseCallback(data);
  }

  _getCurrentDateTime(locale = 'id-ID') {
    const safeLocale = String(locale || 'id-ID').trim().replace('_', '-');
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Jakarta';

    try {
      return {
        success: true,
        iso: now.toISOString(),
        timezone: timeZone,
        locale: safeLocale,
        date: now.toLocaleDateString(safeLocale, {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone,
        }),
        time: now.toLocaleTimeString(safeLocale, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone,
        }),
      };
    } catch (err) {
      return {
        success: true,
        iso: now.toISOString(),
        timezone: timeZone,
        locale: 'id-ID',
        date: now.toLocaleDateString('id-ID', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone,
        }),
        time: now.toLocaleTimeString('id-ID', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZone,
        }),
      };
    }
  }

  async _searchLatestInfo(query, locale = 'id-ID') {
    const safeLocale = String(locale || 'id-ID').trim().replace('_', '-');
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      return {
        success: false,
        error: 'Query pencarian kosong.',
      };
    }

    const apiKey = process.env.SEARCH_API_KEY || process.env.TAVILY_API_KEY || process.env.SERPAPI_API_KEY || '';
    if (!apiKey) {
      return {
        success: false,
        query: normalizedQuery,
        error: 'SEARCH_API_KEY belum dikonfigurasi.',
      };
    }

    try {
      if (SEARCH_API_PROVIDER === 'serpapi') {
        return await this._searchWithSerpApi(normalizedQuery, safeLocale, apiKey);
      }
      return await this._searchWithTavily(normalizedQuery, safeLocale, apiKey);
    } catch (error) {
      console.error('[FreshInfo] Search error:', error.message);
      return {
        success: false,
        query: normalizedQuery,
        provider: SEARCH_API_PROVIDER,
        error: error.message,
      };
    }
  }

  async _searchWithTavily(query, locale, apiKey) {
    const response = await this._postJson('https://api.tavily.com/search', {
      api_key: apiKey,
      query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 5,
      include_raw_content: false,
    });

    const results = Array.isArray(response.results) ? response.results.slice(0, 5) : [];
    return {
      success: true,
      provider: 'tavily',
      query,
      locale,
      answer: response.answer || '',
      sources: results.map((item) => ({
        title: item.title || '',
        url: item.url || '',
        content: item.content || '',
        published_date: item.published_date || '',
      })),
    };
  }

  async _searchWithSerpApi(query, locale, apiKey) {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: apiKey,
      hl: locale.startsWith('id') ? 'id' : 'en',
      gl: locale.startsWith('id') ? 'id' : 'us',
      num: '5',
    });
    const response = await this._getJson(`https://serpapi.com/search.json?${params.toString()}`);
    const organic = Array.isArray(response.organic_results) ? response.organic_results.slice(0, 5) : [];

    return {
      success: true,
      provider: 'serpapi',
      query,
      locale,
      answer: response.answer_box?.answer || response.answer_box?.snippet || '',
      sources: organic.map((item) => ({
        title: item.title || '',
        url: item.link || '',
        content: item.snippet || '',
        published_date: item.date || '',
      })),
    };
  }

  _postJson(url, payload) {
    return this._requestJson('POST', url, payload);
  }

  _getJson(url) {
    return this._requestJson('GET', url);
  }

  _requestJson(method, urlString, payload = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const body = payload ? JSON.stringify(payload) : '';
      const req = https.request({
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          } : {}),
        },
        timeout: SEARCH_API_TIMEOUT_MS,
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch (error) {
            reject(new Error(`Search API response parse error: ${data.substring(0, 160)}`));
            return;
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject(new Error(`Search API error ${res.statusCode}: ${parsed.error || parsed.message || data.substring(0, 160)}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Search API request timeout'));
      });

      if (body) req.write(body);
      req.end();
    });
  }

  // --- COMPATIBILITY METHODS ---
  // Agar tidak error ketika dipanggil oleh voiceController lama
  setOnStateChange(callback) { }
  async synthesize(text) { return { success: true }; }
  async processKeyboardInput(slotKey, value) {
    const sessionManager = require('./sessionManager');
    const fillResult = sessionManager.fillSlot(slotKey, value);

    if (this._manualMode && fillResult && fillResult.allFilled) {
      sessionManager.setPhase('CONFIRMATION');
      this._emitResponse({ type: 'stateChange', state: 'CONFIRMATION_READY' });
    }

    if (!this._manualMode && this.session) {
      try {
        const promptText = fillResult && fillResult.allFilled
          ? `Saya telah mengetik data terakhir secara manual untuk kolom ${slotKey} yaitu: "${value}". Semua data telah lengkap. Tolong beritahu saya untuk segera menekan tombol cetak surat yang ada di layar.`
          : `Saya telah mengetik data secara manual untuk kolom ${slotKey} yaitu: "${value}". Lanjutkan ke pertanyaan berikutnya.`;

        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: promptText }]
          }]
        });
      } catch (e) {
        console.error('Error sending keyboard input to Gemini:', e);
      }
    }
  }
  async handleTranscriptDirect(transcript) { }
  async startSlotFillingDirect() {
    const sessionManager = require('./sessionManager');
    sessionManager.setPhase('SLOT_FILLING');

    const session = sessionManager.getSession();

    // Reactivate if it was deactivated by manual mode
    if (!this._manualMode && !this.session && !this.isConnecting) {
      await this.activate();
    }

    if (!this._manualMode && this.session && session && session.slotDefs) {
      const pendingSlots = session.slotDefs
        .filter(s => !session.slots[s.key])
        .map(s => s.label || s.key)
        .join(', ');

      try {
        this.session.sendClientContent({
          turns: [{
            role: 'user',
            parts: [{ text: `Saya telah memilih untuk membuat surat "${session.jenis_surat}". Tolong bantu saya mengumpulkan data berikut: [ ${pendingSlots} ]. Ingat, tanyakan secara berurutan SATU PER SATU. Tanyakan pertanyaan pertama SEKARANG.` }]
          }]
        });
      } catch (e) {
        console.error('Error instructing Gemini for slot filling:', e);
      }
    }

    return { success: true };
  }
  enterManualMode() {
    console.log('🛑 Berpindah ke Manual Mode - Mematikan Voice AI');
    this._manualMode = true;
    this.deactivate();
    this._emitResponse({ type: 'stateChange', state: 'MANUAL_MODE' });
  }
  exitManualMode() {
    this._manualMode = false;
  }

  isManualMode() {
    return this._manualMode;
  }
}

module.exports = new GeminiLiveService();
