import type { CaseType } from '../types/case'

export interface ClosedCaseRecord {
  id: string
  caseId: string
  closedAt: string
  officeNumber: string
  plate: string
  type: CaseType
  company: string
  reason: string
  expertFee: number
  valueLossStatus: string
  service: string
  assignee: string
}

export const closedCases: readonly ClosedCaseRecord[] = [
  { id: 'closed-1', caseId: 'case-2026-176', closedAt: '09.07.2026', officeNumber: '2026/168', plate: '26 ESK 26', type: 'Trafik', company: 'Ankara Sigorta', reason: 'Onarım tamamlandı', expertFee: 4850, valueLossStatus: 'Eksper Onaylı', service: 'Porsuk Oto', assignee: 'Ahmet Yılmaz' },
  { id: 'closed-2', caseId: 'case-2026-173', closedAt: '08.07.2026', officeNumber: '2026/164', plate: '34 SU 338', type: 'Kasko', company: 'Zurich Sigorta', reason: 'Rapor teslim edildi', expertFee: 6200, valueLossStatus: 'İsteğe bağlı / açılmadı', service: 'Boğaziçi Premium', assignee: 'Zeynep Demir' },
  { id: 'closed-3', caseId: 'case-2026-179', closedAt: '07.07.2026', officeNumber: '2026/159', plate: '07 YK 220', type: 'Trafik', company: 'Mapfre Sigorta', reason: 'Mutabakat sağlandı', expertFee: 5175, valueLossStatus: 'Değer Kaybı Oluşmaz', service: 'Akdeniz Özel Servis', assignee: 'Ahmet Yılmaz' },
  { id: 'closed-4', caseId: 'case-2026-182', closedAt: '04.07.2026', officeNumber: '2026/151', plate: '35 TZM 35', type: 'Kasko', company: 'AXA Sigorta', reason: 'Onarım tamamlandı', expertFee: 7450, valueLossStatus: 'İsteğe bağlı / açılmadı', service: 'Ege Hasar Merkezi', assignee: 'Selin Aras' },
  { id: 'closed-5', caseId: 'case-2026-174', closedAt: '02.07.2026', officeNumber: '2026/147', plate: '01 ADN 101', type: 'Trafik', company: 'Neova Katılım', reason: 'Rapor teslim edildi', expertFee: 4625, valueLossStatus: 'Eksper Kontrolünde', service: 'Seyhan Otomotiv', assignee: 'Selin Aras' },
  { id: 'closed-6', caseId: 'case-2026-180', closedAt: '30.06.2026', officeNumber: '2026/139', plate: '34 KTA 908', type: 'Kasko', company: 'Türkiye Sigorta', reason: 'Pert kararı verildi', expertFee: 9100, valueLossStatus: 'İsteğe bağlı / açıldı', service: 'Marmara Motorlu Araçlar', assignee: 'Zeynep Demir' },
  { id: 'closed-7', caseId: 'case-2026-178', closedAt: '28.06.2026', officeNumber: '2026/132', plate: '41 NG 441', type: 'Trafik', company: 'Quick Sigorta', reason: 'Onarım tamamlandı', expertFee: 4990, valueLossStatus: 'Taslak Hesap', service: 'Körfez Oto', assignee: 'Zeynep Demir' },
  { id: 'closed-8', caseId: 'case-2026-181', closedAt: '25.06.2026', officeNumber: '2026/125', plate: '16 BRS 916', type: 'Trafik', company: 'Sompo Sigorta', reason: 'Dosya işlemden kaldırıldı', expertFee: 3750, valueLossStatus: 'Hazır Değil', service: 'Nilüfer Otomotiv', assignee: 'Selin Aras' },
]

export interface PendingClosedFeeRecord {
  id: string
  caseId: string
  closedAt: string
  officeNumber: string
  plate: string
  type: CaseType
  company: string
  assignee: string
  service: string
  status: 'Kontrol Bekliyor' | 'Tutar Bulunamadı' | 'Birden Fazla Aday'
  candidateFee: number | null
}

