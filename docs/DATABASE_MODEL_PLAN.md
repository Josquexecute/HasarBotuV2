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
| `cases` | Vaka aggregate; `firm_id`, `office_year`, `office_sequence`, `office_number`, `type`, `status`, `stage`, `notice_number`, `claim_number`, `plate_normalized`, `assignee_id`, `expert_id`, `service_center_id`, `loss_date`, `notification_date`, `follow_up_date`, `last_intervention_at`, `closed_at`, `version` | PK `id`; FK firm/users/service | Unique `(firm_id,office_year,office_sequence)` ve `(firm_id,office_number)`; plate, notice, claim, status/stage, assignee/expert ve LocalDate indeksleri | `deleted_at` yalnız yanlış oluşturma/karantina; close delete değildir; tüm değişiklik audit | Yüksek; hukuki/operasyonel saklama kararı olmadan purge yok |
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
| `service_centers` / `insurers` | Organization-kapsamlı seçim katalogları; servis `service_type`, ad ve `is_active` | Firma içinde ad unique; pasif kayıt tarihsel ilişkide korunur, yeni atamada reddedilir; authorized profil anlaşma değildir |
| `insurer_service_agreements` | Sigortacı-servis çifti için tarihsel durum, desteklenen işlemler, kaynak ve insan onayı | Tenant-bileşik FK; tarih aralığı; kontrollü operation; version; eski servisler için otomatik satır yok |
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
| `policy_ai_assessments` | AI kapsam/muafiyet değerlendirmeleri (dokuz bölümlü cevap) | Kaynaksız cevap kaydedilmez; "açık ve doğrulanabilir hüküm bulunamadı" ayrı sonuçtur |
| `policy_human_approvals` | Operasyonu bağlayan sonuçların insan onayı | Onaysız çıkarım operasyonu bağlamaz; A2 audit |
| `policy_pages` / `policy_sections` | Sayfa metni ve mantıksal bölümler (ihbar föyü/poliçe/özel şart/zeyil) | Ham poliçe metni hassas veri sınıfı + saklama politikası ister |
| `policy_cost_shares` | Poliçe kaynaklı maliyet paylaşımı (sigorta/araç sahibi payı, matrah, koşul) | Oran sabit kodlanmaz; kaynak klozdan |
| `policy_service_rules` / `policy_part_rules` | Servis şartı ve tedarik parça türü kuralları | Araç yaşı/koşul yapılandırılmış |
| `policy_required_documents` | Poliçenin saydığı hasar belgeleri | Evrak kural motoruyla eşleşir |
| `policy_external_references` | Harici web klozu atıfları (URL, erişim tarihi, içerik hash, arşiv sürümü) | Güncel web geçmiş poliçeye kendiliğinden uygulanmaz |
| `policy_action_holds` | Tedarik/mobil onarım geçici durdurmaları | Kaldırma yalnız koşul + insan onayı; audit |
| `policy_portal_notes` / `policy_decision_history` | Portal notları ve poliçe kaynaklı karar zaman çizelgesi | Append-only |
| `part_price_references` | Parça referans bedeli (KDV hariç iskontosuz liste; kaynak/tarih/belge; gerçek bedel/pay ayrımı) | Referans bedel ödeme tutarıyla karışmaz |
| `ai_usage_ledger` | AI kullanım/maliyet defteri (modül/kullanıcı/model/dosya) | Bütçe raporu ve üst sınır takibi |
| `backup_runs` / `restore_test_runs` | Yedek koşuları ve geri yükleme testi kanıtları | Yedek dosyasının varlığı başarı sayılmaz; doğrulama + audit |
| `case_workspace_provisionings` | Case çalışma klasörü planı, güvenli göreli yol rezervasyonu ve Agent durum snapshot’ı | Vaka başına tek rezervasyon; org/root/path unique; mutlak yol yok; ready yalnız Agent doğrulamasıyla |

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

### 5.4a Paket 37 uygulanan not/görev/takip modeli

- `case_notes`: tenant/case/creator FK, `internal|contact`, bounded subject/body ve UTC create zamanı; update/delete trigger’ıyla append-only.
- `case_tasks`: tenant/case/user FK, `low|normal|high`, LocalDate `due_date`, `open|completed|cancelled`, zorunlu terminal resolution, optimistic version ve açık-görev due index’i.
- `case_task_events`: created/completed/cancelled task version geçmişi; append-only ve task-version tekil.
- `case_follow_up_history`: eski/yeni LocalDate, case create/update kaynağı, actor ve resulting case version; append-only ve case-version tekil.
- İlk sürümde not revision/edit/delete ve görev reopen yoktur. Eski tablolar sessizce taşınmaz; migration backward-compatible yeni tablolar ekler.

