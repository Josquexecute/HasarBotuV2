# HasarBotu V2 — API Sözleşme Planı

Tarih: 2026-07-11
Durum: Kaynak ve sözleşme planı; OpenAPI veya çalışan endpoint değildir

## 1. Sözleşme ilkeleri

- Base path: `/api/v1`.
- JSON alanları teknik sözleşmede İngilizce `camelCase`; UI Türkçe etiketleri değiştirilmez.
- Kimlikler dışarıda tahmin edilemez UUID/ULID biçiminde temsil edilir; veritabanı seçimi ayrı karardır.
- Zaman anları ISO-8601 UTC (`2026-07-11T07:30:00Z`); yalnız iş günü/tarih alanları `YYYY-MM-DD`.
- Liste cevapları `{ items, pageInfo }`; cursor pagination yüksek hacimli history/audit için, offset küçük referans listeleri için değerlendirilebilir.
- Her cevap `requestId`; mutable resource cevapları `version`, `createdAt`, `updatedAt` içerir.
- Yazma istekleri şema doğrulamasından, authentication, permission ve domain kontrolünden geçer.
- Optimistic concurrency için `If-Match: "<version>"` veya request body `expectedVersion` tek yöntem olarak seçilip standardize edilir.
- Tekrar edilebilir kritik `POST` işlemlerinde `Idempotency-Key` zorunludur.
- Hatalar kullanıcı metnine bağlanmaz; stabil `code`, güvenli `message`, `fieldErrors`, `requestId` döner.
- Dosya byte'ı ve uzun AI işlemleri ana JSON transaction'ına gömülmez; intent/job sözleşmesi kullanılır.

Örnek hata:

```json
{
  "error": {
    "code": "CONCURRENCY_CONFLICT",
    "message": "Kayıt başka bir işlem tarafından güncellendi.",
    "fieldErrors": [],
    "requestId": "req_01..."
  }
}
```

Standart HTTP eşlemesi:

- `400 VALIDATION_ERROR`
- `401 AUTHENTICATION_REQUIRED` / `SESSION_EXPIRED`
- `403 PERMISSION_DENIED`
- `404 RESOURCE_NOT_FOUND`
- `409 CONCURRENCY_CONFLICT`, `DUPLICATE_RESOURCE`, `IDEMPOTENCY_CONFLICT`
- `422 DOMAIN_RULE_VIOLATION`
- `429 RATE_LIMITED` veya `AI_BUDGET_EXCEEDED`
- `503 DEPENDENCY_UNAVAILABLE` / `STORAGE_UNAVAILABLE`

## 2. Yetki ve audit sözlüğü

Planlanan permission isimleri kaynak/eylem biçimindedir: `cases.read`, `cases.write`, `cases.close`, `documents.write`, `fees.approve`, `legislation.activate`, `admin.users`, `audit.read`.

Audit seviyeleri:

- **A0:** Salt-okunur, özel audit gerekmez; güvenlik erişim log'u yeterli.
- **A1:** İş verisi değişikliği; actor, resource, before/after güvenli özeti zorunlu.
- **A2:** Kritik işlem; A1 + gerekçe, onay, idempotency key, kaynak belge/job ve doğrulama sonucu zorunlu.

## 3. Kaynak sözleşmeleri

### 3.0 Durum Panosu

- **Amaç ve endpoint:** `GET /api/v1/dashboard`; oturumlu kullanıcının organization kapsamındaki açık vakalarını tek salt-okunur operasyon snapshot’ında döndürür.
- **Cevap:** `asOfDate`, `evaluatedAt`, `priorityVersion`, özet sayaçları, açık workflow stage sayaçları ve vaka öğeleri. Her öğe güvenli vaka kimliği/metadata’sı, takip tarihi, evrak eksik/kontrol sayıları, insan onayı türleri, operasyon recovery/hata sayıları, öncelik ve açık attention kodlarını taşır.
- **Evrak sınırı:** Paket 15 motorunun aktif kural sürümü kullanılır; response her vaka için `documentRuleVersion` taşır. Belge içeriği, hash, raw excerpt veya path dönmez.
- **Yetki/tenant:** Oturum zorunlu; bütün alt sorgular organizationId ile sınırlandırılır. Yabancı tenant kaydı snapshot’a giremez.
- **Audit/idempotency:** A0 salt-okunur; snapshot/audit yazısı ve Idempotency-Key yoktur.
- **Hatalar:** `401 AUTHENTICATION_REQUIRED`; dependency/aktif evrak kuralı bulunmaması güvenli 5xx sınırından döner. UI API modunda mock fallback yapmaz.
- **Sürüm:** `priorityVersion=dashboard-priority/1.1.0`; response takip sinyallerine ek olarak açık/geciken/bugün/yaklaşan görev sayaçlarını taşır ve strict runtime Zod + deterministik JSON Schema fixture ile doğrulanır.

### 3.1 Authentication / session

- **Amaç ve endpoint:** `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/session/refresh`; kimlik ve aktif session yönetimi.
- **Örnek istek:** `{ "username": "ofis-kullanici", "password": "<client-only>" }`.
- **Örnek cevap:** `{ "user": { "id": "usr_...", "displayName": "..." }, "permissions": ["cases.read"], "expiresAt": "..." }`; password/token geri dönmez.
- **Hatalar:** `INVALID_CREDENTIALS`, `ACCOUNT_DISABLED`, `SESSION_EXPIRED`, `RATE_LIMITED`.
- **Yetki:** Login anonim; diğerleri mevcut session.
- **Audit:** Başarılı/başarısız giriş güvenli security event; parola ve session secret loglanmaz.
- **Idempotency:** Login için yok; logout tekrar çağrılabilir ve idempotent.
- **Concurrency/version:** Session revoke/refresh atomik; user version değişince yetki cache'i geçersizleşir.

### 3.2 Users

- **Amaç ve endpoint:** `GET/POST /users`, `GET/PATCH /users/{userId}`, `POST /users/{userId}/disable`.
- **Örnek istek:** `{ "displayName": "Anonim Kullanıcı", "username": "a.kullanici", "roleIds": ["role_..."] }`.
- **Örnek cevap:** `{ "id": "usr_...", "displayName": "...", "status": "ACTIVE", "version": 1 }`.
- **Hatalar:** `USERNAME_EXISTS`, `USER_NOT_FOUND`, `LAST_ADMIN_PROTECTED`, standard auth/concurrency.
- **Yetki:** `admin.users`; başlangıçta herkes dosyaları görebilse de kullanıcı yönetimi admin sınırındadır.
- **Audit:** A1; rol/status değişimi before/after.
- **Idempotency:** Create için zorunlu; disable doğal idempotent.
- **Concurrency/version:** PATCH/disable `version` zorunlu.

### 3.3 Roles / permissions

