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
- **Örnek istek:** `{ "type": "Trafik", "noticeNumber": "F-2026-0987", "plate": "06ABC123", "assigneeId": "usr_..." }`; update `{ "expectedVersion": 4, "followUpAt": "..." }`.
- **Örnek cevap:** `{ "id": "case_...", "officeNumber": "2026/183", "type": "Trafik", "status": "Açık", "stage": "Hasar Tespiti", "version": 5 }`.
- **Hatalar:** `CASE_TYPE_INVALID`, `OFFICE_NUMBER_CONFLICT`, `POSSIBLE_DUPLICATE`, `CLOSE_PREVIEW_REQUIRED`, `CLOSE_REASON_REQUIRED`, concurrency/storage.
- **Yetki:** Read `cases.read`; write `cases.write`; close/reopen `cases.close`.
- **Audit:** Create/update A1; close/reopen A2 ve File Agent doğrulaması.
- **Idempotency:** Create/close/reopen zorunlu; PATCH idempotency yerine version ile korunur.
- **Concurrency/version:** Tüm mutable case komutlarında zorunlu.

### 3.5 Case status history

- **Amaç ve endpoint:** `GET /cases/{caseId}/status-history`, `POST /cases/{caseId}/status-transitions`.
- **Örnek istek:** `{ "from": "Hasar Tespiti", "to": "Parça ve İşçilik", "reason": "Tespit tamamlandı", "expectedVersion": 5 }`.
- **Örnek cevap:** `{ "transitionId": "csh_...", "caseVersion": 6, "changedAt": "..." }`.
- **Hatalar:** `STATUS_TRANSITION_INVALID`, `REASON_REQUIRED`, case not found/concurrency.
- **Yetki:** `cases.write`; bazı kritik geçişler özel permission isteyebilir.
- **Audit:** A1; kapanışa bağlı geçiş A2.
- **Idempotency:** POST zorunlu.
- **Concurrency/version:** Case version zorunlu; history append-only.

### 3.6 Notes

- **Amaç ve endpoint:** `GET/POST /cases/{caseId}/notes`, `PATCH /notes/{noteId}`, `POST /notes/{noteId}/delete` (mantıksal).
- **Örnek istek:** `{ "type": "Servis Görüşmesi", "content": "Anonim görüşme notu", "expectedVersion": 2 }`.
- **Örnek cevap:** `{ "id": "note_...", "status": "ACTIVE", "revision": 1, "version": 1 }`.
- **Hatalar:** `NOTE_TYPE_INVALID`, `NOTE_IMMUTABLE_REVISION`, validation/concurrency.
- **Yetki:** `notes.read`, `notes.write`; vaka erişimi ayrıca kontrol edilir.
- **Audit:** A1; fiziksel silme yok, revision/status kaydı.
- **Idempotency:** Create zorunlu; update version ile.
- **Concurrency/version:** Note version ve case last-intervention transaction'ı.

### 3.7 Tasks

- **Amaç ve endpoint:** `GET/POST /cases/{caseId}/tasks`, `PATCH /tasks/{taskId}`, `POST /tasks/{taskId}/complete`.
- **Örnek istek:** `{ "title": "Servis dönüşünü kontrol et", "dueAt": "...", "assigneeId": "usr_...", "expectedVersion": 1 }`.
- **Örnek cevap:** `{ "id": "task_...", "status": "BEKLIYOR", "dueAt": "...", "version": 2 }`.
- **Hatalar:** `TASK_STATUS_INVALID`, `RESULT_NOTE_REQUIRED`, `NON_WORKDAY_WARNING`, concurrency.
- **Yetki:** `tasks.read/write`; assignee değiştirme ayrı permission olabilir.
- **Audit:** A1; tamamla/iptal sonucu dahil.
- **Idempotency:** Create/complete zorunlu.
- **Concurrency/version:** Task version zorunlu.

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
