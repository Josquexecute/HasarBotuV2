import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, Plus, RefreshCw, Save, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react'
import { formatCurrency } from '../../mocks/cases'
import { LaborAiError, createHttpLaborAiAdapter, type LaborAiDataPort, type LaborAiPlanRecord, type LaborAiRunRecord } from '../../data/laborAiPort'
import { createHttpLaborDictionaryAdapter, type LaborDictionaryDataPort, type LaborDictionaryEntryRecord } from '../../data/laborDictionaryPort'
import { LaborError, type LaborDataPort, type LaborItemInputRecord, type LaborSheetVersionRecord } from '../../data/laborPort'
import type { DataSourceKind } from '../../data/ports'
import { useLabor } from '../../data/useLabor'
import type { CaseRecord } from '../../types/case'

interface Props {
  readonly item: CaseRecord
  readonly source: DataSourceKind
  readonly onUnauthorized: () => void
  /**
   * Föy kaydedildiğinde tetiklenir. Kaynak föy değiştiği için AI dağıtım
   * önerisi stale sayılır; tüketici modülü yeniden yükler.
   */
  readonly onSheetChanged?: () => void
  readonly port?: LaborDataPort
  readonly aiPort?: LaborAiDataPort
  readonly dictionaryPort?: LaborDictionaryDataPort
}

interface EditableRow {
  description: string
  action: string
  part: string
  labor: string
  /** Paket 56 kanıt alanları; boş bırakılabilir. */
  partCode: string
  damageRegion: string
}

function formatMinor(minor: number): string {
  return formatCurrency(minor / 100)
}

/** Kullanıcı tutarını minor birime çevirir; boş alan 0 sayılır. Geçersizse null. */
function parseMinorAllowZero(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (normalized === '') return 0
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null
}

function loadMessage(status: string): string | null {
  if (status === 'loading') return 'İşçilik föyü yükleniyor…'
  if (status === 'unauthorized') return 'Oturum gerekli; mock işçilik gösterilmiyor.'
  if (status === 'forbidden') return 'Bu işlem için yetkiniz yok.'
  if (status === 'not_found') return 'Dosya bulunamadı.'
  if (status === 'unavailable') return 'İşçilik servisine ulaşılamıyor; mock fallback yapılmadı.'
  return null
}

function emptyRow(): EditableRow {
  return { description: '', action: '', part: '', labor: '', partCode: '', damageRegion: '' }
}

function rowsFromVersion(version: LaborSheetVersionRecord): EditableRow[] {
  return version.items.map((line) => ({
    description: line.description,
    action: line.action,
    part: line.partAmountMinor === 0 ? '' : String(line.partAmountMinor / 100),
    labor: line.laborAmountMinor === 0 ? '' : String(line.laborAmountMinor / 100),
    // Paket 56 kanıt alanları; eski sürümlerde boş gelir.
    partCode: line.partCode ?? '',
    damageRegion: line.damageRegion ?? '',
  }))
}

function safeMessage(error: unknown): string {
  if (error instanceof LaborError || error instanceof LaborAiError) {
    if (error.kind === 'conflict') return 'Föy veya AI planı değişti; güncel veriyle tekrar deneyin.'
    if (error.kind === 'validation') return 'Girilen kalem, işlem, tutar veya AI öneri bağı geçerli değil.'
    if (error.kind === 'forbidden') return 'Bu işlem için yetkiniz yok.'
    if (error.kind === 'unavailable') return 'Servise ulaşılamadı; mock fallback yapılmadı.'
  }
  return 'İşlem tamamlanamadı.'
}

function runStatusMessage(run: LaborAiRunRecord): string | null {
  if (run.status === 'provider_disabled') return 'AI sağlayıcısı organizasyon için kapalıdır. Çekirdek işçilik akışı AI olmadan çalışır.'
  if (run.status === 'budget_blocked') return 'Bütçe limiti nedeniyle çağrı yapılmadı.'
  if (run.status === 'failed') return 'Sağlayıcı çıktısı güvenli doğrulamadan geçemedi; öneri üretilmedi.'
  if (run.status === 'outcome_unknown') return 'Ağ sonucu belirsiz kaldı; otomatik yeniden deneme yapılmaz.'
  return null
}

