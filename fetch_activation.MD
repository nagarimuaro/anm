# API Reference — ANM Device

Base URL: `https://sintanagari.cloud/api`

---

## 1. Aktivasi Device

```
POST /device/activate
```

**Headers:**
```
Content-Type: application/json
Accept: application/json
```

**Body:**
```json
{
  "activation_token": "token-64-karakter-dari-admin",
  "device_name": "ANM Kantor Nagari Muaro",
  "fingerprint": "machine-id-unik"
}
```

| Field | Wajib | Keterangan |
|-------|-------|------------|
| `activation_token` | ✅ Wajib | Token dari admin, 64 karakter |
| `device_name` | ✅ Wajib | Nama device |
| `fingerprint` | Opsional | ID unik mesin, kalau dikirim dan sudah ada → return token lama |

**Response 200:**
```json
{
  "success": true,
  "message": "Device berhasil diaktivasi.",
  "data": {
    "device_token": "aB3cD4eF5gH6iJ7kL8mN...",
    "device_id": 1,
    "tenant_domain": "https://muaro.sintanagari.cloud",
    "tenant_name": "Nagari Muaro Paiti"
  }
}
```

Simpan `device_token` ke `device.json`. Token ini permanen, tidak expired.

**Error:**

| HTTP | Message |
|------|---------|
| 404 | Token aktivasi tidak ditemukan |
| 422 | Token sudah mencapai batas device |
| 422 | Validasi gagal (field kurang) |

---

## 2. Heartbeat

```
POST /device/heartbeat
```

**Headers:**
```
Content-Type: application/json
Accept: application/json
X-Device-Key: {device_token dari device.json}
```

**Body (semua opsional):**
```json
{
  "cpu": "ok",
  "printer": "ok",
  "rfid": "error",
  "webcam": "ok"
}
```

**Response 200:**
```json
{
  "success": true,
  "message": "Heartbeat received.",
  "data": {
    "status": "ok",
    "device_id": 1,
    "device_name": "ANM Kantor Nagari Muaro",
    "last_seen_at": "2026-04-11T18:30:00.000000Z"
  }
}
```

Kirim setiap 60 detik supaya status online di dashboard admin.

---

## 3. Request API Lainnya

Semua endpoint selanjutnya (surat, bansos, absensi, dll) pakai header ini:

```
X-Device-Key: {device_token dari device.json}
Accept: application/json
```

Backend otomatis tahu ini device milik tenant mana. Tidak perlu kirim tenant ID.

---

## Error Auth (berlaku semua endpoint pakai X-Device-Key)

| HTTP | Artinya | Yang harus dilakukan |
|------|---------|----------------------|
| 401 | Token tidak valid / device dihapus | Hapus `device.json`, tampilkan halaman aktivasi ulang |
| 403 | Device di-revoke admin | Hapus `device.json`, tampilkan halaman aktivasi ulang |

---

## device.json

Simpan response aktivasi ke file `device.json`:

```json
{
  "device_token": "aB3cD4eF5gH6iJ7kL8mN...",
  "device_id": 1,
  "tenant_domain": "https://muaro.sintanagari.cloud",
  "tenant_name": "Nagari Muaro Paiti"
}
```

---

## Test cURL

```bash
# Aktivasi
curl -X POST https://sintanagari.cloud/api/device/activate \
  -H "Content-Type: application/json" \
  -d '{"activation_token":"TOKEN_DISINI","device_name":"ANM Test"}'

# Heartbeat
curl -X POST https://sintanagari.cloud/api/device/heartbeat \
  -H "Content-Type: application/json" \
  -H "X-Device-Key: DEVICE_TOKEN_DISINI" \
  -d '{"cpu":"ok","printer":"ok"}'
```
