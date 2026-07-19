import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, FileSpreadsheet, History, Plus } from 'lucide-react'
import { LoadingState } from '../../components/StateViews'
import {
  LaborExcelProfileClientError,
  createHttpLaborExcelProfileAdapter,
  type LaborExcelProfileDataPort,
  type LaborExcelProfileRecord,
} from '../../data'

/**
 * Paket 60 — Excel şablon profilleri yönetimi.
 *
 * Sütunlar ve eşleme tamamen KULLANICI verisidir; hiçbir sigorta şirketinin
 * kolon seti ürüne gömülü değildir. Profiller sürümlüdür: ilk kayıt gerekçe
 * istemez, sonraki her sürüm ister.
 *
 * Bu ekran hiçbir Excel dosyası yazmaz; yalnız eşlemeyi tanımlar.
 */
const OPERATION_TYPES = [
  'repair',
  'replace',
  'remove_install',
  'paint',
  'consumable',
  'calibration',
  'related_operation',
  'other',
] as const

const OPERATION_LABELS: Record<string, string> = {
  repair: 'Onarım',
  replace: 'Değişim',
  remove_install: 'Sökme-takma',
  paint: 'Boya',
  consumable: 'Sarf',
  calibration: 'Ayar/kalibrasyon',
  related_operation: 'İlişkili operasyon',
  other: 'Diğer',
}

const UNMAPPED = ''

function emptyMapping(): Record<string, string> {
  return Object.fromEntries(OPERATION_TYPES.map((type) => [type, UNMAPPED]))
}