### 5.5 Değer Kaybı zorunluluğu

- Trafik vakasında süreç kaydı veya açık `not_applicable` gerekçesi gerekip gerekmediği kapanış validation'ında kontrol edilir; veri eklenir eklenmez assessment yaratmak DB trigger görevi değildir.
- Hesap onayı için parça/işçilik final snapshot, araç doğrulaması ve rule version şarttır.
- Kasko'da assessment mevzuat/ürün kuralı olarak isteğe bağlıdır. Ofis operasyon kuralı (Baran Global: hesaplamaya uygun TÜM Kasko dosyalarında süreç açılır) **ayrı sürümlü alan** olarak tutulur (`value_loss_legal_requirement` / `value_loss_office_policy` kavramları); ofis kuralı mevzuat alanının anlamını değiştirmez.
- Uygunluk ekseni süreç durumlarından ayrıdır: Hesaplamaya Uygun / Veri Eksik / Eksper İncelemesi Gerekli / Değer Kaybı Oluşmaz / Referans Modülle Hesaplanamaz / Ağır Hasar Nedeniyle Hesaplanamaz / **Uygulanamaz (gerekçe zorunlu)**. "Değer Kaybı Oluşmaz" adının iki eksende çakışması şema tasarımında çözülmelidir.
- Ofis numarası ek kuralları: aktifleştirmede otomatik atama; aynı numara ikinci kez kullanılamaz; iptal edilen numara tekrar dağıtılmaz; yeniden açılan dosya eski numarasını korur.

### 5.5a Parça bedeli izlenebilirliği

- Parça bedeli hesabı KDV hariç ve iskonto uygulanmamış bedeli esas alır.

### 5.6 Trafik değer kaybı çekirdeği — Paket 32

- `traffic_value_loss_assessments`: organization/case tekil assessment kimliği, current version ve optimistic version.
- `traffic_value_loss_versions`: `2026.07.01.1` rule snapshot, LocalDate evaluation, bounded input/result JSONB, sonuç/durum, insan onayı ve active approved sürüm.
- `traffic_value_loss_evidence`: documentVersion veya kontrollü market/SBM/eksper referansı, SHA-256, desteklediği alanlar, verification/conflict; append-only.
- `traffic_value_loss_comparables`: pre-accident/post-repair tarafı, minor-unit değer, kilometre, gözlem tarihi, evidence FK ve gerekçeli dışlama; append-only.
- `traffic_value_loss_approval_events`: submit/approve/reject actor, zaman ve gerekçe geçmişi; append-only.
- Tenant bileşik FK, case başına tek assessment, version uniqueness, tek active approved, ready-document server doğrulaması ve terminal immutability uygulanır.
- Mutlak yol, belge içeriği, müşteri kişisel verisi veya eski Ek-1 katsayı sonucu saklanmaz.
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

## Paket 23 uygulanan PostgreSQL modeli

- `policy_analyses` aggregate kimliği ve optimistic version; `policy_analysis_versions` immutable/sürümlü analiz gerçeğidir.
- `policy_source_references` sınırlı kanıt; coverage/deductible/service/part/replacement/exclusion/required-document/scenario-rule tabloları doğrulanabilir kanonik maddelerdir. `policy_evidence_links` madde-kaynak bağını taşır.
- `policy_conflicts` çözüm geçmişi ve `policy_scenario_evaluations` güvenli değerlendirme snapshot'ıdır. JSONB yalnız değişken koşul/listeler ve güvenli snapshot içindir; analiz tek doğrulanamaz blob değildir.
- Tenant bileşik FK, etkin tarih/check, tek aktif approved source, ready/verified source trigger, append-only evidence/evaluation ve approved/superseded fact guard zorunludur. Mutlak yol veya tam belge metni kolonu yoktur.

## Paket 24 uygulanan PostgreSQL modeli

- `document_text_extractions`: documentVersion + exact parser/normalizasyon kimliği, optimistic version, queue/job bağı, safe status/failure, source/output hash ve bounded sayaçlar.
- `document_text_extraction_pages`: sayfa sıra/status, bounded raw+normalized metin ve hash; `document_text_extraction_segments`: deterministic type/text/hash ve Unicode code point range. Sayfa/segment append-only, terminal extraction immutable’dır.
- Tenant/case/document/version bileşik FK, tek extraction identity/version, tek aktif extraction job, strict engine/status/count/hash ve source-reference locator guard DB tarafından zorlanır.
- `policy_source_references` nullable extraction/page/segment/range ile genişler; eski satırlar değişmez. Mutlak root/path, PDF binary, tam belge blob’u, parser stack veya secret kolonu yoktur.

