import { Suspense, lazy, useState } from 'react'
import { CheckCircle2, FileCog, Plus, RefreshCw, ShieldAlert, ShieldCheck, Store, UserRoundCog, UsersRound, X } from 'lucide-react'
import { managementServices, managementUsers } from '../../mocks/workspaces'
import { LoadingState } from '../../components/StateViews'
import { getConfiguredDataSource, type CaseReferenceDataPort, type CaseReferenceWorkspace, type DataSourceKind } from '../../data/ports'
import { useCaseReferences } from '../../data/useCaseReferences'
import { useSession } from '../../app/sessionContext'
import { useUsers } from '../../data/useUsers'
import type { RoleCodeRecord, UserSummaryRecord, UsersDataPort } from '../../data/usersPort'
import { useV1ImportQuarantines } from '../../data/useV1ImportQuarantines'
import type { V1ImportQuarantineDataPort } from '../../data/v1ImportQuarantinePort'
const LaborExcelProfilesModule = lazy(async () => {
  const module = await import('./LaborExcelProfilesModule')
  return { default: module.LaborExcelProfilesModule }
})

const ROLE_LABELS: Readonly<Record<RoleCodeRecord, string>> = {
  admin: 'Yönetici',
  expert: 'Eksper',
  case_manager: 'Dosya Sorumlusu',
  secretary: 'Sekreter',
  accounting: 'Muhasebe',
  read_only: 'Salt Okunur',
}

/**
 * HB-011 kaynak-bazlı yetki matrisi. Bu tablo SUNUCUDA GERÇEKTEN uygulanan
 * rol kapılarının birebir yansımasıdır (`services/api/src/**\/routes.ts`
 * içindeki `WRITE_ROLES` / `APPROVE_ROLES` / `FINANCIAL_READ_ROLES` sabitleri).
 * Yetkiyi burası vermez; burası yalnız yürürlükteki kapıyı görünür kılar.
 * Sunucudaki bir sabit değişirse bu satır da güncellenmelidir.
 */
interface PermissionMatrixRow {
  readonly resource: string
  readonly roles: readonly RoleCodeRecord[]
  readonly note: string
}

/** Tüm rol kodları; matris sütun sırası ve rol seçim kutularının sırası ortaktır. */
const ALL_ROLES: readonly RoleCodeRecord[] = ['admin', 'expert', 'case_manager', 'secretary', 'accounting', 'read_only']

const PERMISSION_MATRIX: readonly PermissionMatrixRow[] = [
  { resource: 'Dosya görüntüleme', roles: ALL_ROLES, note: 'Kendi organizasyonu ile sınırlı' },
  { resource: 'Dosya oluşturma ve güncelleme', roles: ['admin', 'expert', 'case_manager', 'secretary', 'accounting'], note: 'Salt Okunur hariç' },
  { resource: 'Not ve görev', roles: ['admin', 'expert', 'case_manager', 'secretary'], note: 'Operasyon kullanıcıları' },
  { resource: 'Evrak ve fotoğraf kaydı', roles: ['admin', 'expert', 'case_manager', 'secretary'], note: 'Not/görev ile aynı sınıf' },
  { resource: 'Dosya kapatma ve yeniden açma', roles: ['admin', 'expert', 'case_manager'], note: 'Kritik işlem · plan → onay' },
  { resource: 'Klasör kurulumu, taşıma ve konum atama', roles: ['admin', 'expert', 'case_manager'], note: 'Kritik işlem · fiziksel yol' },
  { resource: 'Değer Kaybı ve Poliçe Analizi düzenleme', roles: ['admin', 'expert', 'case_manager'], note: 'Sürümlü taslak' },
  { resource: 'Değer Kaybı ve Poliçe Analizi onayı', roles: ['admin', 'expert'], note: 'İnsan onayı zorunlu' },
  { resource: 'Kapanma ücreti adayı', roles: ['admin', 'expert', 'case_manager'], note: 'Kaynak belge + sayfa zorunlu' },
  { resource: 'Kapanma ücreti onayı', roles: ['admin', 'expert', 'accounting'], note: 'Kritik işlem' },
  { resource: 'Mali tutar görüntüleme', roles: ['admin', 'expert', 'case_manager', 'accounting'], note: 'Diğer rollerde tutarlar gizlenir' },
  { resource: 'Envanterde telefon dışa aktarımı', roles: ['admin', 'expert', 'case_manager'], note: 'PII sütunları' },
  { resource: 'Audit kayıtlarını görüntüleme', roles: ['admin'], note: 'Yalnız yönetici' },
  { resource: 'V1 aktarım karantinasını görüntüleme', roles: ['admin'], note: 'Salt okunur · çözüm aksiyonu yok' },
  { resource: 'Kullanıcı ve rol yönetimi', roles: ['admin'], note: 'Kendi yönetici rolü kaldırılamaz' },
  { resource: 'File Agent kaydı ve güncellemesi', roles: ['admin'], note: 'Yalnız yönetici' },
]