export function LaborExcelProfilesModule({ port }: {
  readonly port?: LaborExcelProfileDataPort
}) {
  const adapter = useMemo(() => port ?? createHttpLaborExcelProfileAdapter(), [port])
  const [profiles, setProfiles] = useState<readonly LaborExcelProfileRecord[]>([])
  const [canWrite, setCanWrite] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [errorKind, setErrorKind] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [columnsText, setColumnsText] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>(emptyMapping)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const result = await adapter.list()
      setProfiles(result.profiles)
      setCanWrite(result.permissions.canWrite)
      setStatus('ok')
    } catch (error) {
      setProfiles([])
      setErrorKind(error instanceof LaborExcelProfileClientError ? error.kind : 'unavailable')
      setStatus('error')
    }
  }, [adapter])

  useEffect(() => { void load() }, [load])

  /** Sütunlar satır başına "ANAHTAR = Başlık" biçiminde girilir. */
  const parsedColumns = useMemo(() => columnsText
    .split('\n')
    .map((row) => row.trim())
    .filter((row) => row.length > 0)
    .map((row) => {
      const separator = row.indexOf('=')
      const key = (separator === -1 ? row : row.slice(0, separator)).trim()
      const label = separator === -1 ? row.trim() : row.slice(separator + 1).trim()
      return { key, label }
    })
    .filter((column) => column.key.length > 0 && column.label.length > 0), [columnsText])

  const columnKeys = useMemo(
    () => parsedColumns.map((column) => column.key.toUpperCase().replace(/\s+/g, '_')),
    [parsedColumns],
  )

  const startNew = () => {
    setEditing('new')
    setName('')
    setColumnsText('ISCILIK = İşçilik Bedeli\nPARCA = Parça Bedeli')
    setMapping(emptyMapping())
    setReason('')
    setErrorKind(null)
  }

  const startEdit = (profile: LaborExcelProfileRecord) => {
    setEditing(profile.id)
    setName(profile.current.name)
    setColumnsText(profile.current.columns.map((column) => `${column.key} = ${column.label}`).join('\n'))
    setMapping(Object.fromEntries(
      OPERATION_TYPES.map((type) => [type, profile.current.mapping[type] ?? UNMAPPED]),
    ))
    setReason('')
    setErrorKind(null)
  }

  const target = profiles.find((profile) => profile.id === editing) ?? null
  const isRevision = editing !== null && editing !== 'new'
  const mappedCount = OPERATION_TYPES.filter((type) => mapping[type] !== UNMAPPED).length
  const canSubmit = name.trim() !== ''
    && parsedColumns.length > 0
    && mappedCount > 0
    && (!isRevision || reason.trim() !== '')

  const save = async () => {
    setBusy(true)
    try {
      await adapter.save({
        profileId: isRevision ? editing : null,
        fields: {
          name: name.trim(),
          insurerId: null,
          columns: parsedColumns.map((column, index) => ({
            key: columnKeys[index] as string,
            label: column.label,
          })),
          mapping: Object.fromEntries(OPERATION_TYPES.map((type) => [
            type,
            mapping[type] === UNMAPPED ? null : (mapping[type] as string),
          ])) as never,
        },
        expectedVersion: isRevision ? (target?.version ?? null) : null,
        reason: isRevision ? reason.trim() : null,
      })
      setEditing(null)
      setErrorKind(null)
      await load()
    } catch (error) {
      setErrorKind(error instanceof LaborExcelProfileClientError ? error.kind : 'unavailable')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <LoadingState label="Excel şablon profilleri yükleniyor" />
  if (status === 'error') {
    return (
      <div className="dashboard-state" role="alert">
        <AlertTriangle size={24} />
        <strong>Şablon profilleri alınamadı</strong>
        <span>API veya ağ bağlantısını kontrol edin. Sahte veri gösterilmiyor.</span>
      </div>
    )
  }

  return (
    <section className="office-table-panel">
      <header className="panel-heading">
        <div>
          <h2>Excel Şablon Profilleri</h2>
          <span>
            Kanonik operasyon türlerini kendi Excel sütunlarınıza eşler.
            Bu ekran Excel dosyası yazmaz.
          </span>
        </div>
        <FileSpreadsheet size={18} />
      </header>

      {canWrite && editing === null && (
        <div className="excel-profile__actions">
          <button className="button button--primary" type="button" onClick={startNew}>
            <Plus size={15} /> Yeni Şablon Profili
          </button>
        </div>
      )}

      {errorKind !== null && (
        <p className="allocation-panel__error" role="alert">
          İşlem tamamlanamadı ({errorKind}).
        </p>
      )}

      {editing !== null && (
        <div className="excel-profile__form">
          <label className="field">
            <span>Profil adı</span>
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="field">
            <span>Sütunlar (her satır: ANAHTAR = Başlık)</span>
            <textarea
              rows={4}
              value={columnsText}
              onChange={(event) => setColumnsText(event.target.value)}
            />
            <small>{parsedColumns.length} sütun tanımlandı.</small>
          </label>

          <div className="excel-profile__mapping">
            <strong>Operasyon türü → sütun eşlemesi</strong>
            {OPERATION_TYPES.map((type) => (
              <label className="select-field" key={type}>
                <span className="select-field__label">{OPERATION_LABELS[type] ?? type}</span>
                <select
                  aria-label={`${OPERATION_LABELS[type] ?? type} sütunu`}
                  value={mapping[type] ?? UNMAPPED}
                  onChange={(event) => setMapping((current) => ({
                    ...current, [type]: event.target.value,
                  }))}
                >
                  <option value={UNMAPPED}>Eşlenmedi</option>
                  {columnKeys.map((key, index) => (
                    <option key={key} value={key}>{parsedColumns[index]?.label ?? key}</option>
                  ))}
                </select>
              </label>
            ))}
            <small>
              Eşlenmeyen tür projeksiyonda sütuna yazılmaz ve satır incelemeye düşer.
            </small>
          </div>

          {isRevision && (
            <label className="field">
              <span>Değişiklik gerekçesi</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          )}

          <div className="excel-profile__actions">
            <button className="button button--secondary" type="button" onClick={() => setEditing(null)}>
              Vazgeç
            </button>
            <button
              className="button button--primary"
              type="button"
              disabled={busy || !canSubmit}
              onClick={() => void save()}
            >
              {isRevision ? 'Yeni Sürüm Kaydet' : 'Profili Kaydet'}
            </button>
          </div>
        </div>
      )}

      {profiles.length === 0 && editing === null && (
        <p className="labor-empty">
          Henüz şablon profili tanımlanmadı. Profiller kullanıcı tanımlıdır; hiçbir
          sigorta şirketi kolonu önceden gömülü değildir.
        </p>
      )}

      {profiles.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Profil</th><th>Sürüm</th><th>Sütun</th><th>Eşlenen tür</th>
                <th>Oluşturan</th><th aria-label="İşlemler" />
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => {
                const mapped = OPERATION_TYPES.filter(
                  (type) => profile.current.mapping[type] !== null,
                ).length
                return (
                  <tr key={profile.id}>
                    <td><strong>{profile.current.name}</strong></td>
                    <td>Sürüm {profile.version}</td>
                    <td>{profile.current.columns.length}</td>
                    <td>{mapped}/{OPERATION_TYPES.length}</td>
                    <td>{profile.createdByDisplayName}</td>
                    <td>
                      {canWrite && (
                        <button className="text-button" type="button" onClick={() => startEdit(profile)}>
                          Düzenle
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {profiles.some((profile) => profile.history.length > 1) && (
        <details className="excel-profile__history">
          <summary><History size={13} aria-hidden="true" /> Sürüm geçmişi</summary>
          <ul>
            {profiles.flatMap((profile) => profile.history
              .filter((version) => version.revisionReason !== null)
              .map((version) => (
                <li key={version.id}>
                  <strong>{profile.current.name} · Sürüm {version.profileVersion}</strong>
                  <small>{version.revisionReason}</small>
                </li>
              )))}
          </ul>
        </details>
      )}
    </section>
  )
}