## Paket 25 uygulanan PostgreSQL modeli

- `document_ocr_runs`: tenant/case/document/version/extraction, exact OCR identity ve sürüm, queue/job, status/progress, source/output hash, güvenli sayaç ve optimistic version.
- `document_ocr_pages`: bounded raw+normalized OCR, render/preprocess sonucu, confidence/quality/reading/composite ve page geometry. `document_ocr_blocks|lines|words`: parent, sıra, Unicode range/hash, confidence ve render-pixel box.
- Exact identity unique index; tek aktif source işi; tenant bileşik FK; sabit engine/language/render/profile check; count/status/hash/quality check; element range+box trigger; terminal run ve OCR evidence append-only guard DB tarafındadır.
- `policy_source_references`, OCR run/page/block/line/word, range, exact versions, quality/reading ve box ile backward-compatible genişler. Trigger excerpt/range/parent/tenant/documentVersion bağını yeniden doğrular.
- Mutlak/logical path, PDF/image/model binary, worker stack/stdout/stderr, secret ve tam belge blob kolonu yoktur. OCR metni tek doğrulanamaz JSONB değildir; yalnız bounded preprocessing config JSONB’dir.

## Paket 26 uygulanan PostgreSQL modeli

- Migration `0018_policy_ai_orchestration`; `ai_provider_policies`, `ai_source_bundles`, `ai_source_bundle_items`, `ai_extraction_runs`, `ai_extraction_candidates`, `ai_candidate_source_links`, `ai_candidate_conflicts`, `ai_usage_ledger` tablolarını ekler.
- Bundle ready olduktan sonra ve bundle item/source anchor kayıtları append-only/immutable’dır. Candidate provider facts değiştirilemez; deferred constraint her candidate için aynı bundle/run içinden source link zorlar.
- Exact identity, organization-scope idempotency, bundle içi anchor, tenant bileşik foreign key ve safe integer/bounded text kontrolleri DB’de zorlanır.
- Usage ledger append-only’dır. Tam prompt/provider response, PDF/OCR binary, mutlak yol, root, secret veya tüm belge metni için kolon yoktur.
- Migration ileri, tekrar, rollback/reapply, tenant, immutable ve constraint testlerine dahildir; üretim migration bu pakette çalıştırılmaz.

## Paket 27 uygulanan PostgreSQL modeli

- `ai_candidate_reviews`: candidate başına sıralı append-only review version; eylem, insan değeri, source anchor kümesi, evidence durumu, aktör ve UTC zaman.
- `policy_analysis_ai_facts`: yeni Paket 23 analysis version’ına taşınan kabul/düzenleme gerçekleri; provider fact, review ve source-anchor provenance’ı immutable korunur.
- `ai_candidate_promotions` ve `ai_candidate_promotion_items`: run/review-set/analysis version atomik promotion kimliği ve aday-review-fact bağlantısı.
- `ai_candidate_promotion_conflicts`: AI conflict proposal’ın promotion geçmişi ve varsa Paket 23 conflict kaydıyla ilişkisi.
- Tenant bileşik foreign key’leri, sequential review version, accepted fact eşitliği, source-anchor membership, idempotent tek promotion ve approved fact immutability DB guard’larıyla zorlanır. Mutlak path, secret, full prompt/provider response veya tam belge metni kolonu yoktur.

## Paket 28 uygulanan PostgreSQL modeli

- Migration `0020_real_policy_ai_provider`, provider allow-list ve Paket 23 AI fact provenance guard’ını `openai-responses` için genişletir.
- `ai_extraction_runs`; external-provider bayrağı, privacy policy, outbound payload hash/character sayısı, redacted kategori/sayı, retention mode ve pricing version taşır. Completed privacy/provider fact alanları trigger ile immutable’dır.
- `ai_usage_ledger`; input/output token çiftini ve pricing version’ı append-only tutar. Safe integer/birlikte-null constraint’i eksik kullanım çiftini reddeder.
- Provider secret, Authorization header, full prompt/request/response, redacted veya raw kaynak metni, binary ve mutlak path için kolon yoktur. Tenant, idempotency, source anchor ve Paket 27 promotion ilişkileri mevcut guard’ları kullanır.

## Paket 29 uygulanan PostgreSQL modeli

