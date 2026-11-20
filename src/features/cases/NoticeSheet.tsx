import { isNoticeSheetFieldVisible, type NoticeSheetDocuments, type NoticeSheetFields, type NoticeSheetResponse } from '@hasarbotu/contracts'
import { formatNoticeSheetDate } from './notice-sheet-fields'

function Field({ label, value, className = '' }: { label: string; value?: string | null; className?: string }) {
  return <div className={`notice-sheet__field ${className}`.trim()}><span>{label}</span><strong>{value || '\u00a0'}</strong></div>
}

export function NoticeSheet({ sheet, fields }: {
  sheet: NoticeSheetResponse
  fields: NoticeSheetFields
  documents: NoticeSheetDocuments
}) {
  if (sheet.caseType === null) return null
  const traffic = sheet.caseType === 'traffic'
  const visible = (field: keyof NoticeSheetFields) => isNoticeSheetFieldVisible(sheet.caseType, field)
  const vehicle = (victim: boolean) => {
    if (!visible(victim ? 'victimName' : 'insuredName')) return null
    return <section className="notice-sheet__vehicle">
      <h3>{victim ? 'Mağdur araç' : 'Sigortalı araç'}</h3>
      <div className="notice-sheet__row">
        <Field label={victim ? 'Ad / unvan' : 'Sigortalı'} value={victim ? fields.victimName : fields.insuredName} />
        <Field label="Plaka" value={victim ? fields.victimPlate : fields.insuredPlate} className="notice-sheet__plate" />
        <Field label="Tescil tarihi" value={formatNoticeSheetDate(victim ? fields.victimRegistrationDate : fields.insuredRegistrationDate)} />
      </div>
      {visible(victim ? 'victimMileage' : 'insuredMileage') && <div className="notice-sheet__row">
        <Field label="Kilometre" value={victim ? fields.victimMileage : fields.insuredMileage} />
        <Field label="Ağır hasar kaydı" value={victim ? fields.victimHeavyDamage : fields.insuredHeavyDamage} />
        <Field label="Geçmiş hasar sayısı" value={victim ? fields.victimPreviousClaims : fields.insuredPreviousClaims} />
      </div>}
    </section>
  }
  return <article className="notice-sheet-paper" aria-label={`${traffic ? 'Trafik' : 'Kasko'} ihbar föyü A4`}>
    <div className="notice-sheet">
      <header className="notice-sheet__header">
        <div><span className="notice-sheet__brand">{fields.organizationName}</span><h1>İhbar Föyü <span>{traffic ? 'TRAFİK' : 'KASKO'}</span></h1><p>{fields.insurerName || 'Sigorta şirketi belirtilmedi'}</p></div>
        <div className="notice-sheet__identity"><strong>{fields.plate}</strong><span>Ofis dosya no</span><b>{fields.officeNumber}</b></div>
      </header>

      <section className="notice-sheet__section">
        <div className="notice-sheet__row"><Field label="Hasar dosya no" value={fields.claimNumber} /><Field label="İhbar föy no" value={fields.noticeNumber} /><Field label="İhbar tarihi" value={formatNoticeSheetDate(fields.notificationDate)} /></div>
        <div className="notice-sheet__row"><Field label="Eksper rapor no" value={fields.reportNumber} /><Field label="Hasar tarihi" value={formatNoticeSheetDate(fields.lossDate)} /><Field label="Ekspertiz tarihi" value={formatNoticeSheetDate(fields.inspectionDate)} /></div>
        <div className="notice-sheet__row"><Field label="S. poliçe vadesi" value={fields.insuredPolicyPeriod} />{visible('victimPolicyPeriod') && <Field label="M. poliçe vadesi" value={fields.victimPolicyPeriod} />}</div>
        <div className="notice-sheet__row"><Field label="Rücu durumu" value={fields.recourse} /><Field label="Muafiyet" value={fields.deductible} /></div>
        <div className="notice-sheet__row"><Field label="Sigortalı kusur durumu" value={fields.insuredFault} />{visible('victimFault') && <Field label="Mağdur kusur durumu" value={fields.victimFault} />}</div>
      </section>

      <div className="notice-sheet__vehicles">{vehicle(false)}{vehicle(true)}</div>
      <section className="notice-sheet__section notice-sheet__history"><h2>{traffic ? 'Mağdur aracın geçmiş hasarları' : 'Sigortalı aracın geçmiş hasarları'}</h2><p>{(traffic ? fields.victimDamageHistory : fields.insuredDamageHistory) || '\u00a0'}</p></section>

      <section className="notice-sheet__section">
        <h2>Servis bilgileri</h2>
        <div className="notice-sheet__row"><Field label="Servis adı" value={fields.serviceName} /><Field label="Yetkili ad soyad" value={fields.serviceContact} /><Field label="Telefon" value={fields.servicePhone} /></div>
        <Field label="Adres" value={fields.serviceAddress} />
        <Field label="Araç marka ve model" value={fields.vehicleDescription} />
      </section>

      <section className="notice-sheet__section">
        <div className="notice-sheet__row"><Field label="Tedarik" value={fields.procurement} /><Field label="Ön rapor tarihi" value={formatNoticeSheetDate(fields.preliminaryReportDate)} /></div>
        <div className="notice-sheet__row"><Field label="Tramer" value={fields.tramer} /><Field label="Kapatma tarihi" value={formatNoticeSheetDate(fields.closureDate)} /></div>
      </section>

      <footer className="notice-sheet__footer"><span>Eksper: {fields.expertName || '____________________'}</span><span>{fields.officeNumber} · {fields.plate}</span><span>1 / 1</span></footer>
    </div>
  </article>
}