function PermissionMatrixPanel() {
  return (
    <section className="office-table-panel management-grid__wide">
      <header className="panel-heading">
        <div>
          <h2>Kaynak Bazlı Yetki Matrisi</h2>
          <span>Sunucuda uygulanan gerçek kapılar · yetki burada verilmez, yalnız görünür kılınır</span>
        </div>
        <UserRoundCog size={18} />
      </header>
      <div className="table-scroll">
        <table className="data-table permission-matrix">
          <thead>
            <tr>
              <th scope="col">Kaynak / İşlem</th>
              {ALL_ROLES.map((role) => <th key={role} scope="col">{ROLE_LABELS[role]}</th>)}
              <th scope="col">Not</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MATRIX.map((row) => (
              <tr key={row.resource}>
                <th scope="row"><strong>{row.resource}</strong></th>
                {ALL_ROLES.map((role) => (
                  <td key={role} className="role-cell">
                    {row.roles.includes(role)
                      ? <span aria-label={`${ROLE_LABELS[role]}: yetkili`}>✓</span>
                      : <span aria-label={`${ROLE_LABELS[role]}: yetkisiz`}>—</span>}
                  </td>
                ))}
                <td className="role-cell">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type ManagementTab =
  | 'Kullanıcılar' | 'Servisler' | 'V1 Aktarım Karantinası' | 'Excel Şablonları' | 'Belge Kuralları' | 'Erişim ve Yetki'

const SERVICE_TYPE_LABELS: Readonly<Record<string, string>> = {
  authorized: 'Yetkili',
  private: 'Özel',
}

const AGREEMENT_LABELS: Readonly<Record<string, string>> = {
  agreed: 'Anlaşmalı',
  not_agreed: 'Anlaşmasız',
  control_required: 'Kontrol Gerekli',
}

function loadMessage(status: string): string | null {
  if (status === 'loading') return 'Gerçek kullanıcı ve servis verisi yükleniyor…'
  if (status === 'unauthorized') return 'Oturum gerekli; mock kayıt gösterilmez.'
  if (status === 'unavailable') return 'Referans servisine ulaşılamıyor; mock fallback yapılmadı.'
  return null
}

/**
 * API modunda Yönetim listeleri yalnız gerçek referans verisinden gelir.
 * Mock prototipteki telefon, atanmış dosya ve açık dosya sayıları gerçek
 * referans sözleşmesinde bulunmadığı için gösterilmez; uydurulmuş sütun
 * eklenmez.
 */
function ManagementReferenceContent({ activeTab, port }: { activeTab: ManagementTab; port?: CaseReferenceDataPort }) {
  const { references, status, reload } = useCaseReferences(port)
  const message = loadMessage(status)

  if (status !== 'ok' || references === null) {
    return (
      <section className="office-table-panel">
        <header className="panel-heading">
          <div><h2>{activeTab}</h2><span>Gerçek veri kaynağı</span></div>
          <UsersRound size={18} />
        </header>
        <div className="management-state">
          <p role={status === 'loading' ? 'status' : 'alert'}>{message ?? 'Veri hazırlanıyor…'}</p>
          <button className="button" type="button" onClick={reload}><RefreshCw size={15} /> Yeniden dene</button>
        </div>
      </section>
    )
  }

  if (activeTab === 'Kullanıcılar') return <ReferenceUsers references={references} />
  return <ReferenceServices references={references} />
}

function usersLoadMessage(status: string): string | null {
  if (status === 'loading') return 'Gerçek kullanıcı ve rol verisi yükleniyor…'
  if (status === 'unauthorized') return 'Oturum gerekli; kullanıcı listesi gösterilmez.'
  if (status === 'forbidden') return 'Rol yönetimi yalnız yönetici rolüne açıktır.'
  if (status === 'unavailable') return 'Kullanıcı servisine ulaşılamıyor.'
  return null
}

/**
 * HB-011: gerçek rol atama. Yalnız `admin` oturumunda gösterilir (uç zaten
 * sunucuda admin-only'dir; bu yalnız kullanıcı deneyimidir). Kaydetme gerçek
 * `PATCH /api/v1/users/:userId/roles` çağırır; sürüm çakışması/self-lockout
 * ayrı mesajlarla yüzeye çıkar.
 */
function ManagementUsersAdminContent({ port }: { port?: UsersDataPort }) {
  const { items, status, reload, updateRoles, savingUserId } = useUsers(true, port)
  const message = usersLoadMessage(status)

  if (status !== 'ok') {
    return (
      <section className="office-table-panel">
        <header className="panel-heading">
          <div><h2>Kullanıcı ve Rol Yönetimi</h2><span>Gerçek rol ataması</span></div>
          <UsersRound size={18} />
        </header>
        <div className="management-state">
          <p role={status === 'loading' ? 'status' : 'alert'}>{message ?? 'Veri hazırlanıyor…'}</p>
          <button className="button" type="button" onClick={reload}><RefreshCw size={15} /> Yeniden dene</button>
        </div>
      </section>
    )
  }

  return (
    <section className="office-table-panel">
      <header className="panel-heading">
        <div>
          <h2>Kullanıcı ve Rol Yönetimi</h2>
          <span>{items.length} gerçek kullanıcı · rol değişikliği anında etkili olur</span>
        </div>
        <UsersRound size={18} />
      </header>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Kullanıcı</th><th>Roller</th><th>Durum</th><th></th></tr></thead>
          <tbody>
            {items.map((user) => (
              <UserRoleRow
                key={user.id}
                user={user}
                saving={savingUserId === user.id}
                onSave={(roles) => updateRoles(user.id, { roles, expectedVersion: user.version })}
              />
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <p className="management-empty">Bu organizasyonda kayıtlı kullanıcı bulunamadı.</p>}
    </section>
  )
}

function UserRoleRow({ user, saving, onSave }: {
  user: UserSummaryRecord
  saving: boolean
  onSave: (roles: readonly RoleCodeRecord[]) => Promise<{ ok: true } | { ok: false; kind: string }>
}) {
  const [draft, setDraft] = useState<readonly RoleCodeRecord[]>(user.roles)
  const [feedback, setFeedback] = useState<string | null>(null)
  const dirty = draft.length !== user.roles.length || draft.some((role) => !user.roles.includes(role))

  const toggle = (role: RoleCodeRecord) => {
    setFeedback(null)
    setDraft((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role])
  }

  const save = async () => {
    const result = await onSave(draft)
    if (result.ok) {
      setFeedback('Roller güncellendi.')
      return
    }
    if (result.kind === 'self_lockout') setFeedback('Kendi yönetici rolünüzü kaldıramazsınız.')
    else if (result.kind === 'conflict') setFeedback('Kayıt başka bir işlemle değişti; liste yenilendi.')
    else if (result.kind === 'forbidden') setFeedback('Rol değiştirme yetkiniz yok.')
    else if (result.kind === 'validation') setFeedback('En az bir rol seçilmelidir.')
    else setFeedback('Rol güncellenemedi.')
  }

  return (
    <tr>
      <td><strong>{user.displayName}</strong><br /><small>{user.email}</small></td>
      <td>
        <div className="role-checkbox-group">
          {ALL_ROLES.map((role) => (
            <label key={role} className="role-checkbox">
              <input
                type="checkbox"
                checked={draft.includes(role)}
                disabled={saving}
                onChange={() => toggle(role)}
              /> {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </td>
      <td><span className={`status-pill ${user.status === 'active' ? 'status-pill--open' : 'status-pill--waiting'}`}>{user.status === 'active' ? 'Aktif' : 'Pasif'}</span></td>
      <td>
        <button className="button button--secondary" type="button" disabled={!dirty || saving || draft.length === 0} onClick={save}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {feedback !== null && <p className="role-row-feedback" role="status">{feedback}</p>}
      </td>
    </tr>
  )
}

function ReferenceUsers({ references }: { references: CaseReferenceWorkspace }) {
  const expertIds = new Set(references.experts.map((expert) => expert.id))
  return (
    <section className="office-table-panel">
      <header className="panel-heading">
        <div>
          <h2>Kullanıcı ve Sorumlu Listesi</h2>
          <span>{references.users.length} gerçek kullanıcı · eksper rolü referans verisinden türetilir</span>
        </div>
        <UsersRound size={18} />
      </header>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Kullanıcı</th><th>Eksper Rolü</th><th>Operasyon Yetkisi</th></tr></thead>
          <tbody>
            {references.users.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.displayName}</strong></td>
                <td>{expertIds.has(user.id)
                  ? <span className="status-pill status-pill--open">Eksper</span>
                  : <span className="status-pill status-pill--waiting">Eksper değil</span>}</td>
                <td>Görüntüle · Not · Görev</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {references.users.length === 0 && <p className="management-empty">Bu organizasyonda kayıtlı kullanıcı bulunamadı.</p>}
    </section>
  )
}

function ReferenceServices({ references }: { references: CaseReferenceWorkspace }) {
  return (
    <section className="office-table-panel">
      <header className="panel-heading">
        <div>
          <h2>Servis Listesi</h2>
          <span>{references.services.length} gerçek servis · anlaşma durumu sürümlü değerlendirmeden gelir</span>
        </div>
        <Store size={18} />
      </header>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th>Servis Adı</th><th>Tür</th><th>Anlaşma</th><th>Durum</th></tr></thead>
          <tbody>
            {references.services.map((service) => (
              <tr key={service.id}>
                <td><strong>{service.name}</strong></td>
                <td>{SERVICE_TYPE_LABELS[service.serviceType] ?? service.serviceType}</td>
                <td>{AGREEMENT_LABELS[service.agreement.agreementStatus] ?? service.agreement.agreementStatus}</td>
                <td>
                  <span className={`status-pill ${service.isActive ? 'status-pill--open' : 'status-pill--waiting'}`}>
                    {service.isActive ? 'Aktif' : 'Pasif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {references.services.length === 0 && <p className="management-empty">Bu organizasyonda kayıtlı servis bulunamadı.</p>}
    </section>
  )
}

const QUARANTINE_REASON_LABELS = {
  claim_type_unresolved: 'Dosya türü çözülemedi',
  ambiguous_target: 'Hedef dosya belirsiz',
  genuine_evidence_conflict: 'Belge kanıtı çelişkili',
  malformed_source: 'Kaynak biçimi bozuk',
} as const

function formatQuarantineDate(value: string): string {
  return new Intl.DateTimeFormat('tr-TR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function ManagementQuarantineContent({ port }: { readonly port?: V1ImportQuarantineDataPort }) {
  const { page, status, reload } = useV1ImportQuarantines(port)
  if (status !== 'ok' || page === null) {
    const message = status === 'loading'
      ? 'V1 aktarım karantinası yükleniyor…'
      : status === 'forbidden'
        ? 'Bu görünüm yalnız yöneticilere açıktır.'
        : status === 'unauthorized'
          ? 'Oturum gerekli; karantina kayıtları gösterilmez.'
          : 'Karantina raporlama servisine ulaşılamıyor.'
    return (
      <section className="office-table-panel">
        <header className="panel-heading"><div><h2>V1 Aktarım Karantinası</h2><span>Salt okunur görünüm</span></div><ShieldAlert size={18} /></header>
        <div className="management-state"><p role={status === 'loading' ? 'status' : 'alert'}>{message}</p><button className="button" type="button" onClick={reload}><RefreshCw size={15} /> Yeniden dene</button></div>
      </section>
    )
  }
  return (
    <section className="office-table-panel">
      <header className="panel-heading">
        <div><h2>V1 Aktarım Karantinası</h2><span>{page.totalItems} çözümlenmemiş kaynak · salt okunur</span></div>
        <ShieldAlert size={18} />
      </header>
      {page.items.length === 0 ? <p className="management-empty">Çözümlenmemiş V1 aktarım kaydı bulunmuyor.</p> : (
        <div className="table-scroll">
          <table className="data-table quarantine-table">
            <thead><tr><th>Neden</th><th>Kaynak</th><th>Aday hedef</th><th>Kanıt özeti</th><th>Tarih</th><th>Durum</th></tr></thead>
            <tbody>{page.items.map((item) => (
              <tr key={item.id}>
                <td><strong>{QUARANTINE_REASON_LABELS[item.reason]}</strong><br /><small>{item.reasonCode}</small></td>
                <td><strong>{item.sourceRelativePath}</strong><br /><small>Token: {item.sourceToken}</small></td>
                <td>{item.candidateTargets.length === 0
                  ? 'Aday yok'
                  : item.candidateTargets.map((candidate) => `${candidate.officeCaseNumber} · ${candidate.caseType === 'traffic' ? 'Trafik' : 'Kasko'}`).join(', ')}</td>
                <td>{item.evidenceSummary.detectedCaseType === null ? 'Tür belirlenemedi' : item.evidenceSummary.detectedCaseType === 'traffic' ? 'Trafik sinyali' : 'Kasko sinyali'} · {item.evidenceSummary.evidenceCount} kanıt</td>
                <td>{formatQuarantineDate(item.createdAt)}</td>
                <td><span className="status-pill status-pill--waiting">Çözümlenmedi</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function ManagementPage({ port, usersPort, quarantinePort }: {
  readonly port?: CaseReferenceDataPort
  readonly usersPort?: UsersDataPort
  readonly quarantinePort?: V1ImportQuarantineDataPort
} = {}) {
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const { user } = useSession()
  const isAdmin = user?.roles.includes('admin') ?? false
  const [activeTab, setActiveTab] = useState<ManagementTab>('Kullanıcılar')
  const [notice, setNotice] = useState('')
  const showAdminUsers = activeTab === 'Kullanıcılar' && isAdmin
  const referenceTab = (activeTab === 'Kullanıcılar' && !isAdmin) || activeTab === 'Servisler'

  return (
    <main className="page office-page management-page">
      <section className="page-heading page-heading--compact">
        <div>
          <h1>Yönetim</h1>
          <p>{source === 'api'
            ? 'Kullanıcı ve servis listeleri gerçek referans verisinden gelir; kural ve yetki bölümleri kilitli proje kurallarıdır'
            : 'Kullanıcı, servis, kural ve erişim altyapısının mock görünümü'}</p>
        </div>
        {source === 'mock' && (
          <button className="button button--primary" type="button" onClick={() => setNotice(`${activeTab} için yeni kayıt formu mock olarak hazırlandı.`)}>
            <Plus size={15} /> Yeni Kayıt
          </button>
        )}
      </section>
      <nav className="workspace-tabs" aria-label="Yönetim bölümleri">{(['Kullanıcılar', 'Servisler', ...(isAdmin && source === 'api' ? ['V1 Aktarım Karantinası' as const] : []), 'Excel Şablonları', 'Belge Kuralları', 'Erişim ve Yetki'] as const).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>
      <div className="office-scroll management-content">
        {referenceTab && source === 'api' && <ManagementReferenceContent activeTab={activeTab} port={port} />}
        {showAdminUsers && source === 'api' && <ManagementUsersAdminContent port={usersPort} />}
        {activeTab === 'V1 Aktarım Karantinası' && isAdmin && source === 'api' && <ManagementQuarantineContent port={quarantinePort} />}
        {activeTab === 'Kullanıcılar' && source === 'mock' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Kullanıcı ve Sorumlu Listesi</h2><span>Başlangıçta herkes tüm dosyaları görebilir</span></div><UsersRound size={18} /></header><div className="table-scroll"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Atanmış Dosya</th><th>Durum</th><th>Operasyon Yetkisi</th></tr></thead><tbody>{managementUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.role}</td><td>{user.assigned}</td><td><span className="status-pill status-pill--open">{user.status}</span></td><td>Görüntüle · Not · Görev</td></tr>)}</tbody></table></div></section>}
        {activeTab === 'Servisler' && source === 'mock' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Servis Listesi</h2><span>Değişiklik geçmişi mock olarak korunur</span></div><Store size={18} /></header><div className="table-scroll"><table className="data-table"><thead><tr><th>Servis Adı</th><th>Tür</th><th>Telefon</th><th>Açık Dosya</th><th>Durum</th></tr></thead><tbody>{managementServices.map((service) => <tr key={service.id}><td><strong>{service.name}</strong></td><td>{service.kind}</td><td>{service.phone}</td><td>{service.openCases}</td><td><span className="status-pill status-pill--open">Aktif</span></td></tr>)}</tbody></table></div></section>}
        {/* Paket 60: şablon profilleri yalnız API modunda gerçek uçtan gelir. */}
        {activeTab === 'Excel Şablonları' && source === 'api' && (
          <Suspense fallback={<LoadingState label="Excel şablon profilleri hazırlanıyor" />}>
            <LaborExcelProfilesModule />
          </Suspense>
        )}
        {activeTab === 'Excel Şablonları' && source === 'mock' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Excel Şablon Profilleri</h2><span>Gerçek profiller yalnız API modunda gösterilir</span></div><FileCog size={18} /></header><p className="labor-empty">Şablon profilleri kullanıcı verisidir; mock modda sahte profil gösterilmez.</p></section>}
        {activeTab === 'Belge Kuralları' && <div className="management-grid"><section className="info-panel"><header><h2>Trafik</h2><FileCog size={17} /></header><p>Ana dosya türlerinden biridir. Değer Kaybı süreci zorunludur.</p><ul className="rule-list"><li>Poliçeler, ruhsatlar ve ehliyetler</li><li>Zabıt yoksa KTT veya Beyan</li><li>Zabıt yoksa Tramer Sonucu</li></ul></section><section className="info-panel"><header><h2>Kasko</h2><FileCog size={17} /></header><p>Ana dosya türlerinden biridir. Değer Kaybı isteğe bağlıdır.</p><ul className="rule-list"><li>Kasko Poliçe, SBM Ağır Hasar</li><li>K Ruhsat ve K Ehliyet</li><li>Rüculu dosyada karşı araç evrakları</li></ul></section><section className="alert-panel alert-panel--warning management-grid__wide"><ShieldCheck size={17} /><div><strong>Yalnız iki dosya türü vardır</strong><span>Değer Kaybı bağımsız dosya türü olarak oluşturulamaz.</span></div></section></div>}
        {activeTab === 'Erişim ve Yetki' && <div className="management-grid"><PermissionMatrixPanel /><section className="info-panel management-grid__wide"><header><h2>AI Güvenlik Sınırı</h2><ShieldCheck size={17} /></header><ul className="rule-list"><li>Dosya kapatamaz</li><li>Klasör taşıyamaz</li><li>E-posta gönderemez</li><li>PERT veya Değer Kaybı kararını kesinleştiremez</li></ul></section></div>}
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