- Migration `0021_policy_ai_provider_recovery`, provider allow-list/provenance guard’larını `gemini-generate-content` ve run privacy guard’ını `free_tier_product_improvement` için backward-compatible genişletir.
- `ai_provider_call_receipts`, dış çağrıdan önce commit edilen tenant/case/run/request kimliği ve bütçe rezervasyonudur. Response-received canonical output ayrı transaction'da kaydedilir; candidate/usage finalize replay ile provider çağrısı tekrarlanmadan tamamlanabilir.
- Receipt terminal durumda immutable’dır. `outcome_unknown` otomatik retry edilmez; tahmini maliyet hard-stop hesabında rezerve kalır. Tenant/run/actor bileşik FK, request/client-id unique ve bounded metadata constraint’leri DB’de zorlanır.
- Full prompt, ham provider response, source text, PII, secret, authorization header, binary veya mutlak yol kolonu yoktur. Migration up/repeat/down/reapply ve privacy/tenant/immutability constraint testleri gerçek PostgreSQL’de çalışır.

## Paket 34 uygulanan PostgreSQL modeli

- Migration `0023_traffic_value_loss_reports`, onaylı assessment version’a tenant-bileşik FK ile bağlı tek final report kaydı ekler.
- Kayıt; content snapshot, content/PDF SHA-256, PDF byte-size, content schema, template, rule version, generator ve UTC zamanı taşır. PDF binary, filesystem path, storage root veya File Agent bilgisi DB’de tutulmaz.
- Unique assessment-version constraint ikinci final raporu engeller. Insert guard yalnız insan onaylı `approved | superseded` kaynağı kabul eder; snapshot identity alanları kolonlarla eşleşir.
- Report satırı update/delete trigger’ıyla append-only’dir. Düzeltme yeni Trafik değer kaybı version/approval/report zinciridir.

## Paket 39 uygulanan PostgreSQL modeli

- Migration `0025_closure_fees_reports`, case başına tenant-kapsamlı tek `fee_records` aggregate ve append-only `fee_record_versions` geçmişi ekler.
- Aggregate current version pointer ve optimistic `version` taşır. Version satırı aday/onaylı tutar, final-report documentVersion, kaynak sayfa, actor/onay zamanı, rule version ve düzeltme gerekçesini tutar.
- Para `bigint` safe minor-unit ve sabit `TRY`'dir; floating point kolon yoktur. Status/shape constraint'i `control_required`, `approved` ve `corrected` alan bütünlüğünü zorlar.
- Composite tenant/case foreign key'leri case, documentVersion ve kullanıcı bağlarını doğrular. Aynı case için tek aggregate ve aggregate içinde tek version numarası unique constraint ile korunur.
- Version satırları update/delete append-only trigger'ıyla korunur. Mutlak path, belge içeriği, PDF binary, secret veya ham hata kolonu yoktur.

## Paket 40 PostgreSQL kullanımı

- Yeni migration veya tablo yoktur. Lifecycle operation/history içindeki mevcut `requirement_snapshot jsonb`, sürümlü değer kaybı kapanış özetini backward-compatible taşır.
- Özet kaynağı yalnız `traffic_value_loss_assessments.current_version_id`, bağlı `traffic_value_loss_versions` approval/result snapshot’ı ve aynı version’a unique bağlı `traffic_value_loss_reports` satırıdır.
- Kapanış finalization mevcut operation snapshot’ını history’ye append-only kopyalar; sonradan oluşan yeni assessment version eski kapanış snapshot’ını değiştirmez.
- Aylık rapor salt-okunur join ile saklı minor-unit sonucu toplar; hesaplama fonksiyonunu tekrar çalıştırmaz ve yeni snapshot/audit yazmaz.
- Mutlak path, PDF binary, emsal metni veya yeni kişisel veri kolonu eklenmez.

## Paket 41 uygulanan PostgreSQL modeli

- Migration `0026_email_draft_core`; case başına birden çok `email_drafts` aggregate’ı ve her aggregate için immutable `email_draft_versions` zinciri ekler.
- `email_draft_recipients`, `email_draft_attachments` ve `email_handoffs` append-only child geçmişidir. Composite tenant/case/draft/version FK’leri başka draft sürümüne çapraz bağlanmayı engeller.
- Aggregate `current_version_id` ve optimistic `version` taşır. Insert/update guard’ları version sırası, previous pointer ve current pointer’ın aynı draft/version zincirine ait olmasını zorlar.
- Attachment satırı ya documentVersion ya photo referansı taşır; ikisini birlikte veya boş taşıyamaz. Ready/verified uygunluğunun nihai otoritesi API command transaction’ıdır.
- Handoff yalnız `gmail_web` ve append-only sequence taşır; sent/delivered/provider message ID semantiği yoktur.
- Subject/body vaka-kapsamlı iş verisidir; audit’e kopyalanmaz. OAuth tokenı, secret, mutlak/relative filesystem path, binary veya tam dosya içeriği kolonu yoktur.