- **Amaç ve endpoint:** `GET/POST /roles`, `PATCH /roles/{roleId}`, `PUT /roles/{roleId}/permissions`.
- **Örnek istek:** `{ "name": "Sorumlu", "permissions": ["cases.read", "cases.write"] }`.
- **Örnek cevap:** `{ "id": "role_...", "name": "Sorumlu", "permissions": [...], "version": 2 }`.
- **Hatalar:** `ROLE_NAME_EXISTS`, `UNKNOWN_PERMISSION`, `ROLE_IN_USE`, concurrency.
- **Yetki:** `admin.roles`.
- **Audit:** A2; yetki genişletme/daraltma ve gerekçe.
- **Idempotency:** Create zorunlu; permission PUT aynı içerikte idempotent.
- **Concurrency/version:** Role version/If-Match zorunlu.

### 3.4 Cases

- **Amaç ve endpoint:** `GET /cases`, `POST /cases`, `GET/PATCH /cases/{caseId}`, `POST /cases/{caseId}/close-preview`, `/close`, `/reopen-preview`, `/reopen`.
- **Örnek istek:** `{ "type": "Trafik", "noticeNumber": "F-2026-0987", "plate": "06ABC123", "assigneeId": "usr_..." }`; update `{ "expectedVersion": 4, "followUpDate": "2026-07-14" }`.
- **Örnek cevap:** `{ "id": "case_...", "officeNumber": "2026/183", "type": "Trafik", "status": "Açık", "stage": "Hasar Tespiti", "version": 5 }`.
- **Hatalar:** `CASE_TYPE_INVALID`, `OFFICE_NUMBER_CONFLICT`, `POSSIBLE_DUPLICATE`, `CLOSE_PREVIEW_REQUIRED`, `CLOSE_REASON_REQUIRED`, concurrency/storage.
- **Yetki:** Read `cases.read`; write `cases.write`; close/reopen `cases.close`.
- **Audit:** Create/update A1; close/reopen A2 ve File Agent doğrulaması.
- **Idempotency:** Create/close/reopen zorunlu; PATCH idempotency yerine version ile korunur.
- **Concurrency/version:** Tüm mutable case komutlarında zorunlu.
- **Paket 18 somutlaştırması:** Create/update/read DTO'ları nullable `expertUserId`, `lossDate`, `notificationDate` taşır; tarih alanları `YYYY-MM-DD` LocalDate'tir. Eksper aynı tenantta aktif ve `expert` rolünde olmalıdır; pasif/uygunsuz referans alan bazlı reddedilir.

### 3.4.1 Case referans katalogları

- **Endpoint:** `GET /api/v1/references/insurers`, `/services`, `/users`, `/experts`.
- **Kapsam:** Oturum organization'ı ve yalnız aktif kayıtlar; experts gerçek users/roles birleşimidir. Yönetim CRUD'u yoktur.
- **Cevap:** `{ "items": [...] }`; yalnız kimlik + güvenli görünen ad, servis için `centerType`. E-posta, rol hash'i, parola veya secret dönmez.
- **Hata/audit:** Oturumsuz 401; salt-okunur katalog çağrısı özel audit üretmez. API modunda mock fallback yoktur.

### 3.5 Case status history

- **Amaç ve endpoint:** `GET /cases/{caseId}/status-history`, `POST /cases/{caseId}/status-transitions`.
- **Örnek istek:** `{ "from": "Hasar Tespiti", "to": "Parça ve İşçilik", "reason": "Tespit tamamlandı", "expectedVersion": 5 }`.
- **Örnek cevap:** `{ "transitionId": "csh_...", "caseVersion": 6, "changedAt": "..." }`.
- **Hatalar:** `STATUS_TRANSITION_INVALID`, `REASON_REQUIRED`, case not found/concurrency.
- **Yetki:** `cases.write`; bazı kritik geçişler özel permission isteyebilir.
- **Audit:** A1; kapanışa bağlı geçiş A2.
- **Idempotency:** POST zorunlu.
- **Concurrency/version:** Case version zorunlu; history append-only.

### 3.6 Case Operations — Paket 37

- **Read:** `GET /api/v1/cases/:caseId/operations`; notlar, görevler, takip geçmişi, `asOfDate` ve rol/lifecycle yazma izinlerini tek tenant-kapsamlı cevapta döndürür.
- **Not create:** `POST /api/v1/cases/:caseId/notes`; `{ noteType: internal|contact, subject?, body }`; zorunlu Idempotency-Key. Not update/delete endpoint’i yoktur.
- **Görev create:** `POST /api/v1/cases/:caseId/tasks`; `{ title, priority, assignedUserId?, dueDate }`; dueDate LocalDate ve Idempotency-Key zorunludur.
- **Görev sonu:** `POST .../tasks/:taskId/complete` `{ expectedVersion, resultNote }`; `POST .../cancel` `{ expectedVersion, reason }`. Her ikisi Idempotency-Key kullanır.
- **Hata/yetki:** 401 oturumsuz, 403 yazma rolü yok, tenant-dışı case/task 404, stale/terminal/kapalı case 409, geçersiz veya pasif/tenant-dışı assignee alan bazlı 400.
- **Audit:** A1; içerik audit’e kopyalanmaz. API modunda mock fallback yoktur.

### 3.8 Documents

- **Amaç ve endpoint:** `GET /cases/{caseId}/documents`, `POST /cases/{caseId}/documents/intents`, `POST /documents/{id}/versions`, `GET /documents/{id}/open-intent`, `POST /documents/{id}/quarantine`.
- **Örnek istek:** `{ "documentType": "M_RUHSAT", "fileName": "ruhsat.pdf", "size": 12345, "sha256": "..." }`.
- **Örnek cevap:** `{ "documentId": "doc_...", "jobId": "job_...", "status": "PENDING", "relativePath": null, "version": 1 }`.
- **Hatalar:** `DOCUMENT_TYPE_INVALID`, `FILE_NAME_UNSAFE`, `HASH_MISMATCH`, `STORAGE_UNAVAILABLE`, `DOCUMENT_RULE_VIOLATION`.
- **Yetki:** `documents.read/write`; quarantine/delete `documents.manage`.
- **Audit:** Upload A1; quarantine/replace A2.
- **Idempotency:** Intent/version/quarantine zorunlu.
- **Concurrency/version:** Document metadata version; byte durumu File Agent job sonucu ile transactionally kesinleşir.

### 3.9 Photos