export const pendingClosedFees: readonly PendingClosedFeeRecord[] = [
  { id: 'fee-1', caseId: 'case-2026-176', closedAt: '09.07.2026', officeNumber: '2026/168', plate: '26 ESK 26', type: 'Trafik', company: 'Ankara Sigorta', assignee: 'Ahmet Yılmaz', service: 'Porsuk Oto', status: 'Kontrol Bekliyor', candidateFee: 4850 },
  { id: 'fee-2', caseId: 'case-2026-173', closedAt: '08.07.2026', officeNumber: '2026/164', plate: '34 SU 338', type: 'Kasko', company: 'Zurich Sigorta', assignee: 'Zeynep Demir', service: 'Boğaziçi Premium', status: 'Birden Fazla Aday', candidateFee: 6200 },
  { id: 'fee-3', caseId: 'case-2026-179', closedAt: '07.07.2026', officeNumber: '2026/159', plate: '07 YK 220', type: 'Trafik', company: 'Mapfre Sigorta', assignee: 'Ahmet Yılmaz', service: 'Akdeniz Özel Servis', status: 'Tutar Bulunamadı', candidateFee: null },
  { id: 'fee-4', caseId: 'case-2026-182', closedAt: '04.07.2026', officeNumber: '2026/151', plate: '35 TZM 35', type: 'Kasko', company: 'AXA Sigorta', assignee: 'Selin Aras', service: 'Ege Hasar Merkezi', status: 'Kontrol Bekliyor', candidateFee: 7450 },
  { id: 'fee-5', caseId: 'case-2026-174', closedAt: '02.07.2026', officeNumber: '2026/147', plate: '01 ADN 101', type: 'Trafik', company: 'Neova Katılım', assignee: 'Selin Aras', service: 'Seyhan Otomotiv', status: 'Kontrol Bekliyor', candidateFee: 4625 },
  { id: 'fee-6', caseId: 'case-2026-180', closedAt: '30.06.2026', officeNumber: '2026/139', plate: '34 KTA 908', type: 'Kasko', company: 'Türkiye Sigorta', assignee: 'Zeynep Demir', service: 'Marmara Motorlu Araçlar', status: 'Tutar Bulunamadı', candidateFee: null },
]

export interface LegislationSource {
  id: string
  title: string
  type: 'Kanun' | 'Yönetmelik' | 'Genelge' | 'Tarife' | 'Yargı Kararı'
  publishedAt: string
  effectiveAt: string
  version: string
  status: 'Geçerli' | 'Eski Sürüm'
  summary: string
  reference: string
}

export const legislationSources: readonly LegislationSource[] = [
  { id: 'src-1', title: 'Karayolları Trafik Kanunu — İlgili Hükümler', type: 'Kanun', publishedAt: '18.10.1983', effectiveAt: '18.10.1983', version: '2026 güncel derleme', status: 'Geçerli', summary: 'Trafik sorumluluğu, işleten ve sigortacıya ilişkin temel hükümler için mock kaynak kaydı.', reference: 'Madde 85–99 · Güncel derleme' },
  { id: 'src-2', title: 'Karayolları Motorlu Araçlar Zorunlu Mali Sorumluluk Sigortası Genel Şartları', type: 'Yönetmelik', publishedAt: '14.05.2015', effectiveAt: '01.06.2015', version: 'Sürüm 4.2', status: 'Geçerli', summary: 'Teminat, hasar ihbarı ve tazminat süreçlerine ilişkin anonimleştirilmiş özet.', reference: 'Bölüm B.2 · Teminat dışı haller' },
  { id: 'src-3', title: 'Sigorta Eksperleri Atama Yönetmeliği', type: 'Yönetmelik', publishedAt: '25.08.2015', effectiveAt: '25.08.2015', version: 'Sürüm 2.1', status: 'Geçerli', summary: 'Eksper atama, raporlama ve mesleki yükümlülüklere ilişkin mock başvuru kaynağı.', reference: 'Madde 8–15 · Eksper yükümlülükleri' },
  { id: 'src-4', title: 'Motorlu Araç Sigortaları Ekspertiz Ücret Tarifesi', type: 'Tarife', publishedAt: '02.01.2026', effectiveAt: '01.01.2026', version: '2026/1', status: 'Geçerli', summary: 'Ekspertiz ücretlerinin dönemsel kontrolünde kullanılacak mock tarife kaydı.', reference: 'Tarife 2026/1 · Ek-1' },
  { id: 'src-5', title: 'Değer Kaybı Reel Piyasa Analizi Uygulama Notu', type: 'Genelge', publishedAt: '20.06.2026', effectiveAt: '01.07.2026', version: 'RPA 1.0', status: 'Geçerli', summary: 'Reel piyasa analizi yaklaşımının sürümlü kural motoruna temel olacak mock açıklaması.', reference: 'Bölüm 3 · Emsal seçimi' },
  { id: 'src-6', title: 'Eski Değer Kaybı Hesaplama Esasları', type: 'Genelge', publishedAt: '01.12.2021', effectiveAt: '01.01.2022', version: '2022/1', status: 'Eski Sürüm', summary: 'Yeni hesaplara uygulanmayan, geçmiş dosya sonuçlarının açıklanması için tutulan sürüm.', reference: 'Arşiv sürümü · Yürürlükten kalktı' },
]

