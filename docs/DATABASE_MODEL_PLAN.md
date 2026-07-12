# HasarBotu V2 — PostgreSQL Veri Modeli Planı

Tarih: 2026-07-11
Durum: Kavramsal/mantıksal plan; migration veya SQL değildir

## 1. Model ilkeleri

- PostgreSQL iş verisinin kaynak doğruluğudur; dosya byte'ı saklanmaz.
- Tüm vaka ilişkileri `case_id` kullanır; plaka benzersiz anahtar değildir.
- `firm_id` ilk firmada da korunur; firma/yıl bazlı ofis numarası sıralaması desteklenir.
- Dış kimlikler UUID/ULID adayıdır; kesin seçim açık karardır.
- Mutable aggregate kayıtlarında integer `version` optimistic locking için zorunludur.
- Standart audit kolonları: `created_at`, `created_by`, `updated_at`, `updated_by`, `version`; gerekliyse `deleted_at`, `deleted_by`.
- Zaman anları `timestamptz` ve UTC; UI `Europe/Istanbul` gösterir. Sadece hasar tarihi/yürürlük gibi gün anlamlı alanlar `date` olur.
- Para `numeric(14,2)` + ISO currency; float kullanılmaz.
- İş durumları kontrolsüz metin yerine check/lookup/sürüm kontrollü enum stratejisiyle tutulur; PostgreSQL enum kullanımı migration kararıdır.
- Fiziksel silme varsayılan değildir. Append-only history/audit/version tabloları silinmez.
- Saklama süresi hukuki/operasyonel politika kesinleşene kadar otomatik purge yoktur; tablolar retention sınıfı taşır.

## 2. Kavramsal ilişki

```text
organizations ─┬─ users ─ user_roles ─ roles
               └─ cases ─┬─ case_parties
                         ├─ case_vehicles
                         ├─ case_status_history
                         ├─ notes / tasks / notifications
                         ├─ documents ─ document_versions ─ photos(metadata)
                         ├─ parts / labor_items
                         ├─ value_loss_assessments
                         ├─ heavy_damage_assessments
                         ├─ email_case_matches ─ email_messages
                         └─ fee_records

legislation_sources ─ legislation_versions
audit_events → tüm aggregate/resource kimlikleri
application_settings → firm/user/device scope
schema_migrations → uygulanan şema sürümleri
```

## 3. Zorunlu tablo matrisi

Her satır amaç, temel kolonlar, PK/FK, unique/index, soft delete, audit, hassasiyet ve saklama politikasını birlikte belirtir.