- **Amaç ve endpoint:** `GET /cases/{caseId}/photos`, `POST /cases/{caseId}/photos/intents`, `PATCH /photos/{photoId}`, `POST /photos/{photoId}/quarantine`.
- **Örnek istek:** `{ "category": "HASAR", "fileName": "hasar_001.jpg", "sha256": "...", "capturedAt": "..." }`.
- **Örnek cevap:** `{ "id": "photo_...", "thumbnailStatus": "PENDING", "status": "PENDING", "version": 1 }`.
- **Hatalar:** `PHOTO_CATEGORY_INVALID`, `MEDIA_TYPE_INVALID`, hash/storage errors.
- **Yetki:** `photos.read/write`; quarantine özel permission.
- **Audit:** A1; quarantine A2.
- **Idempotency:** Upload intent zorunlu; hash duplicate sonucu mevcut kayda referans verebilir.
- **Concurrency/version:** Metadata update version; thumbnail ayrı idempotent job.

### 3.10 Labor and parts

- **Amaç ve endpoint:** `GET/POST /cases/{caseId}/parts`, `PATCH /parts/{id}`, `GET/POST /cases/{caseId}/labor-items`, `PATCH /labor-items/{id}`, `POST /cases/{caseId}/repair-scope/finalize`.
- **Örnek istek:** `{ "code": "PRC-001", "description": "Ön panel", "quantity": 1, "amount": 12500, "expectedVersion": 1 }`.
- **Örnek cevap:** `{ "id": "part_...", "status": "DRAFT", "version": 2 }`.
- **Hatalar:** `AMOUNT_INVALID`, `REPAIR_SCOPE_ALREADY_FINAL`, `FINALIZE_CONFIRMATION_REQUIRED`, concurrency.
- **Yetki:** `repair.read/write`; finalize `repair.approve`.
- **Audit:** Kalem A1; finalize A2.
- **Idempotency:** Create/finalize zorunlu.
- **Concurrency/version:** Her kalem ve aggregate repair-scope version.

### 3.11 Value loss

- **Amaç ve endpoint:** `GET /cases/{caseId}/value-loss`, `POST /cases/{caseId}/value-loss/assessments`, `POST /value-loss/{id}/calculate`, `/approve`.
- **Örnek istek:** `{ "ruleVersionId": "rpa_1_0", "vehicleData": {...}, "expectedVersion": 3 }`.
- **Örnek cevap:** `{ "id": "vla_...", "status": "VERI_EKSIK", "ruleVersion": "RPA 1.0", "missing": ["PARTS_FINAL"], "version": 4 }`.
- **Hatalar:** `VALUE_LOSS_NOT_READY`, `RULE_VERSION_REQUIRED`, `KASKO_OPTIONAL_NOT_OPENED`, `APPROVAL_REQUIRED`.
- **Yetki:** `valueLoss.read/write`; approve `valueLoss.approve`.
- **Audit:** Taslak A1; hesap/approve A2, kaynak ve rule version sabit.
- **Idempotency:** Calculate/approve zorunlu.
- **Concurrency/version:** Assessment ve case version kontrolü.

### 3.12 Heavy damage

- **Amaç ve endpoint:** `GET /cases/{caseId}/heavy-damage`, `POST /cases/{caseId}/heavy-damage/assessments`, `PATCH /heavy-damage/{id}/expert-opinion`, `POST /heavy-damage/{id}/insurer-decision`.
- **Örnek istek:** `{ "expertOpinion": "INCELEMEDE", "reason": "Şasi ölçümü bekleniyor", "expectedVersion": 2 }`.
- **Örnek cevap:** `{ "aiSuggestion": "PERT_ADAYI_DEGIL", "expertOpinion": "INCELEMEDE", "insurerDecision": null, "version": 3 }`.
- **Hatalar:** `HEAVY_DAMAGE_STATE_INVALID`, `EVIDENCE_REQUIRED`, `DECISION_CONFIRMATION_REQUIRED`.
- **Yetki:** `heavyDamage.read/write`; insurer decision `heavyDamage.decision`.
- **Audit:** AI öneri A1 metadata; eksper/merkez kararı A2 ve ayrı alanlar.
- **Idempotency:** Assessment/decision zorunlu.
- **Concurrency/version:** Assessment version zorunlu.

### 3.13 Emails

- **Amaç ve endpoint:** `GET /cases/{caseId}/emails`, `POST /cases/{caseId}/email-drafts`, `POST /emails/{id}/match`, `POST /emails/{id}/compose-intent`.
- **Örnek istek:** `{ "to": ["ornek@invalid.local"], "subject": "Dosya hakkında", "body": "Mock taslak", "attachmentDocumentIds": [] }`.
- **Örnek cevap:** `{ "id": "email_...", "status": "DRAFT", "composeUrl": "https://mail.google.com/...", "version": 1 }`.
- **Hatalar:** `RECIPIENT_INVALID`, `ATTACHMENT_NOT_READY`, `MATCH_CONFIRMATION_REQUIRED`, `GMAIL_UNAVAILABLE`.
- **Yetki:** `emails.read/write`; compose kullanıcı onayı ister.
- **Audit:** Draft A1; match/compose intent A1; otomatik gönderim yok.
- **Idempotency:** Draft/match/compose intent zorunlu.
- **Concurrency/version:** Draft/match version; harici gönderim sonucu kesin kaynak sayılmaz.

### 3.14 Notifications

- **Amaç ve endpoint:** `GET /notifications`, `PATCH /notifications/{id}`, `POST /notifications/mark-all-read`, internal rule-trigger endpoint yalnız servis içi.
- **Örnek istek:** `{ "read": true, "expectedVersion": 1 }`.
- **Örnek cevap:** `{ "id": "ntf_...", "read": true, "caseId": "case_...", "version": 2 }`.
- **Hatalar:** `NOTIFICATION_NOT_FOUND`, concurrency.
- **Yetki:** Kullanıcı yalnız kendi/kapsamındaki bildirimleri görür; internal üretim servis kimliği ister.
- **Audit:** Okundu durumu A0/A1 düşük önem; kural üretimi kaynak event ile izlenir.
- **Idempotency:** Mark-all ve read update doğal idempotent.
- **Concurrency/version:** Tekil PATCH version; toplu işlem server transaction.

### 3.15 Legislation sources

- **Amaç ve endpoint:** `GET/POST /legislation-sources`, `GET/PATCH /legislation-sources/{id}`, `POST /legislation-sources/{id}/versions`, `/activate-version`, `POST /legislation/answer`.
- **Örnek istek:** `{ "sourceId": "src_...", "publishedAt": "2026-06-20", "effectiveFrom": "2026-07-01", "documentId": "doc_..." }`.
- **Örnek cevap:** `{ "versionId": "legv_...", "status": "DRAFT", "versionLabel": "RPA 1.0", "version": 1 }`.
- **Hatalar:** `EFFECTIVE_RANGE_OVERLAP`, `SOURCE_NOT_VERIFIED`, `ACTIVATION_CONFIRMATION_REQUIRED`, AI dependency errors.
- **Yetki:** Read genel yetki; create/version `legislation.manage`; activate `legislation.activate`.
- **Audit:** Version A1; activate A2 ve gerekçe/kaynak hash.
- **Idempotency:** Version/activate/answer job zorunlu.
- **Concurrency/version:** Source/version optimistic locking; aktif sürüm immutable.

