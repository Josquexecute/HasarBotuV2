const REQUIRED = ['Plaka', 'Marka', 'Araç Tipi', 'Model Yılı', 'Araç Tarife Grubu', 'Motor No', 'Şasi No']
export function EksistVehicleFields({ fields }: { fields: Readonly<Record<string, string>> }) {
  const missing = REQUIRED.filter(label => !fields[label])
  return <section className="info-panel"><h3>Eksper atanacak araç bilgileri</h3>
    {missing.length > 0 && <p role="alert">Kaynakta eksik araç bilgileri: {missing.join(', ')}. Eksiksiz belgeyi yeniden aktarın.</p>}
    <dl className="overview-fields">{Object.entries(fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd style={{ overflowWrap: 'anywhere' }}>{value}</dd></div>)}</dl>
  </section>
}