export function LaborApiModule({ item, source, onUnauthorized, onSheetChanged, port, aiPort, dictionaryPort }: Props) {
  const workspace = useLabor(item.caseId, source, true, port)
  const resolvedAiPort = useMemo(() => aiPort ?? createHttpLaborAiAdapter(), [aiPort])
  const resolvedDictionaryPort = useMemo(
    () => dictionaryPort ?? createHttpLaborDictionaryAdapter(),
    [dictionaryPort],
  )
  const [dictionary, setDictionary] = useState<readonly LaborDictionaryEntryRecord[]>([])
  const busyRef = useRef(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState<EditableRow[]>([emptyRow()])
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [damageDescription, setDamageDescription] = useState('')
  const [aiPlan, setAiPlan] = useState<LaborAiPlanRecord | null>(null)
  const [aiRun, setAiRun] = useState<LaborAiRunRecord | null>(null)
  const [aiEgressConfirmed, setAiEgressConfirmed] = useState(false)
  const [appliedAiRunId, setAppliedAiRunId] = useState<string | null>(null)

  const data = workspace.data
  const sheet = data?.sheet ?? null
  const canWrite = data?.permissions.canWrite === true && data.lifecycleStatus === 'open'

  const totals = useMemo(() => {
    let part = 0
    let labor = 0
    for (const row of rows) {
      part += parseMinorAllowZero(row.part) ?? 0
      labor += parseMinorAllowZero(row.labor) ?? 0
    }
    return { part, labor, grand: part + labor }
  }, [rows])

  // Sözlük yalnız düzenleme açıkken ve API modunda yüklenir; hata sessizce
  // yutulmaz, öneri listesi boş kalır ve kullanıcı akışı engellenmez.
  useEffect(() => {
    if (source !== 'api' || !editing) return
    let cancelled = false
    resolvedDictionaryPort.list().then((result) => {
      if (!cancelled) setDictionary(result.items)
    }).catch(() => {
      if (!cancelled) setDictionary([])
    })
    return () => { cancelled = true }
  }, [editing, resolvedDictionaryPort, source])

  const run = async (label: string, operation: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(label)
    setError('')
    setNotice('')
    try {
      await operation()
    } catch (caught) {
      setError(safeMessage(caught))
      if (caught instanceof LaborError && caught.kind === 'unauthorized') onUnauthorized()
    } finally {
      busyRef.current = false
      setBusy('')
    }
  }

  const resetAiState = () => {
    setAiPlan(null)
    setAiRun(null)
    setAiEgressConfirmed(false)
    setAppliedAiRunId(null)
  }

  const startEdit = () => {
    setRows(sheet ? rowsFromVersion(sheet.currentVersion) : [emptyRow()])
    setReason('')
    setConfirmed(false)
    setError('')
    setNotice('')
    resetAiState()
    setDamageDescription('')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setError('')
    setNotice('')
    resetAiState()
  }

  const requestAiPlan = () => {
    if (damageDescription.trim().length === 0) {
      setError('AI önerisi için önce hasar tarifini girin.')
      return
    }
    void run('ai-plan', async () => {
      const next = await resolvedAiPort.plan(item.caseId, {
        damageDescription: damageDescription.trim(),
        providerId: 'gemini-generate-content',
      })
      setAiPlan(next)
      setAiRun(null)
      setAiEgressConfirmed(false)
      setNotice(next.canStart
        ? 'AI öneri planı hazırlandı. PII minimizasyonu, bütçe ve veri çıkışını kontrol edin.'
        : 'AI çağrısı yapılmadı. Sağlayıcı ve bütçe durumu aşağıda gösteriliyor.')
    })
  }

  const startAiSuggestion = () => {
    if (aiPlan === null) return
    if (aiPlan.requiresExplicitEgressConfirmation && !aiEgressConfirmed) {
      setError('Minimize edilmiş verinin harici sağlayıcıya çıkışını açıkça onaylayın.')
      return
    }
    void run('ai-start', async () => {
      const next = await resolvedAiPort.start(item.caseId, {
        damageDescription: damageDescription.trim(),
        providerId: aiPlan.providerId,
        expectedCaseVersion: aiPlan.caseVersion,
        expectedSheetVersion: aiPlan.baseSheetVersion,
        planHash: aiPlan.planHash,
        confirmed: true,
      })
      setAiRun(next)
      setNotice(next.status === 'review_required'
        ? 'İnsan incelemesi gerekli: öneriyi kontrol edip isterseniz editöre uygulayın.'
        : 'AI önerisi üretilmedi; güvenli durum aşağıda gösteriliyor.')
    })
  }

  const applyAiSuggestion = () => {
    if (aiRun === null) return
    const suggestion = aiRun.suggestion
    if (suggestion == null) return
    // AI kanıt alanlarını üretmez; mevcut satırdaki parça kodu ve hasar bölgesi
    // kullanıcı girdisidir ve öneri uygulanırken korunur.
    setRows((current) => suggestion.items.map((line, index) => ({
      description: line.description,
      action: line.action,
      part: line.partAmountMinor === 0 ? '' : String(line.partAmountMinor / 100),
      labor: line.laborAmountMinor === 0 ? '' : String(line.laborAmountMinor / 100),
      partCode: current[index]?.partCode ?? '',
      damageRegion: current[index]?.damageRegion ?? '',
    })))
    setAppliedAiRunId(aiRun.id)
    setConfirmed(false)
    setNotice('Öneri yalnız düzenleme alanlarına uygulandı; kayıt için kalemleri kontrol edip açık onay verin.')
  }

  const updateRow = (index: number, field: keyof EditableRow, value: string) => {
    setRows((current) => current.map((row, position) => position === index ? { ...row, [field]: value } : row))
  }

  /**
   * Sözlükten kalem seçildiğinde işlem ve son tutarlar öneri olarak doldurulur.
   * Yalnız boş alanlar doldurulur; kullanıcının yazdığı değer ezilmez ve
   * kaydetme her zaman ayrı açık onay ister.
   */
  const applyDictionarySuggestion = (index: number, description: string) => {
    const match = dictionary.find((entry) => entry.description === description)
    if (match === undefined) return
    setRows((current) => current.map((row, position) => {
      if (position !== index) return row
      return {
        ...row,
        description,
        action: row.action.trim() === '' ? match.action : row.action,
        part: row.part.trim() === '' && match.lastPartAmountMinor > 0
          ? String(match.lastPartAmountMinor / 100)
          : row.part,
        labor: row.labor.trim() === '' && match.lastLaborAmountMinor > 0
          ? String(match.lastLaborAmountMinor / 100)
          : row.labor,
      }
    }))
  }

  const addRow = () => setRows((current) => [...current, emptyRow()])
  const removeRow = (index: number) => setRows((current) => current.length <= 1 ? current : current.filter((_, position) => position !== index))

  const buildItems = (): readonly LaborItemInputRecord[] | null => {
    const items: LaborItemInputRecord[] = []
    for (const row of rows) {
      const description = row.description.trim()
      const action = row.action.trim()
      const partAmountMinor = parseMinorAllowZero(row.part)
      const laborAmountMinor = parseMinorAllowZero(row.labor)
      if (description === '' || action === '') {
        setError('Her satırda kalem ve işlem alanı zorunludur.')
        return null
      }
      if (partAmountMinor === null || laborAmountMinor === null) {
        setError('Parça ve işçilik tutarları geçerli sayı olmalıdır.')
        return null
      }
      if (partAmountMinor + laborAmountMinor === 0) {
        setError('Her satırda parça veya işçilik tutarından en az biri girilmelidir.')
        return null
      }
      // Kullanıcının yazdığı parça kodu her zaman `user_entered` kaynaklıdır;
      // sözlük önerisi ayrı kaynakla işaretlenir ve otomatik doğru sayılmaz.
      const partCode = row.partCode.trim()
      const damageRegion = row.damageRegion.trim()
      items.push({
        description,
        action,
        partAmountMinor,
        laborAmountMinor,
        partCode: partCode === '' ? null : partCode,
        partCodeSource: partCode === '' ? null : 'user_entered',
        damageRegion: damageRegion === '' ? null : damageRegion,
      })
    }
    return items
  }

  const save = () => {
    if (!confirmed) {
      setError('Föyün kaydedilmesini açıkça onaylayın.')
      return
    }
    if (sheet !== null && reason.trim().length === 0) {
      setError('Sürüm gerekçesi zorunludur.')
      return
    }
    const items = buildItems()
    if (items === null) return
    void run('save', async () => {
      if (sheet === null) {
        if (data === null) return
        await workspace.port.create(item.caseId, {
          expectedCaseVersion: data.caseVersion,
          items,
          laborAiSuggestionRunId: appliedAiRunId,
          confirmed: true,
        })
        setNotice('İşçilik föyü kullanıcı onayıyla kaydedildi.')
      } else {
        await workspace.port.revise(item.caseId, {
          expectedVersion: sheet.version,
          items,
          reason: reason.trim(),
          laborAiSuggestionRunId: appliedAiRunId,
          confirmed: true,
        })
        setNotice('İşçilik föyünün yeni sürümü kaydedildi.')
      }
      setEditing(false)
      setConfirmed(false)
      resetAiState()
      workspace.reload()
      onSheetChanged?.()
    })
  }

  if (source !== 'api') return null

  const message = loadMessage(workspace.status)
  if (workspace.status !== 'ok' || data === null) {
    return (
      <div className="module-placeholder">
        <Wrench size={26} />
        <h2>İşçilik</h2>
        <p>{message ?? 'İşçilik föyü hazırlanıyor…'}</p>
        <button className="button" type="button" onClick={() => workspace.reload()}><RefreshCw size={15} /> Yeniden dene</button>
      </div>
    )
  }

  return (
    <div className="module-workspace labor-module">
      <section className="info-panel module-workspace__main">
        <header>
          <h2>Parça ve İşçilik Dağılımı</h2>
          <span className={`status-pill ${sheet ? 'status-pill--open' : 'status-pill--review'}`}>
            {sheet ? `Sürüm ${sheet.version}` : 'Föy yok'}
          </span>
        </header>

        {error !== '' && <p className="form-alert form-alert--error"><AlertTriangle size={15} /> {error}</p>}
        {notice !== '' && <p className="form-alert form-alert--ok"><CheckCircle2 size={15} /> {notice}</p>}

        {!editing && (
          sheet === null
            ? <p className="labor-empty">Bu dosya için henüz kullanıcı kontrollü işçilik föyü oluşturulmadı. Kalemler AI veya Excel’den otomatik alınmaz.</p>
            : (
              <div className="table-scroll module-table-scroll">
                <table className="data-table module-table">
                  <thead><tr><th>Kalem</th><th>İşlem</th><th>Parça</th><th>İşçilik</th><th>Parça kodu</th><th>Hasar bölgesi</th></tr></thead>
                  <tbody>
                    {sheet.currentVersion.items.map((line) => (
                      <tr key={line.ordinal}>
                        <td>{line.description}</td>
                        <td>{line.action}</td>
                        <td>{formatMinor(line.partAmountMinor)}</td>
                        <td>{formatMinor(line.laborAmountMinor)}</td>
                        {/* Paket 56 öncesi sürümlerde kanıt alanları boştur. */}
                        <td className="labor-evidence-cell">
                          {line.partCode ?? '—'}
                          {line.partCodeSource === 'dictionary_suggested' && <small> (sözlük)</small>}
                        </td>
                        <td className="labor-evidence-cell">{line.damageRegion ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2}>Toplam</td>
                      <td>{formatMinor(sheet.currentVersion.totals.partTotalMinor)}</td>
                      <td>{formatMinor(sheet.currentVersion.totals.laborTotalMinor)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
        )}

        {editing && (
          <div className="labor-editor">
            {dictionary.length > 0 && (
              <>
                <p className="labor-empty">
                  Önceki onaylı föylerden türetilen {dictionary.length} kalem önerisi yazarken sunulur; seçim ve kayıt kullanıcı kontrolündedir.
                </p>
                <datalist id="labor-dictionary-descriptions">
                  {[...new Set(dictionary.map((entry) => entry.description))].map((description) => (
                    <option key={description} value={description} />
                  ))}
                </datalist>
                <datalist id="labor-dictionary-actions">
                  {[...new Set(dictionary.map((entry) => entry.action))].map((action) => (
                    <option key={action} value={action} />
                  ))}
                </datalist>
              </>
            )}
            <div className="table-scroll module-table-scroll">
              <table className="data-table module-table labor-editor__table">
                <thead><tr><th>Kalem</th><th>İşlem</th><th>Parça (₺)</th><th>İşçilik (₺)</th><th>Parça kodu</th><th>Hasar bölgesi</th><th aria-label="İşlemler" /></tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      <td><input aria-label={`Kalem ${index + 1}`} list="labor-dictionary-descriptions" value={row.description} onChange={(event) => { updateRow(index, 'description', event.target.value); applyDictionarySuggestion(index, event.target.value) }} placeholder="Ön tampon" /></td>
                      <td><input aria-label={`İşlem ${index + 1}`} list="labor-dictionary-actions" value={row.action} onChange={(event) => updateRow(index, 'action', event.target.value)} placeholder="Değişim" /></td>
                      <td><input aria-label={`Parça tutarı ${index + 1}`} value={row.part} inputMode="decimal" onChange={(event) => updateRow(index, 'part', event.target.value)} placeholder="0,00" /></td>
                      <td><input aria-label={`İşçilik tutarı ${index + 1}`} value={row.labor} inputMode="decimal" onChange={(event) => updateRow(index, 'labor', event.target.value)} placeholder="0,00" /></td>
                      <td><input aria-label={`Parça kodu ${index + 1}`} value={row.partCode} onChange={(event) => updateRow(index, 'partCode', event.target.value)} placeholder="Opsiyonel" /></td>
                      <td><input aria-label={`Hasar bölgesi ${index + 1}`} value={row.damageRegion} onChange={(event) => updateRow(index, 'damageRegion', event.target.value)} placeholder="Ön sol" /></td>
                      <td><button className="icon-button" type="button" aria-label={`Satırı sil ${index + 1}`} onClick={() => removeRow(index)} disabled={rows.length <= 1}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}>Taslak toplam</td>
                    <td>{formatMinor(totals.part)}</td>
                    <td>{formatMinor(totals.labor)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <button className="button button--secondary" type="button" onClick={addRow}><Plus size={15} /> Satır ekle</button>

            <section className="labor-ai-panel">
              <header><h3><Sparkles size={14} /> AI İşçilik Önerisi</h3></header>
              <p className="labor-empty">Öneri yalnız karar desteğidir; föye otomatik yazılmaz. Plaka ve ofis numarası sağlayıcıya gönderilmez.</p>
              <label className="form-field"><span>Hasar tarifi (AI için)</span>
                <textarea
                  value={damageDescription}
                  onChange={(event) => setDamageDescription(event.target.value)}
                  placeholder="Örnek: Ön tampon ve sol çamurluk hasarlı; far bağlantı ayağı kırık."
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <div className="labor-editor__actions">
                <button className="button" type="button" onClick={requestAiPlan} disabled={busy !== ''}>
                  <ShieldCheck size={15} /> Gizlilik ve Bütçe Planını Göster
                </button>
              </div>

              {aiPlan !== null && (
                <div className="labor-ai-plan">
                  <dl className="detail-list">
                    <div><dt>PII minimizasyonu</dt><dd>{aiPlan.privacy.externalProvider ? `${aiPlan.privacy.redactedValueCount} değer redakte edildi` : 'Yerel sağlayıcı; veri dışarı çıkmaz'}</dd></div>
                    <div><dt>Tahmini maliyet</dt><dd>{formatMinor(aiPlan.budget.estimatedCostMinor)}</dd></div>
                    <div><dt>Aylık kullanım</dt><dd>{formatMinor(aiPlan.budget.currentMonthCostMinor)} / {formatMinor(aiPlan.budget.monthlyBudgetMinor)}</dd></div>
                  </dl>
                  {aiPlan.privacy.warnings.length > 0 && (
                    <p className="form-alert form-alert--error"><AlertTriangle size={15} /> Belge/tarif içinde güvenilmeyen yönlendirme tespit edildi; bu metin yalnız veri olarak işlenir, talimat sayılmaz.</p>
                  )}
                  {!aiPlan.budget.enabled && <p className="labor-empty">AI sağlayıcısı organizasyon için kapalıdır. Çekirdek işçilik akışı AI olmadan çalışır.</p>}
                  {aiPlan.budget.enabled && !aiPlan.budget.allowed && aiPlan.budget.reasonCode === 'AI_BUDGET_EXCEEDED' && (
                    <p className="labor-empty">Bütçe limiti nedeniyle çağrı yapılmadı.</p>
                  )}
                  {aiPlan.canStart && aiPlan.requiresExplicitEgressConfirmation && (
                    <label className="email-draft-confirm labor-confirm">
                      <input type="checkbox" checked={aiEgressConfirmed} onChange={(event) => setAiEgressConfirmed(event.target.checked)} />
                      <span>PII ile minimize edilen içerik özetinin harici AI sağlayıcısına gönderilmesini onaylıyorum.</span>
                    </label>
                  )}
                  {aiPlan.canStart && (
                    <div className="labor-editor__actions">
                      <button className="button button--primary" type="button" onClick={startAiSuggestion} disabled={busy !== ''}>
                        <Sparkles size={15} /> AI Önerisini Oluştur
                      </button>
                    </div>
                  )}
                </div>
              )}

              {aiRun !== null && (
                <div className="labor-ai-run">
                  {aiRun.suggestion !== null
                    ? (
                      <>
                        <p className="form-alert form-alert--ok"><CheckCircle2 size={15} /> İnsan incelemesi gerekli — güven: %{Math.round(aiRun.suggestion.confidence * 100)}</p>
                        <div className="table-scroll module-table-scroll">
                          <table className="data-table module-table">
                            <thead><tr><th>Kalem</th><th>İşlem</th><th>Parça</th><th>İşçilik</th></tr></thead>
                            <tbody>
                              {aiRun.suggestion.items.map((line, index) => (
                                <tr key={index}>
                                  <td>{line.description}</td>
                                  <td>{line.action}</td>
                                  <td>{formatMinor(line.partAmountMinor)}</td>
                                  <td>{formatMinor(line.laborAmountMinor)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="labor-empty">{aiRun.suggestion.reasoning}</p>
                        {aiRun.suggestion.warnings.map((warning) => (
                          <p key={warning} className="labor-empty"><AlertTriangle size={12} /> {warning}</p>
                        ))}
                        <div className="labor-editor__actions">
                          <button className="button button--secondary" type="button" onClick={applyAiSuggestion} disabled={busy !== ''}>
                            Öneriyi Düzenleme Alanlarına Uygula
                          </button>
                        </div>
                      </>
                    )
                    : <p className="labor-empty">{runStatusMessage(aiRun) ?? 'AI önerisi üretilmedi.'}</p>}
                </div>
              )}
            </section>

            {sheet !== null && (
              <label className="form-field"><span>Sürüm gerekçesi</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Örnek: Parça bedeli güncellendi" maxLength={500} />
              </label>
            )}
            <label className="email-draft-confirm labor-confirm">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>Kalem, işlem ve tutarları kontrol ettim; föyün sürümlü olarak kaydedilmesini onaylıyorum.</span>
            </label>
            <div className="labor-editor__actions">
              <button className="button button--primary" type="button" onClick={save} disabled={busy !== '' || !confirmed}><Save size={15} /> {sheet === null ? 'Föyü Kaydet' : 'Yeni Sürümü Kaydet'}</button>
              <button className="button" type="button" onClick={cancelEdit} disabled={busy !== ''}>Vazgeç</button>
            </div>
          </div>
        )}

        {!editing && canWrite && (
          <div className="labor-editor__actions">
            <button className="button button--primary" type="button" onClick={startEdit}>
              {sheet === null ? 'İşçilik Föyü Oluştur' : 'Föyü Düzenle'}
            </button>
          </div>
        )}
        {!editing && !canWrite && (
          <p className="labor-empty">{data.lifecycleStatus === 'closed' ? 'Kapalı dosyanın işçilik föyü salt okunurdur.' : 'İşçilik föyünü düzenleme yetkiniz yok.'}</p>
        )}
      </section>

      <aside className="info-panel labor-side">
        <header><h2>Föy Bilgisi</h2><Wrench size={16} /></header>
        {sheet === null
          ? <p>Föy kullanıcı tarafından oluşturulur. Tutarlar minor birimde saklanır; AI önerisi ve güvenli Excel yazımı sonraki geliştirme aşamalarına bırakılmıştır.</p>
          : (
            <>
              <dl className="detail-list">
                <div><dt>Parça Toplamı</dt><dd>{formatMinor(sheet.currentVersion.totals.partTotalMinor)}</dd></div>
                <div><dt>İşçilik Toplamı</dt><dd>{formatMinor(sheet.currentVersion.totals.laborTotalMinor)}</dd></div>
                <div><dt>Genel Toplam</dt><dd>{formatMinor(sheet.currentVersion.totals.grandTotalMinor)}</dd></div>
                <div><dt>Kaydeden</dt><dd>{sheet.currentVersion.createdByDisplayName}</dd></div>
              </dl>
              <h3 className="labor-side__title"><History size={14} /> Sürüm Geçmişi</h3>
              <ul className="labor-history">
                {sheet.versions.map((version) => (
                  <li key={version.id}>
                    <strong>Sürüm {version.sheetVersion}</strong> · {formatMinor(version.totals.grandTotalMinor)}
                    <span>{version.sourceType === 'user_entered' ? 'İlk kayıt' : version.revisionReason ?? 'Düzeltme'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
      </aside>
    </div>
  )
}