### 3.16 Reports

- **Amaç ve endpoint:** `GET /reports/case-summary`, `/reports/operations`, `POST /reports/exports`, `GET /reports/exports/{jobId}`.
- **Örnek istek:** `{ "period": { "from": "2026-07-01", "to": "2026-07-31" }, "assigneeId": null, "format": "XLSX" }`.
- **Örnek cevap:** `{ "jobId": "report_...", "status": "PENDING", "snapshotAt": "..." }`.
- **Hatalar:** `REPORT_RANGE_INVALID`, `EXPORT_FORMAT_INVALID`, `REPORT_TOO_LARGE`, dependency unavailable.
- **Yetki:** `reports.read/export`; sorgu kullanıcı kapsamıyla filtrelenir.
- **Audit:** Okuma A0; export A1 (filtre, format, kullanıcı; satır verisi loglanmaz).
- **Idempotency:** Export zorunlu.
- **Concurrency/version:** Snapshot timestamp kullanılır; aggregate resource version gerekmez.

### 3.17 Fees

- **Amaç ve endpoint:** `GET /fees`, `GET /cases/{caseId}/fee`, `POST /cases/{caseId}/fee/extract`, `POST /fees/{id}/approve`, `/correct`.
- **Örnek istek:** `{ "sourceDocumentVersionId": "docv_...", "expectedVersion": 2, "reason": "Nihai rapor" }`.
- **Örnek cevap:** `{ "id": "fee_...", "status": "KONTROL_BEKLIYOR", "candidateAmount": 4850, "sourcePage": 12, "version": 3 }`.
- **Hatalar:** `FINAL_REPORT_REQUIRED`, `AMOUNT_NOT_FOUND`, `MULTIPLE_CANDIDATES`, `APPROVAL_CONFIRMATION_REQUIRED`.
- **Yetki:** `fees.read`; extract `fees.write`; approve/correct `fees.approve`.
- **Audit:** Extract A1; approve/correct A2, önceki/sonraki tutar ve gerekçe.
- **Idempotency:** Extract/approve/correct zorunlu.
- **Concurrency/version:** Fee record version ve source document version immutable referansı.

### 3.18 Audit events

- **Amaç ve endpoint:** `GET /audit-events`, `GET /audit-events/{eventId}`; uygulama kullanıcıları için create endpoint yoktur.
- **Örnek istek:** Query `?caseId=case_...&action=CASE_CLOSED&cursor=...`.
- **Örnek cevap:** `{ "items": [{ "id": "aud_...", "actorId": "usr_...", "action": "CASE_CLOSED", "occurredAt": "..." }], "pageInfo": {...} }`.
- **Hatalar:** `AUDIT_SCOPE_INVALID`, permission/validation.
- **Yetki:** `audit.read`; hassas before/after alanları ek permission ve maskeleme ister.
- **Audit:** Audit okuması ayrıca security access log'a yazılır; event append-only.
- **Idempotency:** Dış create yok; internal event key benzersiz olabilir.
- **Concurrency/version:** Immutable; cursor + occurredAt/id sırası.

### 3.19 Application settings

- **Amaç ve endpoint:** `GET /settings`, `GET/PATCH /settings/{key}`, `GET/PUT /device-profiles/{deviceId}`.
- **Örnek istek:** `{ "value": { "defaultPage": "dashboard" }, "expectedVersion": 3 }`.
- **Örnek cevap:** `{ "key": "ui.defaultPage", "scope": "USER", "value": {...}, "version": 4 }`.
- **Hatalar:** `SETTING_KEY_UNKNOWN`, `SETTING_SCOPE_INVALID`, `SECRET_SETTING_FORBIDDEN`, concurrency.
- **Yetki:** Kullanıcı kendi UI ayarı; firm/system setting `settings.manage`; storage root yalnız yetkili cihaz konfigürasyonu.
- **Audit:** Kullanıcı UI tercihi A0/A1; system/storage/security ayarı A2.
- **Idempotency:** PUT doğal idempotent; PATCH version ile.
- **Concurrency/version:** Setting version zorunlu; secret değer API cevabında dönmez.

## 4. Sözleşme test stratejisi

- Her request/response şeması geçerli ve geçersiz fixture ile test edilir.
- API handler, mock adapter ve HTTP client aynı contracts paketini tüketir.
- Error code ve HTTP status mapping snapshot/contract testine alınır.
- `Trafik | Kasko` dışında case type contract seviyesinde reddedilir.
- Tüm kritik POST endpoint'ler aynı idempotency key ile tekrar çağrı testine sahiptir.
- Mutable kaynaklarda stale version ile `409` testi zorunludur.
- Permission matrix allow/deny testleri resource bazında bulunur.
- Dosya endpoint'leri gerçek storage yerine temp sandbox/fake File Agent ile test edilir.

## 5. Kesinleşmeden önce karar gerekenler

Framework, validation şema kütüphanesi, ID biçimi, version taşıma yöntemi (`If-Match` veya body), pagination standardı ve authentication yöntemi `INFRASTRUCTURE_BLUEPRINT.md` açık karar kataloğunda çözülmeden tam OpenAPI üretilmez.

## 6. Paket 03 somutlaştırması (2026-07-11)

Paket 03, bu planın bir alt kümesini `@hasarbotu/contracts` (Zod 4) paketinde çalışan, runtime doğrulanan sözleşmelere dönüştürdü. Bu turda alınan somut kararlar (bkz. `DECISION_LOG.md` HB-2026-004):

- **Validation kütüphanesi:** Zod 4 (`zod@4.4.3`). Wire DTO kaynağı Zod şemalarıdır; tipler `z.infer` ile türetilir. JSON Schema, Zod 4 yerleşik `z.toJSONSchema` ile üretilir; ek OpenAPI bağımlılığı yoktur.
- **Hata modeli:** Bu paketteki kararlı hata kodları küçük-harf `snake_case` olarak somutlaştı: `validation_error`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `version_conflict`, `idempotency_conflict`, `service_unavailable`, `internal_error`. §1'deki UPPER_SNAKE taslak adları bu kararlı kodlarla eşlenir. Hata nesnesi ham girdi taşımaz.
- **Pagination:** Sayfa tabanlı somutlaştırma: `page` (varsayılan 1), `pageSize` (varsayılan 25, maksimum 100) ve liste yanıtında `{ items, pageInfo }`. §1'deki cursor/offset seçimi yüksek hacimli history/audit uçlarında ayrıca değerlendirilecektir.
- **Sürüm ve route:** `/api/v1` tabanı; `/health` sürümlü tabanın dışındadır ve `status` (`ok`/`degraded`), `service`, `version`, `checkedAt` alanlarını taşır. Bu turda yalnız read-only `GET /api/v1/cases` ve `GET /api/v1/cases/:caseId` sözleşmeleri kuruldu; §3.4'teki yazma/kapatma uçları Paket 05+ kapsamındadır.
- **Paket düzeni ve zarf:** Sözleşmeler `src/common` + `src/health` + sürümlü `src/v1/cases` altında toplandı. Başarı zarfı `ok: true`, `data` ve opsiyonel `meta`; hata zarfı `ok: false`, `error`. §1'deki `requestId` opsiyonel `meta`/`error` alanında taşınır.
- **Kapsam dışı:** Çalışan HTTP sunucusu, authentication, `version` taşıma yönteminin seçimi (`If-Match` veya body), idempotency uygulaması ve tam OpenAPI üretimi bu pakette yapılmadı; açık kararlar korunur.