export type NotificationType = 'Eksik Evrak' | 'Geciken Takip' | 'Onay Bekliyor' | 'Değer Kaybı' | 'Ağır Hasar'

export interface NotificationRecord {
  id: string
  type: NotificationType
  title: string
  detail: string
  caseId: string
  plate: string
  officeNumber: string
  time: string
  read: boolean
  tone: 'warning' | 'danger' | 'info'
}

export const initialNotifications: readonly NotificationRecord[] = [
  { id: 'ntf-1', type: 'Eksik Evrak', title: 'İki zorunlu evrak eksik', detail: 'İmzalı KTT ve ruhsat görüntüsü bekleniyor.', caseId: 'case-2026-184', plate: '34 MPA 764', officeNumber: '2026/184', time: '12 dk önce', read: false, tone: 'warning' },
  { id: 'ntf-2', type: 'Geciken Takip', title: 'Servis takip tarihi geçti', detail: 'Hasar fotoğrafları için servis dönüşü alınamadı.', caseId: 'case-2026-181', plate: '16 BRS 916', officeNumber: '2026/181', time: '48 dk önce', read: false, tone: 'danger' },
  { id: 'ntf-3', type: 'Onay Bekliyor', title: 'Onarım onayı kontrolü', detail: 'Tahmini hasar tutarı eşik üzerinde.', caseId: 'case-2026-179', plate: '07 YK 220', officeNumber: '2026/179', time: '1 sa önce', read: false, tone: 'warning' },
  { id: 'ntf-4', type: 'Değer Kaybı', title: 'Trafik dosyasında değer kaybı bekliyor', detail: 'Parça ve boya listesinin kesinleşmesi gerekiyor.', caseId: 'case-2026-178', plate: '41 NG 441', officeNumber: '2026/178', time: '2 sa önce', read: false, tone: 'info' },
  { id: 'ntf-5', type: 'Ağır Hasar', title: 'PERT ön inceleme adayı', detail: 'Ekonomik oran ve yapısal hasar kontrol edilmeli.', caseId: 'case-2026-180', plate: '34 KTA 908', officeNumber: '2026/180', time: 'Bugün, 09:15', read: true, tone: 'danger' },
  { id: 'ntf-6', type: 'Eksik Evrak', title: 'Kapanış evrakı bekleniyor', detail: 'Nihai rapor ve servis faturası henüz eklenmedi.', caseId: 'case-2026-177', plate: '34 NRM 610', officeNumber: '2026/177', time: 'Dün, 16:40', read: true, tone: 'warning' },
  { id: 'ntf-7', type: 'Değer Kaybı', title: 'Değer kaybı taslağı kontrol edilebilir', detail: 'Mock hesap sonucu eksper kontrolüne hazır.', caseId: 'case-2026-174', plate: '01 ADN 101', officeNumber: '2026/174', time: 'Dün, 13:20', read: true, tone: 'info' },
]

export const managementUsers = [
  { id: 'usr-1', name: 'Ömer Faruk Kaya', role: 'Eksper', assigned: 142, status: 'Aktif' },
  { id: 'usr-2', name: 'Ahmet Yılmaz', role: 'Sorumlu', assigned: 38, status: 'Aktif' },
  { id: 'usr-3', name: 'Selin Aras', role: 'Sorumlu', assigned: 41, status: 'Aktif' },
  { id: 'usr-4', name: 'Zeynep Demir', role: 'Sorumlu', assigned: 36, status: 'Aktif' },
] as const

export const managementServices = [
  { id: 'srv-1', name: 'Akşam Otomotiv', kind: 'Özel', phone: '0 (212) 555 01 20', openCases: 12 },
  { id: 'srv-2', name: 'Ege Hasar Merkezi', kind: 'Yetkili', phone: '0 (232) 555 02 30', openCases: 9 },
  { id: 'srv-3', name: 'Başkent Oto', kind: 'Özel', phone: '0 (312) 555 03 40', openCases: 15 },
  { id: 'srv-4', name: 'Marmara Motorlu Araçlar', kind: 'Yetkili', phone: '0 (262) 555 04 50', openCases: 7 },
] as const
