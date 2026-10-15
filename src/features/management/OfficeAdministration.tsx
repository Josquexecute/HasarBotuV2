import { useEffect, useState } from 'react'
import { managedServicesSchema,managedDocumentRulesSchema,rolePolicySchema,PERMISSION_DEFINITIONS,type RolePolicy,type DocumentRuleConfiguration } from '@hasarbotu/contracts'
import { CANONICAL_DOCUMENT_TYPES,CANONICAL_DOCUMENT_LABELS } from '@hasarbotu/domain'
import { trackingRequest } from '../tracking/trackingApi'
import { managedInsurersSchema } from '@hasarbotu/contracts'

const ROLES = ['admin','expert','case_manager','secretary','accounting','read_only'] as const
const ROLE_LABELS = ['Yönetici','Eksper','Sorumlu','Sekreter','Muhasebe','Okuyucu']
const SERVICE_TYPES = { authorized: 'Yetkili',private: 'Özel',glass: 'Cam',mobile: 'Mobil',other: 'Diğer' }
type Service = ReturnType<typeof managedServicesSchema.parse>['items'][number]
type Rule = ReturnType<typeof managedDocumentRulesSchema.parse>['items'][number]
function useAdministration<T>(path: string,schema: { parse(value: unknown): T }) {
  const [data,setData] = useState<T | null>(null)
  const [error,setError] = useState('')
  const [version,setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void trackingRequest(`administration/${path}`,undefined,controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(schema.parse(value));setError('') }
    }).catch((e: unknown) => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Veriler alınamadı.') })
    return () => controller.abort()
  },[path,schema,version])
  return { data,error,reload: () => setVersion((value) => value+1) }
}
type Insurer = ReturnType<typeof managedInsurersSchema.parse>['items'][number]
export function InsurersAdministration() {
  const { data,error,reload } = useAdministration('insurers',managedInsurersSchema)
  const [editing,setEditing] = useState<Insurer | 'new' | null>(null)
  const [removing,setRemoving] = useState<Insurer | null>(null)
  const [showDeleted,setShowDeleted] = useState(false)
  const [busy,setBusy] = useState(false)
  const [actionError,setActionError] = useState('')
  const [notice,setNotice] = useState('')
  async function remove() {
    if (!removing || busy) return
    setBusy(true);setActionError('')
    try {
      await trackingRequest(`administration/insurers/${removing.id}/delete`,{ expectedVersion: removing.version })
      setNotice(`${removing.name} seçim listesinden kaldırıldı. Geçmiş dosya kayıtları korundu.`)
      setRemoving(null);reload()
    } catch (e) { setActionError(e instanceof Error ? e.message : 'Şirket silinemedi.') }
    finally { setBusy(false) }
  }
  return <section className="office-table-panel" aria-label="Sigorta şirketleri yönetimi"><header className="panel-heading"><h2>Sigorta Şirketleri</h2><div className="tracking-actions"><button className="button button--secondary" disabled={busy} onClick={reload}>Yenile</button><button className="button button--primary" disabled={busy || !!removing} onClick={() => { setEditing('new');setNotice('') }}>Sigorta şirketi ekle</button></div></header>
    <p>Şirketleri düzenleyebilir veya seçim listesinden silebilirsiniz. Geçmiş dosyalardaki bağlantılar korunur.</p>
    <label><input type="checkbox" checked={showDeleted} onChange={event => setShowDeleted(event.target.checked)} /> Silinen şirketleri göster</label>
    {(error || actionError) && <p role="alert">{actionError || error}</p>}{notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">Sigorta şirketleri yükleniyor…</p>}
    {editing && <InsurerForm key={editing === 'new' ? editing : `${editing.id}:${editing.version}`} item={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null);setNotice('Sigorta şirketi kaydedildi.');reload() }} />}
    {removing && <div role="alertdialog" aria-label="Sigorta şirketini sil"><p>{removing.name} seçim listesinden kaldırılsın mı? Geçmiş dosyalardaki kayıtları korunacaktır.</p><div className="tracking-actions"><button className="button button--primary" disabled={busy} onClick={() => void remove()}>{busy ? 'Siliniyor…' : 'Silmeyi onayla'}</button><button className="button button--secondary" disabled={busy} onClick={() => { setRemoving(null);setActionError('') }}>Vazgeç</button></div></div>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Sigorta şirketi</th><th>Durum</th><th>İşlemler</th></tr></thead><tbody>{data?.items.filter(item => showDeleted || item.isActive).map(item => <tr key={item.id}><td>{item.name}</td><td>{item.isActive ? 'Aktif' : 'Silinmiş'}</td><td><div className="tracking-actions"><button className="button button--secondary" disabled={busy || !!removing} aria-label={`${item.name} şirketini düzenle`} onClick={() => { setEditing(item);setNotice('') }}>Düzenle</button>{item.isActive && <button className="button button--secondary" disabled={busy || !!editing || !!removing} aria-label={`${item.name} şirketini sil`} onClick={() => { setRemoving(item);setActionError('');setNotice('') }}>Sil</button>}</div></td></tr>)}</tbody></table></div>
  </section>
}
function InsurerForm({ item,onCancel,onSaved }: { item?: Insurer;onCancel(): void;onSaved(): void }) {
  const [name,setName] = useState(item?.name ?? '')
  const [active,setActive] = useState(item?.isActive ?? true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  async function save() {
    if (busy) return
    setBusy(true);setError('')
    try { await trackingRequest(`administration/insurers${item ? `/${item.id}` : ''}`,{ name: name.trim(),isActive: active,...(item ? { expectedVersion: item.version } : {}) });onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Şirket kaydedilemedi.') }
    finally { setBusy(false) }
  }
  return <form className="administration-form" aria-label="Sigorta şirketi düzenleme" onSubmit={event => { event.preventDefault();void save() }}><h3>{item ? 'Şirketi düzenle' : 'Yeni sigorta şirketi'}</h3><fieldset disabled={busy}><label className="settings-field"><span>Şirket adı</span><input autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /> Aktif</label></fieldset>{error && <p role="alert">{error}</p>}<div className="tracking-actions"><button className="button button--primary" disabled={busy || !name.trim()}>{busy ? 'Kaydediliyor…' : 'Şirketi kaydet'}</button><button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Vazgeç</button></div></form>
}
export function ServicesAdministration() {
  const { data,error,reload } = useAdministration('services',managedServicesSchema)
  const [editing,setEditing] = useState<Service | 'new' | null>(null)
  return <section className="office-table-panel"><header className="panel-heading"><h2>Servisler</h2><div className="tracking-actions"><button className="button button--secondary" onClick={reload}>Yenile</button><button className="button button--primary" onClick={() => setEditing('new')}>Servis ekle</button></div></header>
    {error && <p role="alert">{error}</p>}
    {editing && <ServiceForm key={typeof editing === 'string' ? editing : `${editing.id}:${editing.version}`} item={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null);reload() }} />}
    {!data && !error && <p role="status">Servisler yükleniyor…</p>}
    <div className="table-scroll"><table className="data-table"><thead><tr><th>Servis</th><th>Tür</th><th>Telefon</th><th>Durum</th><th></th></tr></thead><tbody>{data?.items.map((item) => <tr key={item.id}><td>{item.name}</td><td>{SERVICE_TYPES[item.serviceType]}</td><td>{item.phone || '—'}</td><td>{item.isActive ? 'Aktif' : 'Pasif'}</td><td><button className="button button--secondary" onClick={() => setEditing(item)} aria-label={`${item.name} servisini düzenle`}>Düzenle</button></td></tr>)}</tbody></table></div>
  </section>
}
function ServiceForm({ item,onCancel,onSaved }: { item?: Service;onCancel(): void;onSaved(): void }) {
  const [name,setName] = useState(item?.name ?? '')
  const [type,setType] = useState<Service['serviceType']>(item?.serviceType ?? 'private')
  const [phone,setPhone] = useState(item?.phone ?? '')
  const [active,setActive] = useState(item?.isActive ?? true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  async function save() {
    if (busy) return
    setBusy(true);setError('')
    try {
      await trackingRequest(`administration/services${item ? `/${item.id}` : ''}`,{ name: name.trim(),serviceType: type,phone: phone.trim() || null,isActive: active,...(item ? { expectedVersion: item.version } : {}) })
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Servis kaydedilemedi.') }
    finally { setBusy(false) }
  }
  return <form className="administration-form" aria-label="Servis düzenleme" onSubmit={(event) => { event.preventDefault();void save() }}>
    <h3>{item ? 'Servisi düzenle' : 'Yeni servis'}</h3><div className="settings-grid">
      <label className="settings-field"><span>Servis adı</span><input required maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="settings-field"><span>Servis türü</span><select value={type} onChange={(event) => setType(event.target.value as Service['serviceType'])}>{Object.entries(SERVICE_TYPES).map(([code,label]) => <option key={code} value={code}>{label}</option>)}</select></label>
      <label className="settings-field"><span>Telefon</span><input type="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <label><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /> Aktif</label>
    </div>{error && <p role="alert">{error}</p>}<div className="tracking-actions"><button className="button button--primary" disabled={busy || !name.trim()}>{busy ? 'Kaydediliyor…' : 'Servisi kaydet'}</button><button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Vazgeç</button></div>
  </form>
}
export function DocumentRulesAdministration({ canEdit }: { canEdit: boolean }) {
  const { data,error,reload } = useAdministration('document-rules',managedDocumentRulesSchema)
  return <section aria-label="Belge kuralları"><header className="panel-heading"><h2>Belge kuralları</h2><button className="button button--secondary" onClick={reload}>Yenile</button></header>{error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Kurallar yükleniyor…</p>}<div className="management-grid">{data?.items.map((item) => <RuleForm key={item.versionId} item={item} canEdit={canEdit} onSaved={reload} />)}</div></section>
}
function RuleForm({ item,canEdit,onSaved }: { item: Rule;canEdit: boolean;onSaved(): void }) {
  const [config,setConfig] = useState<DocumentRuleConfiguration>(item.configuration)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const dirty = JSON.stringify(config) !== JSON.stringify(item.configuration)
  const documents = CANONICAL_DOCUMENT_TYPES.filter((type) => !['accident_report','ktt','statement','tramer_result','opposing_vehicle_registration','opposing_driver_license','opposing_traffic_policy','fault_ratio'].includes(type))
  async function save() {
    if (busy || !canEdit) return
    setBusy(true);setError('')
    try { await trackingRequest(`administration/document-rules/${item.caseType}`,{ expectedVersionId: item.versionId,configuration: config });onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Kural kaydedilemedi.') }
    finally { setBusy(false) }
  }
  return <form className="info-panel administration-form" onSubmit={(event) => { event.preventDefault();void save() }}><h3>{item.caseType === 'traffic' ? 'Trafik' : 'Kasko'}</h3>
    <fieldset disabled={!canEdit || busy}><legend>Zorunlu evraklar</legend>{documents.map((type) => <label className="rule-toggle" key={type}><input type="checkbox" checked={config.baseRequired.includes(type)} onChange={(event) => setConfig({ ...config,baseRequired: event.target.checked ? [...config.baseRequired,type] : config.baseRequired.filter((value) => value !== type) })} />{CANONICAL_DOCUMENT_LABELS[type]}</label>)}</fieldset>
    <fieldset disabled={!canEdit || busy}><legend>Koşullu kontroller</legend>{([['incidentEvidenceRequired','KTT / Beyan / Zabıt'],...(item.caseType === 'traffic' ? [['tramerWithoutReportRequired','Zabıt yoksa Tramer']] : [['recourseDocumentsRequired','Rücu evrakları']])] as Array<[Exclude<keyof DocumentRuleConfiguration,'baseRequired'>,string]>).map(([key,label]) => <label className="rule-toggle" key={key}><input type="checkbox" checked={config[key]} onChange={(event) => setConfig({ ...config,[key]: event.target.checked })} />{label}</label>)}</fieldset>
    {error && <p role="alert">{error}</p>}{canEdit && <button className="button button--primary" disabled={!dirty || busy}>{busy ? 'Kaydediliyor…' : 'Kuralları kaydet'}</button>}
  </form>
}
export function PermissionsAdministration({ canEdit }: { canEdit: boolean }) {
  const { data,error,reload } = useAdministration('permissions',rolePolicySchema)
  return <section className="office-table-panel"><header className="panel-heading"><h2>Erişim ve yetkiler</h2><button className="button button--secondary" onClick={reload}>Yenile</button></header>{error && <p role="alert">{error}</p>}{!data && !error && <p role="status">Yetkiler yükleniyor…</p>}{data && <PermissionsForm key={data.version} policy={data} canEdit={canEdit} onSaved={reload} />}</section>
}
function PermissionsForm({ policy,canEdit,onSaved }: { policy: RolePolicy;canEdit: boolean;onSaved(): void }) {
  const [permissions,setPermissions] = useState(policy.permissions)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  async function save() {
    if (busy || !canEdit) return
    setBusy(true);setError('')
    try { await trackingRequest('administration/permissions',{ expectedVersion: policy.version,permissions });window.dispatchEvent(new Event('permissions-updated'));onSaved() }
    catch (e) { setError(e instanceof Error ? e.message : 'Yetkiler kaydedilemedi.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={(event) => { event.preventDefault();void save() }}><div className="table-scroll"><table className="data-table"><thead><tr><th>İşlem</th>{ROLE_LABELS.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{PERMISSION_DEFINITIONS.map((definition) => <tr key={definition.code}><td>{definition.label}</td>{ROLES.map((role,i) => {
    const available = (definition.roles as readonly string[]).includes(role)
    return <td key={role}><input type="checkbox" aria-label={`${definition.label} · ${ROLE_LABELS[i]}`} checked={permissions[definition.code].includes(role)} disabled={!canEdit || busy || role === 'admin' || !available} title={!available ? 'İlgili işlemi yapmak için kullanıcıya uygun rol atayın.' : undefined} onChange={(event) => setPermissions({ ...permissions,[definition.code]: event.target.checked ? [...permissions[definition.code],role] : permissions[definition.code].filter((value) => value !== role) })} /></td>
  })}</tr>)}</tbody></table></div>{error && <p role="alert">{error}</p>}{canEdit && <button className="button button--primary" disabled={busy || JSON.stringify(permissions) === JSON.stringify(policy.permissions)}>{busy ? 'Kaydediliyor…' : 'Yetkileri kaydet'}</button>}</form>
}