## 7. Proje çapında sertleştirme güncellemesi (2026-07-11, HB-2026-005)

- **Takip tarihi:** `followUpDate` yalnız `LocalDate` (`YYYY-MM-DD`) taşır; `followUpAt` kaldırıldı. Query `followUpFrom`/`followUpTo` LocalDate'tir; karşılaştırma leksikografiktir, timezone dönüşümü yoktur.
- **Değer sınırları:** kimlikler 1..128 güvenli ASCII (yol karakterleri ve `..` reddi); referans numaraları max 128 (kontrol/backslash reddi, slash geçerli); plaka max 32; `page` 1..10.000; `pageSize` 1..100; `search` max 120.
- **Hata raporu:** `unrecognized_keys` reddedilen alan ADLARINI (değer değil) en çok 10 adet, temizlenmiş olarak taşır.
- **JSON Schema:** ifade edilebilir kurallar şemaya taşındı; runtime-only kurallar `x-hasarbotu-runtime-validation` ile işaretli; golden fixture regresyonu `packages/contracts/test/fixtures/json-schema` altındadır. JSON Schema tek başına güvenlik sınırı değildir.
- **Sürüm:** `zod` tam `4.4.3` pinlidir.

## 8. Paket 04 tüketimi (2026-07-12, HB-2026-006)

`@hasarbotu/api` (Fastify `5.10.0`, Node 24) bu sözleşmelerin ilk gerçek HTTP tüketicisidir: `GET /health` yanıtı gönderilmeden önce health şemasıyla parse edilir; bilinmeyen route/method 404 `not_found` ve beklenmeyen hatalar 500 `internal_error` failure envelope'larıyla döner (`requestId` gerçek Fastify request ID'sidir). Cases endpoint'leri, auth, `version` taşıma yöntemi ve OpenAPI hâlâ açık karar/ileri paket kapsamındadır; ayrıntı `API_RUNTIME_FOUNDATION.md`.

## 9. Kasko poliçe analizi sözleşme planı (Paket 04.5, yalnız planlama)

Gelecek poliçe analiz uçları için sözleşme ilkeleri (endpoint/şema henüz üretilmez):

- Kaynaklar `policy_documents`/`policy_versions`/`policy_extractions`/`policy_scenario_rules`/`policy_conflicts`/`policy_ai_assessments`/`policy_human_approvals` kavramlarını izler (`CASCO_POLICY_CANONICAL_MODEL.md`).
- Kapsam değerlendirme yanıtları beş durumlu `coverageOutcome` (`teminat_kapsaminda` / `sartli_kapsamda` / `kapsam_disi` / `bilgi_yetersiz` / `kaynaklar_celiskili`) + kaynak referansı + güven + `requiresHumanApproval` taşır; belirsiz durumlar sessizce çözülmez.
- AI kasko cevabı dokuz bölümlü standardı izler (Sonuç ve kapsam durumu; Gerekçe; Muafiyet/tenzil/maliyet paylaşımı/limit; Servis-parça şartı; İşlem ve gerekli belgeler; Kaynak belge/sayfa/başlık/kloz; Çelişki/eksik; Güven; İnsan onayı gereksinimi); hüküm yoksa "Poliçede bu konuda açık ve doğrulanabilir bir hüküm bulunamadı.".
- Çelişki kayıtları ayrı kaynak olarak sunulur; çözüm yalnız kullanıcı onaylı komutla (A2 audit) yapılır.
- Operasyonu bağlayan sonuçlar (muafiyet uygulama, maliyet paylaşımı, kapsam dışı, tedarik/mobil onarım durdurması ve kaldırılması) insan onayı olmadan kesinleşmez.

## 10. Paket 19 çalışma klasörü sözleşmeleri

- `POST /api/v1/cases/:caseId/workspace-plans`: oturum + tenant + zorunlu `Idempotency-Key`; `{storageRootKey}` ile filesystem’e yazmadan plan/preview üretir.
- `GET /api/v1/cases/:caseId/workspace-plans` mevcut vaka planını; `GET /api/v1/cases/:caseId/workspace-plans/:planId` belirli planı ve güncel işlem durumunu okur. Kayıt yok veya yabancı tenant 404’tür.
- `POST /api/v1/cases/:caseId/workspace-plans/:planId/approve`: `{approved:true}` + zorunlu `Idempotency-Key`; açık onaydan sonra tek provisioning job kuyruğa alır.
- Durumlar: `planned`, `approved`, `queued`, `applying`, `verifying`, `ready`, `failed`, `cancelled`, `stale`.
- Yanıt yalnız `storageRootKey`, güvenli `relativePath`, sabit alt klasör isimleri, durum ve güvenli hata kodu taşır. Mutlak yol, OS hatası, secret veya dosya içeriği sözleşmede yoktur.
- Agent job payload’ına `workspace` türü ve sabit beş alt klasör; heartbeat’e opsiyonel `applying|verifying` progress alanı eklenmiştir. Runtime Zod ve deterministik JSON Schema fixture’ları birlikte güncellenir.

## 11. Paket 22 servis referans ve Case profil sözleşmeleri

- `GET /api/v1/references/services`, opsiyonel `insurerId`, `evaluationDate` LocalDate, `dateSource` ve kontrollü `operation` query alanlarını strict doğrular. Endpoint yalnız oturumdaki tenant'ın aktif servislerini döndürür.
- Servis DTO'su `serviceType`, `isActive` ve sürümlü agreement evaluation içerir. `isAuthorized` ile `isInsurerAgreed` ayrı alanlardır; belirsiz anlaşma boolean'a zorlanmaz ve `null + control_required` taşır.
- Case list/detail/create/update cevapları seçilmiş pasif tarihsel ilişkiyi okuyabilmek için nullable güvenli `serviceProfile` taşır; yeni atama yine aktif tenant referansı gerektirir.
- Kaynak referansı, iletişim bilgisi, mutlak path, secret ve ham hata response şemasında yoktur. Zod runtime ve 38 deterministik JSON Schema fixture aynı kabul kümesini taşır.