| Tablo | Amaç ve temel kolonlar | PK / FK | Unique ve indeks | Soft delete / audit | Hassasiyet ve saklama |
| --- | --- | --- | --- | --- | --- |
| `users` | Kullanıcı kimliği; `firm_id`, `username`, `display_name`, `password_hash`, `status`, `last_login_at`, `version` | PK `id`; FK `firm_id` | Unique `(firm_id, normalized_username)`; status/login indeksleri | Disable + `deleted_at`; standart audit, password değişimi A2 | Yüksek; hash asla audit/log'a girmez; hesap geçmişi politika süresince korunur |
| `roles` | Rol tanımı; `firm_id`, `name`, `description`, `version` | PK `id`; FK firm | Unique `(firm_id,name)`; aktif indeks | Kullanımdaysa fiziksel silme yok; standart audit | Orta; rol/permission tarihi uzun süre korunur |
| `user_roles` | Çoktan çoğa rol ataması; `user_id`, `role_id`, `assigned_at/by` | Bileşik PK veya `id`; iki FK | Unique `(user_id,role_id)`; role/user indeks | Atama kaldırma tarihçeli/append audit | Orta; erişim kanıtı olarak purge yok, politika belirler |
| `cases` | Vaka aggregate; `firm_id`, `office_year`, `office_sequence`, `office_number`, `type`, `status`, `stage`, `notice_number`, `claim_number`, `plate_normalized`, `assignee_id`, `expert_id`, `service_center_id`, `follow_up_date`, `last_intervention_at`, `closed_at`, `version` | PK `id`; FK firm/users/service | Unique `(firm_id,office_year,office_sequence)` ve `(firm_id,office_number)`; plate, notice, claim, status/stage, assignee, follow-up indeks | `deleted_at` yalnız yanlış oluşturma/karantina; close delete değildir; tüm değişiklik audit | Yüksek; hukuki/operasyonel saklama kararı olmadan purge yok |
| `case_parties` | Sigortalı, mağdur, karşı taraf, şirket rolü; `case_id`, `party_type`, ad/iletişim alanları | PK `id`; FK case | `(case_id,party_type)` indeks; gereğine göre role sıra unique | Soft delete + audit | Çok yüksek kişisel veri; maskeli erişim, retention case ile bağlı |
| `case_vehicles` | Vaka aracı/karşı araç; `case_id`, `role`, `plate`, `plate_normalized`, marka/model/yıl/VIN opsiyonel | PK `id`; FK case | `(case_id,role)`; plate index, plate **unique değil** | Soft delete + audit | Yüksek; case retention'ına bağlı |
| `case_status_history` | Durum/aşama değişim kanıtı; `case_id`, `from/to_status`, `from/to_stage`, `reason`, `changed_at/by`, `source_event_id` | PK `id`; FK case/user/audit | `(case_id,changed_at desc)`; source event unique opsiyonel | Append-only; fiziksel silme yok | Orta; case ile en az aynı süre |
| `notes` | Sürümlü notlar; `case_id`, `type`, `content`, `status`, `revision`, `supersedes_note_id`, `version` | PK `id`; FK case/user/self | `(case_id,created_at desc)`; `(id,revision)` unique modeline göre | Fiziksel silme yok; Düzenlendi/Silindi state ve audit | Yüksek; içerik maskeli, case retention'ına bağlı |
| `tasks` | Görev/takip; `case_id`, `title`, `type`, `assignee_id`, `status`, `due_at`, `completed_at`, `result_note`, `version` | PK `id`; FK case/user | Assignee/status/due indeks; geciken partial index | Cancel/soft delete; tüm status değişimi audit | Orta-yüksek; case retention'ına bağlı |
| `documents` | Mantıksal belge; `case_id`, `document_type`, `status`, `current_version_id`, `required_rule_version_id`, `version` | PK `id`; FK case/current document_version | `(case_id,document_type,status)` indeks; active logical slot unique gereğine göre | Quarantine/soft delete; replace/quarantine A2 | Yüksek; byte yok, metadata case retention'ına bağlı |
| `document_versions` | Değişmez fiziksel sürüm metadata'sı; `document_id`, `relative_path`, `original_name`, `safe_name`, `media_type`, `size_bytes`, `sha256`, `storage_root_key`, `created_by_job_id` | PK `id`; FK document/job | Unique `(storage_root_key,relative_path)`; hash/size index; `(document_id,created_at)` | Append-only; quarantine state ayrı; audit job ile | Yüksek; path göreli, cihaz yolu yok; belge retention'ına bağlı |
| `photos` | Fotoğraf metadata'sı; `case_id`, `document_version_id` veya bağımsız relative path, `category`, `captured_at`, `thumbnail_relative_path`, `sha256`, `status`, `version` | PK `id`; FK case/document_version | Case/category/captured indeks; hash index | Quarantine/soft delete + audit | Yüksek; case retention; thumbnail yeniden üretilebilir |
| `parts` | Parça kalemleri; `case_id`, `code`, `description`, `quantity`, `unit_amount`, `total_amount`, `operation`, `status`, `version` | PK `id`; FK case | `(case_id,status)`; code index | Taslakta soft delete; finalized sürüm değişmez/audit | Orta; finansal kayıt case retention'ına bağlı |
| `labor_items` | İşçilik kalemleri; `case_id`, `category`, `description`, `hours`, `amount`, `ai_suggestion_id`, `status`, `version` | PK `id`; FK case/audit-AI result adayı | `(case_id,status/category)` | Taslak soft delete; finalize A2 audit | Orta; case retention |
| `value_loss_assessments` | Değer Kaybı sürümlü değerlendirme; `case_id`, `rule_version_id`, `status`, input snapshot, output, confidence, approved_at/by, `version` | PK `id`; FK case/user/legislation or rule version | `(case_id,created_at desc)`; tek aktif draft partial unique | Append sürüm; onaylı kayıt immutable; A2 audit | Yüksek/finansal; rule/input/output case retention'ına bağlı |
| `heavy_damage_assessments` | AI önerisi, eksper kanaati ve sigorta kararı; rayiç/oran/evidence, `version` | PK `id`; FK case/users/doc versions | `(case_id,created_at desc)`; aktif değerlendirme partial unique | Sürümlü/append; karar A2 | Yüksek/finansal; case retention |
| `email_messages` | E-posta taslak/metadata; provider message ID opsiyonel, subject/body, sender/recipient masked fields, status, `version` | PK `id`; FK firm/user | Provider ID unique nullable; sent/received date index | Soft delete değil archive; body edit revision/audit | Çok yüksek; içerik erişimi sınırlı, retention hukuki karar ister |
| `email_case_matches` | E-posta-vaka eşleştirme adayı/onayı; `email_id`, `case_id`, `confidence`, `reason`, `status`, `confirmed_by/at`, `version` | PK `id`; FK email/case/user | Unique active `(email_id,case_id)`; status index | Rejected/removed tarihçeli; audit | Yüksek; email/case retention'ına bağlı |
| `notifications` | Kullanıcı/rol bildirimi; `firm_id`, `user_id`, `case_id`, `type`, title/detail güvenli özet, `read_at`, `source_event_id`, `version` | PK `id`; FK firm/user/case/audit | `(user_id,read_at,created_at desc)`; source/type index | Süresi dolma/archive; audit düşük seviye | Orta; hassas detay minimize; configurable kısa/orta retention |
| `legislation_sources` | Kaynak kimliği; title/type/publisher, status, `version` | PK `id`; FK firm opsiyonel | Kaynak external ref unique; type/status index | Soft retire; audit | Düşük-orta; kalıcı katalog |
| `legislation_versions` | Kaynak sürümü; `source_id`, version label, publish/effective range, `document_version_id`, checksum, verification/activation state | PK `id`; FK source/document/user | Unique `(source_id,version_label)`; effective range index; overlap kontrolü | Append-only; aktive sürüm immutable; activation A2 | Orta; kalıcı sürüm ve kaynak kanıtı |
| `fee_records` | Kapanma ücreti adayı/onayı; `case_id`, `source_document_version_id`, candidate/approved amount, status, source page, confidence, corrected_reason, approved_by/at, `version` | PK `id`; FK case/document/user | `(case_id,created_at desc)`; tek current record partial unique | Sürümlü; approve/correct A2, silme yok | Yüksek/finansal; case ve muhasebe retention'ına bağlı |
| `audit_events` | Değişmez kim/ne/ne zaman kaydı; `firm_id`, actor/session, action, resource_type/id, case_id, occurred_at, request_id, idempotency_key, reason, safe_before/after, result | PK `id`; FK actor/case opsiyonel, gevşek resource ref | `(case_id,occurred_at)`, actor/time, action/time, request ID; idempotency event unique adayı | Append-only, update/delete uygulama rolüne yasak | Yüksek; PII maskeli, güvenlik retention kararı gerekir |
| `application_settings` | Firm/user/device scope typed ayar; `scope_type/id`, `key`, JSON value, `is_secret=false`, `version` | PK `id`; scope FK mantıksal | Unique `(scope_type,scope_id,key)`; key index | Soft retire + audit; secret değer yasak | Düşük/orta; aktif + değişiklik geçmişi |
| `schema_migrations` | Uygulanan migration kimliği, checksum, applied_at/by, duration, result | PK migration id | ID ve checksum unique | Append-only; uygulama yazmaz | Düşük; kalıcı operasyon kaydı |

