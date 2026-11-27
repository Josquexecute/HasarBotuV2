import type { ValueLossCalculatorResponse } from '@hasarbotu/contracts'
import { calculatorBreakdownRows, calculatorPartRows } from './value-loss-calculator-report'

export function ValueLossCalculationDetails({ result, onDownload }: { readonly result: ValueLossCalculatorResponse; readonly onDownload: () => void }) {
  if (!result.breakdown || result.amountMinor === null || result.issues.length) return null
  return <details className="value-loss-calculator__details"><summary>Hesap dökümü ve kaynaklar</summary>
    <dl>{calculatorBreakdownRows(result).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <div className="value-loss-calculator__table"><table><caption>Parça değerlendirmesi</caption><thead><tr>{['Parça', 'İşlem / sınıf', 'Katsayı puanı', 'Değerlendirme', 'Kaynak'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{calculatorPartRows(result).map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column}>{value}</td>)}</tr>)}</tbody></table></div>
    <p>{result.breakdown.sourceFileName}</p>
    <button className="button button--secondary" type="button" onClick={onDownload}>Hesap dökümünü indir</button>
    <small>HTML dosyasını tarayıcıda açıp yazdırabilir veya PDF olarak kaydedebilirsiniz.</small>
  </details>
}