## 12. Paket 23 Kasko poliçe analiz contracts/API

- Uçlar: case-kapsamlı analysis create/list/detail/version list+create, approve/reject, conflict list/resolve ve scenario evaluate. Bütün POST'larda zorunlu `Idempotency-Key`; bütün uçlarda oturum+tenant sınırı vardır.
- Create/version payload yalnız kontrollü adapter/manual import içindir; source key'ler aynı payload'daki sayfa/madde/excerpt referanslarına bağlanır. Server excerpt'i normalize edip hash'i kendisi üretir ve hazır/doğrulanmış case documentVersion bağını tekrar doğrular.
- Yönetici/eksper version+approve/reject+conflict çözebilir; dosya sorumlusu import/evaluate yapabilir fakat approve edemez. Diğer roller yalnız izinli read görür.
- Runtime Zod ve 45 golden JSON Schema aynı strict kabul kümesini taşır. LocalDate ve UTC datetime ayrımı korunur; mutlak yol, binary, tam poliçe metni, secret ve ham hata response'ta yoktur.

## 13. Paket 24 PDF metin çıkarım contracts/API

- Uçlar: documentVersion-kapsamlı extraction create/list; case-kapsamlı detail/pages/segments/cancel/source-reference. Create/cancel/source-reference zorunlu `Idempotency-Key`; bütün uçlar oturum+tenant, yazılar admin/expert/case_manager rol sınırındadır.
- Agent protokolü mevcut claim/heartbeat/result akışına `extract_pdf_text`, `document_text_extraction` hedefi ve en çok dört bounded sayfalı chunk endpoint’i ekler. Payload yalnız logical root key/relative path, declared hash/size, exact parser/normalizasyon ve limitleri taşır.
- DTO extraction/page/segment durumlarını, `pdfjs-dist 6.1.200`, `pdf-text-normalization/1.0.0`, `unicode_code_point`, sayaç/hash ve güvenli failure code alanlarını strict doğrular.
- Paket 23 source reference opsiyonel extraction/page/segment/start/end locator taşır. Eski kontrollü manuel referanslar `null` locator ile backward-compatible kalır; server exact excerpt’i kendisi üretir.
- Runtime Zod ve 52 golden JSON Schema semantik olarak eşittir. Mutlak path, PDF binary, parser stack, secret ve ham OS hatası response kabul kümesinde yoktur.

## 14. Paket 25 yerel OCR contracts/API

- DocumentVersion-kapsamlı create/list ve case-kapsamlı run detail/pages/elements/cancel/retry/source-reference uçları oturum+tenant kapsamlıdır. Yazılar `admin|expert|case_manager` ve zorunlu `Idempotency-Key` kullanır; read izinli vaka oturumuna açıktır.
- Create `textExtractionId`, `tur|eng|tur+eng`, `standard|high_quality` ve opsiyonel bounded sayfaları strict doğrular. Server document/extraction/page/source identity’sini yeniden üretir; client path/hash/status beyanına güvenmez.
- Run DTO 14 aşamalı status/progress, exact engine/language/render/preprocess/normalizer/locator, counts/hash ve safe failure code taşır. List cevap tam OCR metni taşımaz; pages/elements pagination maksimum 100’dür.
- Page DTO ayrı bounded raw/normalized OCR, confidence/quality/reading/composite, low-confidence/unreadable sayaç, render metadata ve süre taşır. Element DTO block/line/word, `sourceLayer=ocr`, code-point range ve render-pixel box taşır.
- OCR locator server’ın exact range/element box’ından üretilir; engine/language/locator/quality/reading metadata’sını içerir. Client excerpt/hash/box göndermez. Runtime Zod ve 60 golden JSON Schema aynı kabul kümesidir.
- Mutlak path/root/temp, PDF/image/model binary, secret, worker command/stdout/stderr, stack ve ham OS hata sözleşmede yoktur.

## 15. Paket 26 policy AI contracts/API

- Tenant/oturum korumalı uçlar: `POST .../policy-ai-extractions/plan`, `POST .../:runId/start`, run list/detail/candidates, güvenli cancel ve yetkili `/api/v1/ai/usage`.
- Plan provider çağrısı yapmaz; kaynak, kalite warning’i, input boyutu, tahmini integer maliyet ve provider/bütçe durumunu döndürür.
- Start zorunlu `Idempotency-Key`, `expectedVersion` ve `expectedSourceBundleHash` kullanır. Exact replay ikinci run veya provider çağrısı oluşturmaz.
- Provider output schema strict’tir; unknown alan, enum dışı değer, non-finite sayı, bounded olmayan içerik, duplicate candidate ve geçersiz anchor reddedilir.
- Cevap yalnız bounded excerpt ve güvenli source metadata taşır; full prompt/output, binary, mutlak yol, secret ve belge dump’ı içermez.

## 16. Paket 27 candidate review ve promotion contracts/API

- `POST /api/v1/cases/:caseId/policy-ai-extractions/:runId/candidates/:candidateId/review`: `expectedReviewVersion` ve `accepted | edited | rejected | control_required`; düzenleme değer/koşul/istisna taşır, red/kontrol gerekçe zorlar.
- `GET /api/v1/cases/:caseId/policy-ai-extractions/:runId/promotion-preview`: güncel review-set hash, karar sayıları, blockers/warnings ve hedef Paket 23 analysis/version bilgisini döndürür; yazma yapmaz.
- `POST /api/v1/cases/:caseId/policy-ai-extractions/:runId/promote`: zorunlu Idempotency-Key, açık `confirmed`, expected run/review-set/analysis version ile yeni Paket 23 taslak sürümü üretir.
- Candidate listesi son append-only review’ı taşır. Paket 23 detail cevabı promote edilen generic AI fact provenance’ını ve source reference kimliklerini gösterir.
- Tenant dışı kaynak/aday/hedef 404; rol reddi 403; stale review/promotion 409; response içinde full prompt/output, poliçe metni, binary, secret veya mutlak yol yoktur.

## 17. Paket 28 gerçek provider ve privacy contracts/API

- Provider enum’u `openai-responses` ile genişler. Plan cevabındaki `privacy`; external provider, redaction policy/version, outbound character sayısı, redacted kategori/sayı, retention ve pricing sürümünü güvenli özet olarak taşır.
- Start endpoint’i değişmez: zorunlu Idempotency-Key, expected run version ve sourceBundleHash kullanır. Server start anında privacy snapshot’ı yeniden üretir; uyuşmazlık stale/fail-closed olur.
- Usage cevabı input/output token sayaçlarını ve pricing version’ı taşır; para safe integer minor-unit’tir. Secret, Authorization header, full request/response veya kaynak metni hiçbir contract’ta yoktur.
- Provider disabled/budget blocked çağrı üretmez. External provider hataları yalnız kanonik güvenli hata kodlarına çevrilir; HTTP body, stack ve provider secret response’a taşınmaz.

