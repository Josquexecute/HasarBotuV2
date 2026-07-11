import { useState } from 'react'
import { CheckCircle2, FileCog, Plus, ShieldCheck, Store, UserRoundCog, UsersRound, X } from 'lucide-react'
import { managementServices, managementUsers } from '../../mocks/workspaces'

type ManagementTab = 'Kullanıcılar' | 'Servisler' | 'Belge Kuralları' | 'Erişim ve Yetki'

export function ManagementPage() {
  const [activeTab, setActiveTab] = useState<ManagementTab>('Kullanıcılar')
  const [notice, setNotice] = useState('')

  return (
    <main className="page office-page management-page">
      <section className="page-heading page-heading--compact"><div><h1>Yönetim</h1><p>Kullanıcı, servis, kural ve erişim altyapısının mock görünümü</p></div><button className="button button--primary" type="button" onClick={() => setNotice(`${activeTab} için yeni kayıt formu mock olarak hazırlandı.`)}><Plus size={15} /> Yeni Kayıt</button></section>
      <nav className="workspace-tabs" aria-label="Yönetim bölümleri">{(['Kullanıcılar', 'Servisler', 'Belge Kuralları', 'Erişim ve Yetki'] as const).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>
      <div className="office-scroll management-content">
        {activeTab === 'Kullanıcılar' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Kullanıcı ve Sorumlu Listesi</h2><span>Başlangıçta herkes tüm dosyaları görebilir</span></div><UsersRound size={18} /></header><div className="table-scroll"><table className="data-table"><thead><tr><th>Kullanıcı</th><th>Rol</th><th>Atanmış Dosya</th><th>Durum</th><th>Operasyon Yetkisi</th></tr></thead><tbody>{managementUsers.map((user) => <tr key={user.id}><td><strong>{user.name}</strong></td><td>{user.role}</td><td>{user.assigned}</td><td><span className="status-pill status-pill--open">{user.status}</span></td><td>Görüntüle · Not · Görev</td></tr>)}</tbody></table></div></section>}
        {activeTab === 'Servisler' && <section className="office-table-panel"><header className="panel-heading"><div><h2>Servis Listesi</h2><span>Değişiklik geçmişi mock olarak korunur</span></div><Store size={18} /></header><div className="table-scroll"><table className="data-table"><thead><tr><th>Servis Adı</th><th>Tür</th><th>Telefon</th><th>Açık Dosya</th><th>Durum</th></tr></thead><tbody>{managementServices.map((service) => <tr key={service.id}><td><strong>{service.name}</strong></td><td>{service.kind}</td><td>{service.phone}</td><td>{service.openCases}</td><td><span className="status-pill status-pill--open">Aktif</span></td></tr>)}</tbody></table></div></section>}
        {activeTab === 'Belge Kuralları' && <div className="management-grid"><section className="info-panel"><header><h2>Trafik</h2><FileCog size={17} /></header><p>Ana dosya türlerinden biridir. Değer Kaybı süreci zorunludur.</p><ul className="rule-list"><li>Poliçeler, ruhsatlar ve ehliyetler</li><li>Zabıt yoksa KTT veya Beyan</li><li>Zabıt yoksa Tramer Sonucu</li></ul></section><section className="info-panel"><header><h2>Kasko</h2><FileCog size={17} /></header><p>Ana dosya türlerinden biridir. Değer Kaybı isteğe bağlıdır.</p><ul className="rule-list"><li>Kasko Poliçe, SBM Ağır Hasar</li><li>K Ruhsat ve K Ehliyet</li><li>Rüculu dosyada karşı araç evrakları</li></ul></section><section className="alert-panel alert-panel--warning management-grid__wide"><ShieldCheck size={17} /><div><strong>Yalnız iki dosya türü vardır</strong><span>Değer Kaybı bağımsız dosya türü olarak oluşturulamaz.</span></div></section></div>}
        {activeTab === 'Erişim ve Yetki' && <div className="management-grid"><section className="info-panel"><header><h2>Operasyon Yetkileri</h2><UserRoundCog size={17} /></header><dl className="detail-list"><div><dt>Dosya Görüntüleme</dt><dd>Tüm kullanıcılar</dd></div><div><dt>Not ve Görev</dt><dd>Operasyon kullanıcıları</dd></div><div><dt>Kritik İşlem</dt><dd>Kullanıcı onayı</dd></div><div><dt>Audit Görünümü</dt><dd>Yönetim</dd></div></dl></section><section className="info-panel"><header><h2>AI Güvenlik Sınırı</h2><ShieldCheck size={17} /></header><ul className="rule-list"><li>Dosya kapatamaz</li><li>Klasör taşıyamaz</li><li>E-posta gönderemez</li><li>PERT veya Değer Kaybı kararını kesinleştiremez</li></ul></section></div>}
      </div>
      {notice && <button className="prototype-toast" type="button" onClick={() => setNotice('')}><CheckCircle2 size={15} />{notice}<X size={14} /></button>}
    </main>
  )
}
