import { useState } from 'react'
import { CheckCircle2, FileCog, Plus, RefreshCw, ShieldCheck, Store, UserRoundCog, UsersRound, X } from 'lucide-react'
import { managementServices, managementUsers } from '../../mocks/workspaces'
import {
  getConfiguredDataSource,
  useCaseReferences,
  type CaseReferenceDataPort,
  type CaseReferenceWorkspace,
  type DataSourceKind,
} from '../../data'

type ManagementTab = 'Kullanıcılar' | 'Servisler' | 'Belge Kuralları' | 'Erişim ve Yetki'

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

export function ManagementPage({ port }: { readonly port?: CaseReferenceDataPort } = {}) {
  const [source] = useState<DataSourceKind>(getConfiguredDataSource)
  const [activeTab, setActiveTab] = useState<ManagementTab>('Kullanıcılar')
  const [notice, setNotice] = useState('')
  const referenceTab = activeTab === 'Kullanıcılar' || activeTab === 'Servisler'

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
      <nav className="workspace-tabs" aria-label="Yönetim bölümleri">{(['Kullanıcılar', 'Servisler', 'Belge Kuralları', 'Erişim ve Yetki'] as const).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>
      <div className="office-scroll management-content">
        {referenceTab && source === 'api' && <ManagementReferenceContent activeTab={activeTab} port={port} />}
        {activeTab === 'Kullanıcılar' && source === 'mock' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Kullanıcı ve Sorumlu Listesi</h2><span>Başlangıçta herkes tüm dosyaları görebilir</span></div><UsersRound size={18} /></header><div className="table-scroll"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Atanmış Dosya</th><th>Durum</th><th>Operasyon Yetkisi</th></tr></thead><tbody>{managementUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.role}</td><td>{user.assigned}</td><td><span className="status-pill status-pill--open">{user.status}</span></td><td>Görüntüle · Not · Görev</td></tr>)}</tbody></table></div></section>}
        {activeTab === 'Servisler' && source === 'mock' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Servis Listesi</h2><span>Değişiklik geçmişi mock olarak korunur</span></div><Store size={18} /></header><div className="table-scroll"><table className="data-table"><thead><tr><th>Servis Adı</th><th>Tür</th><th>Telefon</th><th>Açık Dosya</th><th>Durum</th></tr></thead><tbody>{managementServices.map((service) => <tr key={service.id}><td><strong>{service.name}</strong></td><td>{service.kind}</td><td>{service.phone}</td><td>{service.openCases}</td><td><span className="status-pill status-pill--open">Aktif</span></td></tr>)}</tbody></table></div></section>}
        {activeTab === 'Belge Kuralları' && <div className="management-grid"><section className="info-panel"><header><h2>Trafik</h2><FileCog size={17} /></header><p>Ana dosya türlerinden biridir. Değer Kaybı süreci zorunludur.</p><ul className="rule-list"><li>Poliçeler, ruhsatlar ve ehliyetler</li><li>Zabıt yoksa KTT veya Beyan</li><li>Zabıt yoksa Tramer Sonucu</li></ul></section><section className="info-panel"><header><h2>Kasko</h2><FileCog size={17} /></header><p>Ana dosya türlerinden biridir. Değer Kaybı isteğe bağlıdır.</p><ul className="rule-list"><li>Kasko Poliçe, SBM Ağır Hasar</li><li>K Ruhsat ve K Ehliyet</li><li>Rüculu dosyada karşı araç evrakları</li></ul></section><section className="alert-panel alert-panel--warning management-grid__wide"><ShieldCheck size={17} /><div><strong>Yalnız iki dosya türü vardır</strong><span>Değer Kaybı bağımsız dosya türü olarak oluşturulamaz.</span></div></section></div>}
        {activeTab === 'Erişim ve Yetki' && <div className="management-grid"><section className="info-panel"><header><h2>Operasyon Yetkileri</h2><UserRoundCog size={17} /></header><dl className="detail-list"><div><dt>Dosya Görüntüleme</dt><dd>Tüm kullanıcılar</dd></div><div><dt>Not ve Görev</dt><dd>Operasyon kullanıcıları</dd></div><div><dt>Kritik İşlem</dt><dd>Kullanıcı onayı</dd></div><div><dt>Audit Görünümü</dt><dd>Yönetim</dd></div></dl></section><section className="info-panel"><header><h2>AI Güvenlik Sınırı</h2><ShieldCheck size={17} /></header><ul className="rule-list"><li>Dosya kapatamaz</li><li>Klasör taşıyamaz</li><li>E-posta gönderemez</li><li>PERT veya Değer Kaybı kararını kesinleştiremez</li></ul></section></div>}
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