## 18. Paket 29 Gemini pilot ve recovery contracts/API

- Provider enum’u `gemini-generate-content` ile; privacy retention enum’u `free_tier_product_improvement` ile genişler. Bu değer ücretsiz katmanda sentetik içeriğin ürün geliştirmede kullanılabileceğini açıkça belirtir.
- Runtime Zod ve deterministik JSON Schema fixture’ları aynı kabul kümesini taşır. Gemini strict structured output şeması ortak provider şemasını kullanır; son otorite yine runtime contract/evidence doğrulamasıdır.
- API start sözleşmesi değişmez. Durable receipt ve finalize recovery server içidir; client full prompt/provider response, secret veya recovery payload’ı alamaz.
- HTTP 503 server içinde `AI_PROVIDER_UNAVAILABLE` güvenli koduna eşlenir ve bounded retry ayrıntısı response contract'ını genişletmez. Sentetik canlı pilot runner'ı kullanılan gerçek model ile model-bazlı deneme sayılarını yalnız yerel doğrulama raporunda gösterir; auth/kota/schema/evidence hatasında model fallback yapmaz.
- Structured-output wire payload provider içidir ve bütün GenerateContent modellerinde `responseMimeType/responseJsonSchema` kullanır; `responseFormat` veya model-bazlı ayrım yoktur. Başarılı pilot tek wire probe kullanır; 400 sonrası bounded tanı ve güvenli timeout aşaması public/API response veya kalıcı contract alanı değildir, yalnız test ve yerel sentetik pilot teşhisidir.
- Gemini wire schema `normalizedValueJson` ile temel type/properties/required/items alt kümesini kullanır; bu provider-private alan public DTO değildir. Adapter parse sonrası `normalizedValue` üretir ve mevcut runtime Zod/JSON Schema kabul kümesi değişmez; enum/bound/evidence veya parse hatası aday olarak başarılı gösterilmez.
- Wire schema sadeleştirmesi public/canonical contract bilgisini kaldırmaz. Adapter request'teki exact output schema version ve maximum candidate sınırı ile domain category/biçim kurallarını trusted provider instruction'a taşır; provider cevabı bu kurallara uymuyorsa API DTO'suna veya receipt'e canonical başarı olarak giremez.
- Gemini REST response içindeki thought/signature metadata public DTO değildir. Adapter yalnız bounded non-thought text part'larını birleştirir; finish reason veya JSON parse hatası API contract'ını genişletmeden mevcut kanonik provider failure sınırında kalır.
- Paket 28 OpenAI production adapter’ı korunur. Gemini ücretsiz-katman çağrısı yalnız açık opt-in sentetik pilot komutunda çalışır; UI retention uyarısını gösterir ve API kesintisinde mock fallback yapmaz.

## 19. Paket 30 dosya detayı orchestration kullanımı

- Paket 30 yeni endpoint veya DTO eklemez. Mevcut Paket 24/25 read, Paket 26 plan/start/list, Paket 27 review/promotion ve Paket 23 analysis read sözleşmeleri aynı case bağlamında sıralı kullanılır.
- Plan request yalnız kullanıcının seçtiği `PolicyAiSourceSelection` kayıtlarını taşır; server eligibility ve tenant doğrulaması değişmeden son otoritedir.
- Promotion response içindeki `analysisId` ve `analysisVersion`, başarılı write sonrasında Paket 23 list/detail read’ini yenilemek için kullanılır. İstemci bu kimliklerden analiz içeriği uydurmaz.
- UI orchestration ikinci bir write, otomatik approval veya yeni audit olayı üretmez. 401/403/404/409/5xx ve network hatalarında mevcut güvenli hata eşlemesi ve no-fallback davranışı korunur.

## 20. Paket 31 provider availability contracts/API

- `GET /api/v1/ai/providers` oturum gerektiren, organization kapsamlı ve salt-okunur bir durum endpoint’idir. Provider çağrısı, policy değişikliği veya audit yazısı üretmez.
- Response; provider/model/version, external flag, retention/pricing sürümü, maksimum input, `configured`, organization policy özeti, current-month cost, `providerAllowed`, `callReady` ve kanonik unavailable reason taşır.
- `callReady`, yalnız server provider kaydı, organization enabled ve provider allow-list birlikte sağlandığında true olabilir. Bütçe hard stop ve kullanıcı onayı mevcut plan/start sözleşmelerinde ayrıca uygulanır.
- Secret, environment değişkeni, API key biçimi, header, endpoint override, full prompt/output veya kaynak metni response şemasında bulunmaz.
- Runtime Zod ve deterministik JSON Schema fixture aynı kabul kümesidir. API modunda istemci bilinmeyen/bozuk availability cevabını mock veriyle maskelemez.

## 21. Paket 32 Trafik değer kaybı contracts/API

- `GET /api/v1/cases/:caseId/traffic-value-loss`: current assessment/version, girdi snapshot’ı, kanıt/emsal, belirsizlikler, rule sources ve approval durumu.
- `GET /api/v1/cases/:caseId/traffic-value-loss/versions`: immutable version geçmişi.
- `POST .../traffic-value-loss/versions`: zorunlu Idempotency-Key ve `expectedVersion`; sonuç/uncertainty client’tan alınmaz, server domain evaluator ile üretilir.
- `POST .../versions/:versionId/submit|approve|reject`: optimistic version ve rol kapısı; approve yalnız submit edilmiş ve blocker içermeyen sürümde çalışır, reject gerekçe zorlar.
- Kasko case veya başka tenant kaynak 400/404; stale 409; oturumsuz 401; yetkisiz rol 403.
- Response mutlak path, filename, belge içeriği, kişisel veri, secret veya ham DB/OS hatası taşımaz.

## 22. Paket 33 Trafik değer kaybı UI adapter sınırı

- Paket 33 yeni server endpoint’i veya JSON Schema eklemez; Paket 32 current/version/create/submit/approve/reject contract’larını tüketir.
- UI adapter response envelope’ını runtime’da status, rule version, minor-unit sonuç, uncertainty, evidence, comparable ve approval alanları yönünden fail-closed doğrular.
- `GET current` 404, daha önce tenant-kapsamlı Case detail başarıyla okunduğu çalışma alanında “henüz assessment yok” başlangıcına çevrilir. Tenant izolasyonu ve Case 404 otoritesi dış Case read kapısında kalır.
- Create/submit/approve/reject komutları güvenli `Idempotency-Key`, cookie oturumu ve güncel optimistic assessment version taşır.
- Document metadata adapter’ı verified document evidence için `contentHash` değerini DataPort’a ekler. Değer UI’da render edilmez; yalnız Paket 32 source-hash komutuna gider.
- 401/403/400/404/409/5xx/ağ hataları güvenli UI sınıflarına map edilir; response body, SQL, stack, secret, mutlak yol veya belge içeriği gösterilmez ve mock fallback yapılmaz.

