# ANM Voice AI — Dokumentasi Teknis
**Anjungan Nagari Mandiri | Voice Assistant System**

> Dokumen ini ditujukan untuk tim developer yang membangun fitur Voice AI pada sistem ANM berbasis Electron + React + Laravel. Dokumen mencakup arsitektur sistem, alur interaksi per fase, strategi prompt Phi-3 Mini, state management, stack teknologi, dan catatan technical debt.

---

## Daftar Isi

1. [System Overview & Arsitektur](#1-system-overview--arsitektur)
2. [Stack Teknologi & Alasan Pemilihan](#2-stack-teknologi--alasan-pemilihan)
3. [Flow Lengkap Per Fase](#3-flow-lengkap-per-fase)
4. [Phi-3 Mini Prompt Engineering](#4-phi-3-mini-prompt-engineering)
5. [State Management Conversation](#5-state-management-conversation)
6. [Technical Debt & Risiko](#6-technical-debt--risiko)

---

## 1. System Overview & Arsitektur

### 1.1 Konsep Utama

ANM (Anjungan Nagari Mandiri) adalah sistem kiosk mandiri berbasis desktop (Electron + React) yang memungkinkan warga nagari mengurus administrasi surat-menyurat secara mandiri melalui antarmuka suara. AI berperan sebagai **konduktor alur kerja** — bukan sekadar chatbot — yang mengarahkan, mengumpulkan data, memvalidasi, dan mengeksekusi endpoint backend Laravel.

**Prinsip desain utama:**
- Tidak ada tombol on/off percakapan — sistem selalu mendengarkan (always-on via VAD)
- AI yang memandu user, bukan user yang navigasi menu
- Semua proses bisa berjalan **lokal penuh** (offline-first)
- Koneksi internet hanya meningkatkan kualitas, bukan syarat mutlak

### 1.2 Diagram Arsitektur Komponen

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP APP                      │
│                                                             │
│  ┌──────────────────────┐    ┌───────────────────────────┐  │
│  │   RENDERER PROCESS   │    │      MAIN PROCESS         │  │
│  │   (React / Chromium) │    │      (Node.js)            │  │
│  │                      │    │                           │  │
│  │  GlobalVoiceWidget   │◄──►│  voiceController.js       │  │
│  │  VirtualKeyboard     │IPC │  sttService.js            │  │
│  │  BarcodeDisplay      │    │  ttsService.js            │  │
│  │  AvatarLipsync       │    │  intentService.js         │  │
│  └──────────────────────┘    │  ollamaService.js         │  │
│                              │  voiceRepository.js       │  │
│                              └────────────┬──────────────┘  │
└───────────────────────────────────────────┼─────────────────┘
                                            │
                    ┌───────────────────────┼───────────────┐
                    │                       │               │
              ┌─────▼──────┐      ┌────────▼──────┐  ┌─────▼──────┐
              │   Ollama   │      │  Whisper.cpp  │  │  Laravel   │
              │  Phi-3 Mini│      │  (STT lokal)  │  │  Backend   │
              │  (LLM lokal│      │               │  │  REST API  │
              │  port 11434│      └───────────────┘  └────────────┘
              └────────────┘
```

### 1.3 Prinsip Komunikasi

- **Renderer ↔ Main Process:** IPC (Inter-Process Communication) via `ipcRenderer` / `ipcMain`
- **Main Process ↔ Ollama:** HTTP REST ke `localhost:11434`
- **Main Process ↔ Whisper:** Spawn child process atau via `whisper.cpp` binding
- **Main Process ↔ Laravel:** HTTP REST ke endpoint backend (bisa localhost atau remote)
- **Main Process ↔ Edge TTS:** HTTP ke Microsoft TTS API (butuh internet) atau fallback ke Windows SAPI (offline)

---

## 2. Stack Teknologi & Alasan Pemilihan

### 2.1 Tabel Stack

| Layer | Teknologi | Mode | Alasan Pemilihan |
|---|---|---|---|
| **LLM / Intent** | Ollama + Phi-3 Mini (3.8B) | Lokal penuh | Jalan tanpa GPU, ~2.3GB, latensi rendah, tidak butuh API key atau internet |
| **STT** | Whisper.cpp (`small` model) | Lokal penuh | Model `small` (~150MB) cukup akurat untuk BI formal, jalan di CPU |
| **TTS (primary)** | Edge TTS (`id-ID-ArdiNeural` / `id-ID-GadisNeural`) | Online | Suara paling natural untuk Bahasa Indonesia, gratis, tanpa API key |
| **TTS (fallback)** | Windows SAPI / `say` | Offline | Built-in OS, tidak perlu install tambahan, kualitas lebih kasar tapi selalu tersedia |
| **VAD** | Silero VAD | Lokal penuh | Ringan (~1MB), akurasi tinggi untuk deteksi voice activity, jalan real-time |
| **Cache** | SQLite via `better-sqlite3` | Lokal penuh | Simpan hash teks + path audio TTS agar tidak regenerasi ulang |
| **Backend** | Laravel (multi-tenant) | Remote / LAN | Sudah ada, REST API, middleware multi-tenant siap |
| **Desktop** | Electron + React | — | Cross-platform, akses langsung ke mic/kamera/sistem file |

### 2.2 Mengapa Phi-3 Mini, Bukan Model Lain?

**Kelebihan:**
- Ukuran model paling kecil yang masih kompeten untuk reasoning bahasa Indonesia (3.8B parameter)
- Latensi respons terbaik dibanding Llama 3.2 dan Mistral 7B di hardware sama
- Jalan stabil di CPU tanpa GPU (penting untuk PC kiosk berbiaya rendah)
- Tidak butuh koneksi internet sama sekali

**Kelemahan yang harus diantisipasi:**
- JSON compliance rendah — output tidak selalu valid JSON meski diminta
- Kurang andal untuk instruksi kompleks multi-step dalam satu prompt
- **Mitigasi:** Gunakan prompt sederhana, parsing output dengan regex sebagai fallback, dan validasi output sebelum digunakan

### 2.3 Mengapa Whisper `small`, Bukan `base` atau `medium`?

| Model | Ukuran | WER BI Formal | Latensi (~) | Rekomendasi |
|---|---|---|---|---|
| `tiny` | ~75MB | Tinggi | <1 detik | Terlalu banyak error untuk produksi |
| `base` | ~145MB | Sedang | ~1 detik | Bisa dipakai jika RAM terbatas |
| `small` | ~462MB | Rendah | ~2-3 detik | **Rekomendasi untuk ANM** |
| `medium` | ~1.5GB | Sangat rendah | ~5-8 detik | Terlalu lambat untuk kiosk interaktif |

> **Catatan:** WER (Word Error Rate) Whisper untuk percakapan informal Bahasa Indonesia masih tinggi. Warga desa berbicara informal — antisipasi dengan sistem retry dan konfirmasi aktif oleh AI.

---

## 3. Flow Lengkap Per Fase

### Gambaran Besar (6 Fase)

```
Fase 1: Deteksi → Fase 2: STT → Fase 3: Slot Filling
    → Fase 4: Konfirmasi → Fase 5: Eksekusi → Fase 6: Resi
```

---

### Fase 1 — Deteksi Kehadiran & Sapaan

```
[Kamera aktif] → [Deteksi motion/wajah] → [Sistem bangun dari STANDBY]
      → [Mic aktif + VAD mulai monitor] → [Edge TTS: "Selamat datang di ANM..."]
```

**Detail teknis:**
- Kamera diakses via `getUserMedia` di Renderer, frame dikirim ke Main Process via IPC
- Deteksi menggunakan motion detection sederhana (selisih frame) — tidak perlu face recognition
- Setelah deteksi, sistem berpindah state dari `STANDBY` ke `LISTENING`
- VAD (Silero) mulai memantau mic secara real-time

**IPC events:**
- `camera:personDetected` → Renderer ke Main
- `system:activate` → Main ke Renderer (untuk update UI)
- `voice:synthesize` → Main minta TTS sapaan awal

---

### Fase 2 — Speech-to-Text (STT)

```
[User berbicara] → [VAD deteksi voice activity] → [Buffer audio]
      → [800ms senyap] → [Whisper.cpp transkrip] → [Teks dikirim ke intent engine]
```

**State machine STT:**

```
STANDBY ──(deteksi orang)──► LISTENING
LISTENING ──(VAD: ada suara)──► BUFFERING_AUDIO
BUFFERING_AUDIO ──(800ms senyap)──► TRANSCRIBING
TRANSCRIBING ──(Whisper selesai)──► PROCESSING
PROCESSING ──(selesai respons)──► LISTENING  (atau STANDBY jika sesi selesai)
```

**Catatan penting:**
- Chunk audio dikirim setiap 250ms dari `MediaRecorder` (format `webm/opus`)
- Silence threshold 800ms — cukup memberi jeda natural tanpa terasa lambat
- Timeout 5 detik tanpa suara → kembali ke `STANDBY`
- Jika transkrip terlalu pendek (<3 karakter) → abaikan, minta ulang

---

### Fase 3 — Intent Parsing & Slot Filling

Ini adalah fase terpanjang dan terpenting. Phi-3 Mini bertugas sebagai **slot filling engine** — mengidentifikasi intent dan mengumpulkan data yang dibutuhkan satu per satu.

#### 3.1 Struktur Slot per Jenis Surat

```javascript
const SLOT_DEFINITIONS = {
  keterangan_usaha: [
    { key: 'nik',         label: 'NIK',          type: 'numeric_16', required: true  },
    { key: 'nama_usaha',  label: 'nama usaha',    type: 'text',       required: true  },
    { key: 'alamat_usaha',label: 'alamat usaha',  type: 'text',       required: true  },
    { key: 'tujuan',      label: 'tujuan surat',  type: 'text',       required: false }
  ],
  domisili: [
    { key: 'nik',         label: 'NIK',           type: 'numeric_16', required: true  },
    { key: 'tujuan',      label: 'tujuan surat',  type: 'text',       required: true  }
  ],
  tidak_mampu: [
    { key: 'nik',         label: 'NIK',           type: 'numeric_16', required: true  },
    { key: 'keperluan',   label: 'keperluan',     type: 'text',       required: true  }
  ]
}
```

#### 3.2 Loop Slot Filling

```
[Phi-3 terima teks] → [Ekstrak intent + jenis surat]
      → [Inisialisasi slot state semua = null]
      → LOOP:
            [Cari slot pertama yang masih null]
            [Generate pertanyaan natural via Phi-3]
            [Edge TTS bacakan pertanyaan]
            [Tunggu jawaban user via STT atau keyboard]
            [Phi-3 ekstrak nilai dari jawaban]
            [Validasi format (NIK 16 digit, dst)]
            [Isi slot, lanjut ke slot berikutnya]
      → [Semua slot required terisi → lanjut Fase 4]
```

---

### Fase 4 — Konfirmasi Data

```
[Phi-3 generate kalimat rangkuman] → [Edge TTS bacakan]
      → [User respons: YA / TIDAK / TIDAK_JELAS]
      → [Phi-3 klasifikasi respons]
            → YA: lanjut eksekusi
            → TIDAK: tanya slot mana yang salah → ulangi slot itu saja
            → TIDAK_JELAS: ulangi pertanyaan konfirmasi (max 3x)
```

**Contoh output TTS konfirmasi:**
> "Baik, saya rangkumkan data bapak/ibu. NIK: 3274 0101 9001 0001. Nama usaha: Warung Serba Ada. Alamat: Jalan Merdeka Nomor 12. Apakah semua data ini sudah benar?"

---

### Fase 5 — Eksekusi ke Laravel

```
[Konfirmasi YA] → [Electron kirim POST /api/surat]
      → [Header: Authorization + X-Tenant-ID]
      → [Laravel proses + simpan ke DB]
      → [Return: { surat_id, kode_resi, status }]
      → [Electron terima response]
```

**Request format:**
```json
POST /api/v1/surat
Headers:
  Authorization: Bearer {tenant_token}
  X-Tenant-ID: {nagari_id}
  Content-Type: application/json

Body:
{
  "jenis_surat": "keterangan_usaha",
  "nik": "3274010190010001",
  "nama_usaha": "Warung Serba Ada",
  "alamat_usaha": "Jl. Merdeka No. 12",
  "tujuan": "Pengajuan kredit usaha"
}
```

**Response format:**
```json
{
  "status": "success",
  "surat_id": "SKU-2024-00123",
  "kode_resi": "ANM-XK29-7R",
  "pesan": "Surat berhasil diajukan. Silakan ambil di kantor nagari."
}
```

---

### Fase 6 — Tampil Resi & Selesai

```
[Terima kode_resi] → [Generate QR code di Electron]
      → [Tampilkan di layar + Edge TTS jelaskan cara ambil]
      → [Tunggu 30 detik atau user pergi]
      → [Reset session → kembali STANDBY]
```

**Penjelasan TTS penutup (contoh):**
> "Pengajuan surat bapak/ibu telah berhasil. Silakan tunjukkan kode resi ini kepada petugas kantor nagari untuk mengambil surat yang telah ditandatangani. Kode resi anda adalah: A-N-M, X-K-2-9, 7-R. Terima kasih."

---

## 4. Phi-3 Mini Prompt Engineering

### 4.1 Prinsip Dasar

Karena Phi-3 Mini memiliki JSON compliance rendah, strategi prompt harus:
1. **Sesederhana mungkin** — satu tugas per request
2. **Output format eksplisit** — instruksikan format dengan contoh konkret
3. **Selalu ada fallback parsing** — jangan bergantung penuh pada JSON valid
4. **Bahasa campuran** — instruksi boleh Inggris, tapi contoh output dalam Bahasa Indonesia

### 4.2 System Prompt Utama

```
Kamu adalah RANI, asisten pelayanan ANM (Anjungan Nagari Mandiri).
Tugasmu membantu warga mengurus surat administrasi nagari.

ATURAN:
- Selalu gunakan Bahasa Indonesia yang sopan dan mudah dipahami
- Tanya satu hal dalam satu waktu, jangan bertumpuk
- Jika warga menyebut NIK, pastikan 16 digit
- Jangan pernah mengarang data — selalu tanya jika tidak tahu
- Jika warga tidak paham, sederhanakan pertanyaan

KONTEKS SISTEM:
- Ini adalah kiosk mandiri di kantor nagari
- Warga mungkin tidak familiar dengan teknologi
- Gunakan bahasa yang dipakai sehari-hari di desa
```

### 4.3 Prompt Intent Extraction

Digunakan saat menerima teks pertama dari user.

```
Tugas: Identifikasi maksud dari kalimat warga berikut.

Kalimat warga: "{user_text}"

Pilihan intent yang tersedia:
- BUAT_SURAT_USAHA
- BUAT_SURAT_DOMISILI
- BUAT_SURAT_TIDAK_MAMPU
- CEK_STATUS_SURAT
- TIDAK_DIKENAL

Jika BUAT_SURAT, identifikasi juga apakah ada data yang sudah disebutkan
(misal: warga langsung sebut NIK atau nama usaha di kalimat awal).

Jawab HANYA dalam format ini, tanpa penjelasan tambahan:
INTENT: [nama intent]
DATA_NIK: [isi jika ada, kosong jika tidak]
DATA_LAIN: [isi jika ada, kosong jika tidak]
```

**Contoh output yang diharapkan:**
```
INTENT: BUAT_SURAT_USAHA
DATA_NIK:
DATA_LAIN:
```

**Parsing di Node.js:**
```javascript
function parseIntentResponse(raw) {
  const intent = raw.match(/INTENT:\s*(\w+)/)?.[1] ?? 'TIDAK_DIKENAL';
  const nik    = raw.match(/DATA_NIK:\s*(\d+)/)?.[1] ?? null;
  return { intent, nik };
}
```

### 4.4 Prompt Slot Question Generator

Digunakan untuk menghasilkan pertanyaan natural per slot.

```
Kamu sedang membantu warga mengurus {jenis_surat}.
Slot yang sudah terisi: {filled_slots}
Slot yang perlu ditanyakan sekarang: {current_slot_label}

Buat SATU kalimat pertanyaan yang natural dan sopan untuk menanyakan
"{current_slot_label}" kepada warga.

Pertanyaan harus:
- Singkat (maksimal 15 kata)
- Mudah dipahami warga desa
- Menggunakan kata "bapak/ibu" sebagai sapaan

Jawab HANYA dengan kalimat pertanyaannya saja, tanpa tanda kutip.
```

**Contoh output:**
```
Boleh saya minta nomor NIK bapak/ibu yang 16 digit?
```

### 4.5 Prompt Konfirmasi YA/TIDAK

Digunakan untuk mengklasifikasi respons user saat konfirmasi data.

```
Warga baru saja menjawab: "{user_response}"

Klasifikasikan jawaban ini:
- YA: jika warga setuju / membenarkan / mengkonfirmasi
- TIDAK: jika warga menolak / menyalahkan / ingin ubah data
- TIDAK_JELAS: jika jawaban tidak bisa diinterpretasi

Jawab HANYA dengan satu kata: YA, TIDAK, atau TIDAK_JELAS
```

### 4.6 Prompt Rangkuman Konfirmasi

Digunakan untuk membacakan semua data sebelum eksekusi.

```
Data yang sudah terkumpul untuk surat {jenis_surat}:
{slot_data_json}

Buat kalimat rangkuman yang akan dibacakan kepada warga untuk dikonfirmasi.
Kalimat harus:
- Menyebutkan semua data dengan jelas
- Diakhiri dengan pertanyaan konfirmasi
- Panjang maksimal 3 kalimat
- Menggunakan gaya bahasa lisan (akan dibacakan, bukan dibaca)

Jawab HANYA dengan kalimat rangkumannya.
```

---

## 5. State Management Conversation

### 5.1 Struktur Session State

Setiap interaksi user menghasilkan satu session. State disimpan di **memori Electron Main Process** selama sesi berlangsung, dan di **SQLite** untuk keperluan resume dan logging.

```javascript
// Struktur session state lengkap
const sessionState = {
  // Identifikasi sesi
  session_id:     'uuid-v4',
  started_at:     '2024-01-15T08:30:00Z',
  nagari_id:      'nagari-123',           // dari config kiosk

  // State mesin
  phase:          'SLOT_FILLING',         // GREETING | INTENT | SLOT_FILLING | CONFIRMATION | EXECUTING | DONE
  system_state:   'LISTENING',            // STANDBY | LISTENING | BUFFERING | TRANSCRIBING | PROCESSING

  // Data intent
  intent:         'BUAT_SURAT_USAHA',
  jenis_surat:    'keterangan_usaha',

  // Slot data
  slots: {
    nik:          '3274010190010001',      // terisi
    nama_usaha:   'Warung Serba Ada',     // terisi
    alamat_usaha: null,                   // belum terisi → slot aktif
    tujuan:       null                    // belum terisi
  },

  // Tracking percakapan
  current_slot:       'alamat_usaha',     // slot yang sedang ditanya
  retry_count:        0,                  // berapa kali diulang di slot ini
  confirmation_retry: 0,                  // berapa kali konfirmasi diulang

  // History percakapan (untuk context Phi-3)
  conversation: [
    { role: 'assistant', content: 'Selamat datang di ANM...' },
    { role: 'user',      content: 'Saya mau buat surat usaha' },
    { role: 'assistant', content: 'Boleh saya minta NIK bapak/ibu?' },
    { role: 'user',      content: 'NIK saya 3274010190010001' },
  ],

  // Hasil akhir
  result: null   // diisi setelah eksekusi berhasil: { surat_id, kode_resi }
}
```

### 5.2 Skema SQLite

```sql
-- Tabel session aktif & riwayat
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  nagari_id     TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  phase         TEXT NOT NULL DEFAULT 'GREETING',
  intent        TEXT,
  jenis_surat   TEXT,
  slots_json    TEXT,           -- JSON serialized slot state
  result_json   TEXT,           -- JSON serialized hasil akhir
  status        TEXT DEFAULT 'active'  -- active | completed | abandoned | error
);

-- Tabel cache TTS (dari arsitektur Nagari AI)
CREATE TABLE IF NOT EXISTS voice_cache (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_hash TEXT UNIQUE NOT NULL,   -- MD5 dari teks
  audio_path    TEXT NOT NULL,          -- path file MP3 lokal
  created_at    TEXT NOT NULL,
  last_used_at  TEXT
);

-- Index untuk performa
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_cache_hash ON voice_cache(question_hash);
```

### 5.3 Kapan Pakai Memori vs SQLite

| Data | Penyimpanan | Alasan |
|---|---|---|
| `session_state` aktif | Memori (in-process object) | Akses cepat, tidak perlu I/O disk setiap update |
| Slot data | Memori | Berubah sangat sering (setiap jawaban user) |
| `conversation` history | Memori | Dikirim ke Phi-3 setiap request, harus cepat |
| Session log | SQLite | Untuk audit, resume, dan analytics |
| TTS cache | SQLite + disk | Persist antar restart kiosk |
| Config kiosk | SQLite | Tenant ID, nama nagari, dll |

### 5.4 Timeout & Recovery

```
Timeout rules:
- Tidak ada suara 5 detik saat LISTENING → kembali STANDBY, session abandoned
- Tidak ada respon saat CONFIRMATION 10 detik → ulangi pertanyaan (max 3x)
- Retry slot > 3x gagal validasi → AI sarankan pakai keyboard
- Session total > 10 menit → force abandon, simpan log, reset

Recovery rules:
- Kiosk restart saat session 'active' → tandai sebagai 'abandoned' di DB
- Tidak ada resume session — setiap interaksi selalu mulai fresh
```

---

## 6. Technical Debt & Risiko

### 6.1 Risiko Tinggi

#### R1 — Akurasi STT Bahasa Indonesia Informal
**Masalah:** Whisper memiliki Word Error Rate tinggi untuk percakapan informal Bahasa Indonesia. Warga desa berbicara dengan aksen lokal, kata-kata tidak baku, dan kalimat tidak lengkap.

**Dampak:** AI salah tangkap → slot diisi data salah → user frustrasi.

**Mitigasi:**
- Selalu konfirmasi ulang setiap slot setelah diisi ("Apakah NIK-nya 1234...?")
- Sediakan virtual keyboard sebagai alternatif input wajib untuk NIK (16 digit numerik)
- Tampilkan teks hasil transkripsi di layar agar user bisa koreksi
- Pertimbangkan fine-tuning Whisper dengan data audio Bahasa Indonesia lokal di masa depan

#### R2 — JSON Compliance Phi-3 Mini Rendah
**Masalah:** Phi-3 Mini tidak selalu menghasilkan JSON valid meski diminta, terutama untuk instruksi kompleks.

**Dampak:** Parsing error → crash atau intent salah.

**Mitigasi:**
- Hindari meminta output JSON — gunakan format teks sederhana dengan label (lihat bagian 4)
- Selalu gunakan regex sebagai fallback parser, bukan `JSON.parse` langsung
- Beri instruksi format dengan contoh konkret di setiap prompt
- Validasi output sebelum digunakan; jika gagal parse → retry prompt dengan instruksi lebih sederhana

#### R3 — Edge TTS Butuh Internet
**Masalah:** Edge TTS tidak bisa digunakan saat koneksi internet putus.

**Dampak:** Kiosk bisu — tidak bisa memberikan feedback suara ke user.

**Mitigasi:**
- Implementasi fallback ke Windows SAPI (built-in, offline) secara otomatis
- Cache response Edge TTS yang sering digunakan (sapaan, pertanyaan slot standar) ke disk
- Tampilkan teks di layar sebagai fallback visual jika TTS tidak tersedia sama sekali

### 6.2 Risiko Menengah

#### R4 — Latensi Phi-3 Mini di Hardware Rendah
**Masalah:** Phi-3 Mini di CPU tanpa GPU bisa menghasilkan token dengan kecepatan 3-8 token/detik. Untuk respons 30 kata, ini bisa memakan 4-10 detik.

**Mitigasi:**
- Gunakan prompt pendek dan output pendek (maksimal 2-3 kalimat per respons)
- Tampilkan animasi "sedang berpikir" di UI agar user tidak mengira kiosk hang
- Pre-load model Ollama saat startup — jangan lazy load
- Pertimbangkan mengganti sebagian logika ke rule-based yang instan (intent sederhana tidak perlu Phi-3)

#### R5 — Akumulasi File TTS Cache
**Masalah:** File MP3 TTS yang di-cache akan menumpuk di storage kiosk seiring waktu.

**Mitigasi:**
- Implementasi cron job harian untuk hapus cache > 30 hari tidak terpakai
- Update kolom `last_used_at` setiap cache hit
- Batasi ukuran folder cache (misal: max 500MB), hapus yang terlama jika melebihi batas

#### R6 — Keamanan Data NIK di Kiosk Publik
**Masalah:** Kiosk berada di tempat umum. Data NIK dan informasi pribadi warga tersimpan di session log SQLite di mesin lokal.

**Mitigasi:**
- Enkripsi SQLite menggunakan `better-sqlite3` dengan SQLCipher
- Hapus session log lebih dari 7 hari secara otomatis
- Jangan log teks percakapan mentah ke file — hanya log metadata (intent, timestamp, status)
- Layar timeout otomatis 30 detik setelah sesi selesai

### 6.3 Utang Teknis yang Direncanakan

| Item | Prioritas | Keterangan |
|---|---|---|
| Fine-tuning Whisper untuk dialek lokal | Tinggi | Dilakukan setelah data audio terkumpul dari penggunaan nyata |
| Penggantian Edge TTS dengan model TTS lokal (misal: Coqui TTS Bahasa Indonesia) | Menengah | Eliminasi ketergantungan internet untuk TTS |
| Migrasi intent engine dari Phi-3 ke model yang lebih kecil dan spesifik | Menengah | Model khusus intent lebih cepat dan andal dari LLM umum |
| Implementasi multi-bahasa (Minang + Indonesia) | Rendah | Setelah sistem stabil dalam Bahasa Indonesia |
| Dashboard monitoring kiosk terpusat | Rendah | Untuk melihat usage, error rate, dan performa dari kantor nagari pusat |

---

## Lampiran — Kamus IPC Events

| Event | Arah | Payload | Keterangan |
|---|---|---|---|
| `camera:personDetected` | Renderer → Main | `{ confidence: float }` | Ada orang terdeteksi di depan kiosk |
| `voice:startListening` | Main → Renderer | — | Aktifkan mic + VAD |
| `voice:audioChunk` | Renderer → Main | `ArrayBuffer` (webm/opus) | Chunk audio 250ms |
| `voice:transcript` | Main → Renderer | `{ text: string }` | Hasil final STT |
| `voice:interim` | Main → Renderer | `{ text: string }` | Hasil sementara STT (untuk animasi UI) |
| `voice:synthesize` | Main → Renderer | `{ text: string }` | Minta TTS untuk teks tertentu |
| `voice:response` | Main → Renderer | `{ text, audioBase64, phase, slots }` | Respons lengkap dari AI |
| `session:update` | Main → Renderer | `{ phase, slots, current_slot }` | Update state untuk UI |
| `session:done` | Main → Renderer | `{ kode_resi, surat_id }` | Sesi selesai, tampilkan resi |
| `voice:error` | Main → Renderer | `{ code, message }` | Error untuk ditampilkan di UI |

---

*Dokumen ini dihasilkan dari sesi RnD ANM Voice AI — Versi 1.0*
*Terakhir diperbarui: 2024*