## 4. Destekleyici tabloların değerlendirilmesi

Zorunlu listedeki ilişkileri güvenli kurmak için aşağıdakiler adaydır; kesin şemaya eklenmeleri karar kapısı ister.

| Tablo | Gerekçe | Kritik kurallar |
| --- | --- | --- |
| `organizations` / `firms` | `firm_id` ve ofis numarası kapsamı | Firma silinmez; slug/code unique; ayar/retention scope |
| `permissions`, `role_permissions` | RBAC izin kataloğu | Permission code immutable; değişiklik A2 audit |
| `sessions` | Server-side session önerisi | Token hash, expiry, revoke; raw secret yok |
| `service_centers` | Servis ad/telefon/tür ve tarihçe | Firma içinde normalized name unique adayı; soft delete |
| `storage_roots` | Root key/purpose; mutlak yol yalnız yetkili local config yaklaşımı | DB'ye client mutlak yolu yazmama kararı korunur; server root secret/secure config olabilir |
| `file_agent_jobs` | PostgreSQL queue/idempotency/recovery | Unique idempotency key; lease/attempt/status/next_attempt; append results |
| `idempotency_keys` | HTTP komut tekrar koruması | Scope+key unique; request hash/response ref; sınırlı retention |
| `rule_versions` | Evrak/onay/eşik gibi sürümlü domain kuralları | Activated version immutable; effective range; A2 activation |