## 23. Paket 34 Trafik değer kaybı nihai rapor contracts/API

- `POST .../versions/:versionId/report-preview`: salt-okunur; `expectedAssessmentVersion` ve bounded nullable `reportNote` alır, canonical content, `previewHash` ve UTC `previewedAt` döndürür.
- `POST .../versions/:versionId/reports`: zorunlu Idempotency-Key, `confirmed=true`, aynı note, expected assessment version ve preview hash ile tek immutable PDF rapor kaydı üretir.
- `GET .../traffic-value-loss/reports`, `GET .../reports/:reportId`: tenant-kapsamlı immutable rapor metadata/content read’idir.
- `GET .../reports/:reportId/pdf`: doğrulanmış `application/pdf`, güvenli ASCII filename, `private,no-store` ve `nosniff` header’larıyla binary çıktı verir.
- Preview onaysız source, stale version veya uyuşmayan digest için 409; tenant dışı kaynak/rapor 404; oturumsuz 401; üretim rolü yetersizse 403 döner.
- JSON contracts source/emsal/hesap/belirsizlik/rule/approval içeriğini strict doğrular. Mutlak path, storage root, belge filename/içeriği, secret veya ham hata alanı yoktur.

## 24. Paket 39 kapanma ücreti ve dönem raporu contracts/API

- `GET /api/v1/cases/:caseId/fee`: current append-only sürüm geçmişi ve rol/lifecycle kaynaklı izinleri döndürür; ücret yoksa `fee:null`.
- `POST /api/v1/cases/:caseId/fee/candidates`: zorunlu Idempotency-Key, expected case version, safe integer minor tutar, doğrulanmış final-report documentVersion ve kaynak sayfa ister.
- `POST /api/v1/fees/:feeId/approve`: expected fee version ve `confirmed=true`; yalnız `control_required` güncel sürümü yeni `approved` sürüme taşır.
- `POST /api/v1/fees/:feeId/correct`: expected fee version, yeni minor tutar, doğrulanmış kaynak/sayfa, bounded güvenli gerekçe ve `confirmed=true`; yeni `corrected` sürüm oluşturur.
- `GET /api/v1/fees`: tenant-kapsamlı kapalı case ücret listesidir. `GET /api/v1/reports/case-summary?period=YYYY-MM` dönem özeti, filtre seçenekleri ve kontrol bekleyen adayları döndürür.
- Oturumsuz 401, yetkisiz komut 403, tenant dışı case/fee 404, stale/state/idempotency conflict 409 olur. Runtime Zod ve JSON Schema kabul kümeleri aynıdır.
- Response; mutlak path, belge içeriği, düzeltme gerekçesinin audit kopyası, SQL/stack, secret veya ham hata içermez. API modunda istemci mock fallback yapmaz.

## 25. Paket 40 değer kaybı kapanış özeti contracts/API

- `GET /api/v1/traffic-value-loss/closure-summaries`: oturum ve organization kapsamlı kapalı case listesini; kapanış modu/gerekçesi ile `present | control_required | not_applicable` değer kaybı özetini döndürür.
- Özet; closure rule version, assessment/version/status, human approval, calculation rule/result/minor-unit amount ve final report kimliği/zamanını nullable ve strict alanlarla taşır.
- Case lifecycle operation response’undaki requirement item `module` source type’ını ve backward-compatible nullable `valueLossSummary` alanını destekler.
- `GET /api/v1/reports/case-summary` summary alanı; kapanmış case’ler için approved/reported value-loss count/total, control-required Traffic count ve not-applicable Kasko count taşır.
- Salt-okunur çağrılar audit veya snapshot yazmaz. 401 ve tenant izolasyonu mevcut merkezi guard’ları kullanır; response mutlak path, belge/emsal içeriği, secret veya ham hata taşımaz.

## 26. Paket 41 e-posta taslağı contracts/API

- `GET /api/v1/cases/:caseId/email-drafts`: tenant-kapsamlı draft/version/handoff geçmişi ve role/lifecycle izinlerini döndürür.
- `POST .../email-drafts/preview`: strict draft type ve bounded instruction alır; yazmasız template, requirement kodları, verified attachment seçenekleri, preview hash ve `requiresHumanReview=true` döndürür.
- `POST .../email-drafts`: zorunlu Idempotency-Key, expected case version, preview hash, normalize recipient’lar, kullanıcı subject/body düzenlemesi, verified attachment referansları ve `confirmed=true` ister.
- `POST .../email-drafts/:draftId/versions`: expected draft version, recipient/subject/body/attachment snapshot’ı, bounded zorunlu gerekçe ve `confirmed=true` ile append-only yeni sürüm üretir.
- `POST .../email-drafts/:draftId/handoffs`: expected draft version ve `confirmed=true` ile Gmail web compose payload’ı hazırlar. Response `deliveryStatus=not_sent`; provider message/sent/delivered alanı yoktur.
- Preview GET/POST’u audit veya snapshot yazmaz. Create/revise/handoff 401/403/404/409, idempotency ve optimistic locking sınırlarını kullanır.
- Response mutlak path, storage root, file content, OAuth token, provider secret, session, SQL/stack veya ham hata taşımaz. API modunda istemci mock fallback yapmaz.

## 27. Paket 42 AI e-posta önerisi contracts/API

- `POST /api/v1/cases/:caseId/email-ai-suggestions/plan`: provider çağrısı yapmadan Paket 41 base preview, plan hash, privacy/redaction, retention, budget ve provider availability özeti döndürür.
- `POST /api/v1/cases/:caseId/email-ai-suggestions`: zorunlu Idempotency-Key, expected case version, preview hash, plan hash ve `confirmed=true` ile bounded provider çağrısını başlatır.
- `GET /api/v1/cases/:caseId/email-ai-suggestions` ve `GET .../:runId`: case erişimli kullanıcılara safe run/suggestion geçmişi verir; plan/start yalnız `admin | expert | case_manager`.
- Run durumları `provider_disabled | budget_blocked | running | review_required | failed | outcome_unknown`; öneri yalnız `review_required` iken bulunur ve daima `requiresHumanReview=true` taşır.
- Response recipient, attachment, full prompt/output, PII, secret, path, binary, provider raw error veya sent/delivered semantiği taşımaz. Runtime Zod ve JSON Schema kabul kümeleri aynıdır.
