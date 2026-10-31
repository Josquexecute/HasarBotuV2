import { useMemo,useState,type ReactNode } from 'react'
import { FileClock,Mail,Search } from 'lucide-react'
import type { TrackingSnapshot } from '@hasarbotu/contracts'
import { sbmReasons,trackingTime,tramerStatuses } from './tracking-labels'

const PAGE_SIZE = 25
type Tramer = TrackingSnapshot['tramer'][number]
type Review = TrackingSnapshot['reviews'][number]
export function TrackingOperations({ data,renderTramer,renderReview }: { data: TrackingSnapshot;renderTramer: (item: Tramer) => ReactNode;renderReview: (item: Review) => ReactNode }) {
  const [tab,setTab] = useState<'tramer' | 'mail'>('tramer')
  const [search,setSearch] = useState('')
  const [filter,setFilter] = useState('all')
  const [page,setPage] = useState(1)
  const [selected,setSelected] = useState<string | null>(null)
  const rows = useMemo(() => {
    const query = search.toLocaleLowerCase('tr-TR').trim()
    const items = tab === 'tramer' ? data.tramer.map(item => ({ key: item.id,tramer: item,review: undefined })) : data.reviews.map(item => ({ key: item.id,tramer: undefined,review: item }))
    return items.filter(({ tramer,review }) => {
      const item = tramer ?? review!
      const status = tramer?.status ?? (['non_result_notification','application_notification','information_notification'].includes(review!.reason) ? 'notice' : 'review')
      return (filter === 'all' || status === filter || filter === 'pending' && ['entry_pending','result_pending'].includes(status))
        && (!query || [item.applicationNumber,item.plate,item.officeNumber,item.assignedName,tramer ? tramerStatuses[tramer.status] : sbmReasons[review!.reason],review?.email].some(value => value?.toLocaleLowerCase('tr-TR').includes(query)))
    })
  },[data.tramer,data.reviews,tab,search,filter])
  const last = Math.max(1,Math.ceil(rows.length/PAGE_SIZE)),currentPage = Math.min(page,last)
  const visible = rows.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE)
  const active = visible.find(item => item.key === selected) ?? visible[0]
  const pending = data.tramer.filter(item => ['entry_pending','result_pending'].includes(item.status)).length
  return <section className="tracking-operations" aria-label="Tramer ve e-posta kayıtları">
    <div className="tracking-operations__tabs" role="group" aria-label="Takip görünümü">
      <button type="button" aria-pressed={tab === 'tramer'} onClick={() => { setTab('tramer');setFilter('all');setPage(1) }}><FileClock size={17} />Tramer işleri <span>{data.tramer.length}</span></button>
      <button type="button" aria-pressed={tab === 'mail'} onClick={() => { setTab('mail');setFilter('all');setPage(1) }}><Mail size={17} />E-posta kontrolü <span>{data.reviews.length}</span></button>
      <small>{pending} bekleyen işlem</small>
    </div>
    <div className="tracking-operations__toolbar">
      <label className="tracking-search"><Search size={16} /><input aria-label="Takip kayıtlarında ara" placeholder="Başvuru, plaka, dosya veya sorumlu ara" value={search} onChange={e => { setSearch(e.target.value);setPage(1) }} /></label>
      <label className="tracking-filter"><span>Durum</span><select aria-label="Takip işlem durumu" value={filter} onChange={e => { setFilter(e.target.value);setPage(1) }}><option value="all">Tümü</option>{tab === 'tramer' ? <><option value="pending">Bekleyenler</option>{Object.entries(tramerStatuses).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</> : <><option value="review">Kontrol gerekenler</option><option value="notice">İhbar ve bilgilendirmeler</option></>}</select></label>
    </div>
    <div className="tracking-master-detail">
      <div className="tracking-list">
        <div className="tracking-list__heading"><span>{tab === 'tramer' ? 'Başvuru / dosya' : 'E-posta / başvuru'}</span><span>Durum · son güncelleme</span></div>
        {visible.map(({ key,tramer,review }) => {
          const item = tramer ?? review!
          return <button type="button" key={key} className="tracking-list__row" aria-pressed={active?.key === key} onClick={() => setSelected(key)}>
            <span className="tracking-list__identity"><strong>{item.plate ?? 'Dosya eşleşmesi bekliyor'}</strong><code>{item.applicationNumber ?? 'Başvuru numarası bekleniyor'}</code><small>{item.officeNumber ?? 'Dosya belirlenmedi'} · {item.assignedName ?? review?.email ?? 'Sorumlu belirlenmedi'}</small></span>
            <span className="tracking-list__state"><span className={`tracking-status tracking-status--${tramer?.status ?? 'review'}`}>{tramer ? tramerStatuses[tramer.status] : sbmReasons[review!.reason] ?? 'Kontrol gerekiyor'}</span><time>{trackingTime(tramer?.updatedAt ?? review?.receivedAt)}</time></span>
          </button>
        })}
        {!rows.length && <p className="tracking-empty">{tab === 'tramer' ? 'Tramer işi bulunmuyor.' : 'Bu görünümde e-posta bulunmuyor.'}</p>}
        <div className="tracking-list__footer"><span>{rows.length} kayıt · {currentPage} / {last}</span><div><button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage-1)}>Önceki</button><button type="button" disabled={currentPage >= last} onClick={() => setPage(currentPage+1)}>Sonraki</button></div></div>
      </div>
      <aside className="tracking-detail" aria-label="Seçili kayıt ayrıntıları">
        <h3>{active?.tramer ? 'Tramer ayrıntısı' : active?.review ? 'E-posta incelemesi' : 'Kayıt ayrıntısı'}</h3>
        {active?.tramer ? renderTramer(active.tramer) : active?.review ? renderReview(active.review) : <p className="tracking-empty">Ayrıntılar için listeden bir kayıt seçin.</p>}
      </aside>
    </div>
  </section>
}