### 4.1 Kasko poliçe analizi kavramları (Paket 04.5; gelecekte değerlendirilecek)

Kasko poliçesinin uçtan uca işlenmesi için aşağıdaki kavramlar adaydır (`CASCO_POLICY_CANONICAL_MODEL.md`). SQL/migration üretilmemiştir; normalizasyon derinliği Paket 05+ karar kapısıdır.

| Kavram | Sorumluluk | Kritik kurallar |
| --- | --- | --- |
| `policy_documents` | Dosyaya bağlı poliçe belgesi (referans, hash, şirket, poliçe no) | Belge byte'ı DB'de değil; hash zorunlu |
| `policy_versions` | Zeyil/yeniden basım sürümleri, yürürlük aralıkları | Sürümler immutable; hasar tarihi yürürlük kontrolü |
| `policy_extractions` | Çıkarım turları (yöntem, tarih, güven, durum) | Eski çıkarım silinmez; yeniden analiz yeni tur |
| `policy_canonical_fields` | Kanonik alan değerleri + `sourceLabel` (orijinal alan adı) | Kaynak referanssız kanonik değer kabul edilmez |
| `policy_clauses` | Orijinal kloz başlık + tam metin + sayfa aralığı | Orijinal metin hiçbir normalizasyonda silinmez |
| `policy_coverages` | Teminat kalemleri (kanonik anahtar + şirket adı) | `belirsiz` durumu ayrı değerdir |
| `policy_limits` | Teminat başına limitler (tutar/oran; olay/yıl) | Para birimi açık |
| `policy_deductibles` | Genel + koşullu muafiyet/tenziller | "Muafiyetsiz" genel alan koşullu kayıtları engellemez |
| `policy_exclusions` | İstisna/teminat dışı haller | Genel şart / özel kloz kaynağı ayrımı |
| `policy_scenario_rules` | Olay-bazlı kurallar (`CASCO_POLICY_SCENARIO_RULES.md`) | Sürümlü; insan onayı alanı zorunlu |
| `policy_source_references` | Kanonik alan/kural ↔ belge/sayfa/kloz izlenebilirlik bağı | Her çıkarımda zorunlu |
| `policy_conflicts` | Poliçe ↔ ihbar föyü ↔ diğer belge çelişkileri | Sessiz otomatik çözüm yok; kullanıcı kararı + audit |
| `policy_ai_assessments` | AI kapsam/muafiyet değerlendirmeleri | Kaynaksız cevap kaydedilmez; "açık hüküm bulunamadı" ayrı sonuçtur |
| `policy_human_approvals` | Operasyonu bağlayan sonuçların insan onayı | Onaysız çıkarım operasyonu bağlamaz; A2 audit |

## 5. Kritik domain kuralları

### 5.1 Trafik/Kasko kısıtı

- Contract ve domain katmanına ek olarak database check/lookup constraint yalnız `Trafik`, `Kasko` değerlerini kabul eder.
- Değer Kaybı ayrı case type değildir.

### 5.2 Ofis numarası

- Transaction içinde firma/yıl bazlı sequence tahsisi yapılır.
- `office_number` görünüm değeri `YYYY/N`; kaynak kolonlar `office_year`, `office_sequence` olur.
- Unique `(firm_id, office_year, office_sequence)` yarış koşulunu DB düzeyinde engeller.

### 5.3 Plaka ve harici numaralar

