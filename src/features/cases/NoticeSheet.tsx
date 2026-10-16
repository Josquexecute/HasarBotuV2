import type { NoticeSheetDocuments, NoticeSheetFields, NoticeSheetResponse } from '@hasarbotu/contracts'
import { formatNoticeSheetDate, noticeSheetDocumentLabels } from './notice-sheet-fields'

function Field({ label, value, className = '' }: { label: string; value?: string | null; className?: string }) {
  return <div className={`notice-sheet__field ${className}`.trim()}><span>{label}</span><strong>{value || '\u00a0'}</strong></div>
}

export function NoticeSheet({ sheet, fields, documents }: {
  sheet: NoticeSheetResponse
  fields: NoticeSheetFields
  documents: NoticeSheetDocuments
}) {
  const traffic = sheet.caseType === 'traffic'
  const showCounterparty = traffic || [fields.victimName, fields.victimPlate, fields.victimMileage, fields.victimHeavyDamage, fields.victimPreviousClaims].some(Boolean)
  const vehicle = (victim: boolean) => <section className="notice-sheet__vehicle">
    <h3>{victim ? traffic ? 'Mağdur araç' : 'Karşı araç' : 'Sigortalı araç'}</h3>
    <Field label={victim ? 'Ad / unvan' : 'Sigortalı'} value={victim ? fields.victimName : fields.insuredName} />
    <div className="notice-sheet__row"><Field label="Plaka" value={victim ? fields.victimPlate : fields.insuredPlate} className="notice-sheet__plate" /><Field label="Kilometre" value={victim ? fields.victimMileage : fields.insuredMileage} /></div>
    <div className="notice-sheet__row"><Field label="Ağır hasar kaydı" value={victim ? fields.victimHeavyDamage : fields.insuredHeavyDamage} /><Field label="Geçmiş hasar sayısı" value={victim ? fields.victimPreviousClaims : fields.insuredPreviousClaims} /></div>
  </section>
  return <article className="notice-sheet-paper" aria-label={`${traffic ? 'Trafik' : 'Kasko'} ihbar föyü A4`}>
    <div className="notice-sheet">
      <header className="notice-sheet__header">
        <div><span className="notice-sheet__brand">{sheet.organizationName}</span><h1>İhbar Föyü <span>{traffic ? 'TRAFİK' : 'KASKO'}</span></h1><p>{sheet.insurerName || 'Sigorta şirketi belirtilmedi'}</p></div>
        <div className="notice-sheet__identity"><strong>{sheet.plate}</strong><span>Ofis dosya no</span><b>{sheet.officeNumber}</b></div>
      </header>

      <section className="notice-sheet__section">
        <div className="notice-sheet__row"><Field label="Hasar dosya no" value={sheet.claimNumber} /><Field label="İhbar föy no" value={sheet.noticeNumber} /><Field label="İhbar tarihi" value={formatNoticeSheetDate(sheet.notificationDate)} /></div>
        <div className="notice-sheet__row"><Field label="Eksper rapor no" value={fields.reportNumber} /><Field label="Hasar tarihi" value={formatNoticeSheetDate(sheet.lossDate)} /><Field label="Ekspertiz tarihi" value={formatNoticeSheetDate(fields.inspectionDate)} /></div>
        <div className="notice-sheet__row"><Field label="S. poliçe vadesi" value={fields.insuredPolicyPeriod} /><Field label="M. poliçe vadesi" value={fields.victimPolicyPeriod} /></div>
        <div className="notice-sheet__row"><Field label="Rücu durumu" value={fields.recourse} /><Field label="Muafiyet" value={fields.deductible} /></div>
        <div className="notice-sheet__row"><Field label="Sigortalı kusur durumu" value={fields.insuredFault} /><Field label="Mağdur kusur durumu" value={fields.victimFault} /></div>
      </section>

      <div className={`notice-sheet__vehicles${showCounterparty ? '' : ' notice-sheet__vehicles--single'}`}>{vehicle(false)}{showCounterparty && vehicle(true)}</div>

      <section className="notice-sheet__section">
        <h2>Servis bilgileri</h2>
        <div className="notice-sheet__row"><Field label="Servis adı" value={fields.serviceName} /><Field label="Yetkili ad soyad" value={fields.serviceContact} /><Field label="Telefon" value={fields.servicePhone} /></div>
        <Field label="Adres" value={fields.serviceAddress} />
        <Field label="Araç marka ve model" value={fields.vehicleDescription} />
      </section>

      <section className="notice-sheet__section">
        <div className="notice-sheet__row"><Field label="Tedarik" value={fields.procurement} /><Field label="Ön rapor tarihi" value={formatNoticeSheetDate(fields.preliminaryReportDate)} /></div>
        <div className="notice-sheet__row"><Field label="Tramer" value={fields.tramer} /><Field label="Kapatma tarihi" value={formatNoticeSheetDate(sheet.closureDate)} /></div>
        <Field label="IBAN" value={fields.iban} />
      </section>

      <section className="notice-sheet__section">
        <h2>Evrak kontrolü ve eksikler</h2>
        <div className="notice-sheet__document-area">
          <ul className="notice-sheet__documents">{noticeSheetDocumentLabels.map(([code, label]) => <li key={code}><span className={`notice-sheet__checkbox${documents[code] ? ' is-checked' : ''}`} aria-label={documents[code] ? 'Var' : 'İşaretlenmedi'} />{label}</li>)}</ul>
          <div className="notice-sheet__missing"><h3>Eksikler</h3><p>{fields.missingDocuments || '\u00a0'}</p></div>
        </div>
      </section>

      <section className="notice-sheet__notes"><h2>Ekspertiz çalışması</h2><p>{fields.inspectionNotes || '\u00a0'}</p></section>
      <footer className="notice-sheet__footer"><span>Eksper: {sheet.expertName || '____________________'}</span><span>{sheet.officeNumber} · {sheet.plate}</span><span>1 / 1</span></footer>
    </div>
  </article>
}
