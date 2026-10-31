export const tramerStatuses = { entry_pending: 'Giriş bekleniyor',result_pending: 'Sonuç bekleniyor',completed: 'Tamamlandı',cancelled: 'İptal edildi' }
export const sbmReasons: Record<string,string> = {
  untrusted_sender: 'Gönderen doğrulanamadı',ambiguous_number: 'Başvuru numarası belirsiz',ambiguous_result: 'Sonuç belirsiz',
  unmatched_number: 'Numara eşleşmedi',number_registered_after_message: 'Numara kaydedilmeden önce gelmiş; kontrol gerekiyor',
  parser_not_validated: 'Otomatik sonuç işleme kapalı',conflicting_or_terminal_result: 'Sonuç mevcut durumla çelişiyor',
  non_result_notification: 'KTT giriş ihbarı',unsupported_result: 'Sonuç biçimi kontrol gerektiriyor',
  attachment_requires_review: 'Ek içeren e-posta; kontrol gerekiyor',quoted_result_requires_review: 'Alıntı geçmişi içeriyor',
  incomplete_message: 'E-posta içeriği eksik veya çok uzun',rejection_notification: 'Başvuru ret bildirimi',
  cancellation_requires_review: 'İptal bildirimi; kontrol gerekiyor',application_notification: 'Başvuru alındı bildirimi',
  information_notification: 'Bilgilendirme e-postası',message_predates_request: 'İşlemden önce gönderilmiş sonuç',archived_case: 'Dosya arşivlenmiş',
}
export const trackingTime = (value?: string | null) => value ? new Date(value).toLocaleString('tr-TR',{ day: '2-digit',month: '2-digit',year: 'numeric',hour: '2-digit',minute: '2-digit' }) : 'Henüz yok'