- `plate_normalized` arama için indekslidir, unique değildir.
- `notice_number` ve `claim_number` firma kapsamında indekslenir; unique zorunluluğu sigorta/iş kuralı doğrulanmadan konmaz.
- Mükerrer kontrol plaka, tarih, şirket, ihbar/hasar no sinyallerini kullanır; kesin engel ve uyarı ayrımı domain kararıdır.

### 5.4 Takip ve son müdahale

- `follow_up_date date`; takip günlük tarihtir, saat/timezone taşımaz (HB-2026-005). İş günü önerisi ayrı calendar service/kuralıdır.
- `last_intervention_at` not/görev/durum gibi anlamlı iş transaction'ında sunucuda güncellenir; UI metni kaynak değildir.
- Geciken sorgular için partial/compound index planlanır.

### 5.5 Değer Kaybı zorunluluğu

- Trafik vakasında süreç kaydı veya açık `not_applicable` gerekçesi gerekip gerekmediği kapanış validation'ında kontrol edilir; veri eklenir eklenmez assessment yaratmak DB trigger görevi değildir.
- Hesap onayı için parça/işçilik final snapshot, araç doğrulaması ve rule version şarttır.
- Kasko'da assessment mevzuat/ürün kuralı olarak isteğe bağlıdır. Ofis operasyon kuralı (eksper talimatı: Kasko'da da değer kaybı çalışılır) **ayrı sürümlü alan** olarak tutulur (`value_loss_legal_requirement` / `value_loss_office_policy` kavramları); ofis kuralı mevzuat alanının anlamını değiştirmez.

### 5.5a Parça bedeli izlenebilirliği

- Parça bedeli hesabı KDV hariç ve iskonto uygulanmamış bedeli esas alır.
- Parça kayıtları hesaplama kaynağını (fiyat listesi/portal/belge), fiyat tarihini ve kullanılan fiyat belgesi referansını taşır; izlenebilirlik olmadan bedel kesinleşmez.

### 5.6 Mevzuat sürümleme

- Effective range çakışması transaction içinde kontrol edilir; eski sürüm silinmez.
- Cevap/hesap sonucu kullanılan `legislation_version_id`/`rule_version_id` değerini immutable referanslar.

### 5.7 Kapanış ücreti

- `source_document_version_id` nihai ekspertiz raporuna işaret etmeden fee approve edilemez.
- Aday tutar kesin aylık toplamda yer almaz.
- Yalnız `KULLANICI_ONAYLI` veya `KULLANICI_DUZELTTI` durumundaki `approved_amount` kullanılır.

### 5.8 Optimistic locking

- Mutable aggregate update örneği: `UPDATE ... SET ..., version=version+1 WHERE id=? AND version=?`.
- Etkilenen satır 0 ise `CONCURRENCY_CONFLICT`; istemci son state'i getirip kullanıcıya karşılaştırma sunar.
- History/audit append kayıtları version yerine unique event/idempotency ile korunur.

### 5.9 Zaman dilimi

- Sunucu/DB işletim zamanı UTC'ye ayarlanır; `timestamptz` kullanılır.
- Türkiye ofis günü hesapları IANA `Europe/Istanbul` ve sürümlü tatil takvimiyle yapılır.
- Kullanıcıdan timezone olmayan tarih-saat kabul edilmez; API offset veya timezone context ister.

## 6. Transaction sınırları

- Case create + office number + initial history + audit tek DB transaction; fiziksel klasör ayrı saga/job'dır.
- Note/task create + case last_intervention + audit tek transaction.
- Close approval DB state'i `CLOSING_PENDING_STORAGE` yapar; File Agent doğrulaması sonrası `CLOSED` kesinleşir.
- Document metadata `PENDING` başlar; hash/taşıma sonucu `READY` olur.
- Fee approval + audit + report snapshot ref tek transaction.
- File Agent job claim lease ve status update atomik; uzun dosya I/O DB transaction açıkken yapılmaz.

## 7. Migration ve retention sınırı

- Bu belgede SQL/migration üretilmez.
- İlk migration öncesi ID türü, query/migration aracı, firm tablosu ve retention sınıfları onaylanmalıdır.
- Destructive migration iki aşamalı expand/migrate/contract yaklaşımı kullanır.
- Otomatik veri purge başlangıç kapsamı değildir; legal retention kararı olmadan yalnız quarantine/soft delete.
