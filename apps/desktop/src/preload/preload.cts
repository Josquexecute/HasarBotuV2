import { contextBridge } from 'electron'

/**
 * Preload allowlist (D2).
 *
 * KASITLI OLARAK AYRICALIKSIZDIR. Renderer'a açılan yüzey yalnız iki VERİ
 * alanı içerir; hiçbir fonksiyon, hiçbir IPC kanalı ve `ipcRenderer`'ın
 * kendisi AÇILMAZ. Main tarafında da kayıtlı `ipcMain` handler'ı yoktur.
 *
 * Gerekçe: UI, verisini bugün olduğu gibi göreli `/api/...` üzerinden alır
 * (HB-2026-103 aynı-origin köprüsü). Kabuğa bir çağrı yüzeyi eklemek, ince
 * kabuk kuralını (ADR-Q06) ve Paket 21'in geri alma stratejisini zayıflatır.
 * Yeni bir kanal ancak açık bir karar ve gerekçe ile eklenir.
 *
 * `sandbox: true` olduğu için bu dosya CommonJS olmalıdır; kaynak `.cts`
 * yazılır ve `.cjs` olarak derlenir.
 */

const surface = Object.freeze({
  /** UI, masaüstü kabuğunda çalıştığını bu bayrakla ayırt edebilir. */
  isDesktopShell: true,
  /** Yalnız bilgi amaçlı; OS kimliği dışında hiçbir ayrıntı taşımaz. */
  platform: process.platform,
})

contextBridge.exposeInMainWorld('hasarbotuDesktop', surface)
