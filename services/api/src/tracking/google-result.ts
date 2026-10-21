import type { FastifyInstance, FastifyReply } from 'fastify'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const clientSchema = z.enum(['web', 'field', 'desktop'])
const purposeSchema = z.enum(['login', 'mail'])
const outcomeSchema = z.enum(['success', 'pending', 'approval', 'denied', 'expired', 'failed'])
export type GoogleClient = z.infer<typeof clientSchema>
export type GoogleOutcome = z.infer<typeof outcomeSchema>

export function googleResultPath(client: GoogleClient, purpose: 'login' | 'mail', outcome: GoogleOutcome): string {
  return `/api/v1/google/result/${client}/${purpose}/${outcome}`
}

export function redirectGoogleResult(reply: FastifyReply, client: GoogleClient, purpose: 'login' | 'mail', outcome: GoogleOutcome) {
  return reply.code(303).header('location', googleResultPath(client, purpose, outcome)).send()
}

const messages: Record<GoogleOutcome, { title: string; description: string; detail: string; symbol: string }> = {
  success: { title: 'Her şey hazır.', description: 'Google doğrulaması başarıyla tamamlandı.', detail: 'HasarBotu açık oturumunuzu otomatik olarak güncelliyor. Bu sekme kapanmazsa aşağıdaki düğmeyle uygulamaya dönebilirsiniz.', symbol: '<path d="m17 32 10 10 21-23"/>' },
  pending: { title: 'Güvenle bağlanıyoruz.', description: 'Google onay ekranı hazırlanıyor.', detail: 'Açılan Google ekranında hesabınızı seçin ve izinleri kontrol edin. Bu sayfada kaldıysanız HasarBotu’ya dönerek yeniden deneyin.', symbol: '<path d="M32 12a20 20 0 1 1-20 20"/>' },
  approval: { title: 'Hesabınız onay bekliyor.', description: 'Google hesabınız doğrulandı ve kayıt isteğiniz alındı.', detail: 'Yöneticiniz hesabınızı onaylayıp rol atadıktan sonra giriş yapabilirsiniz. Şu anda bir uygulama oturumu açılmadı.', symbol: '<circle cx="32" cy="32" r="20"/><path d="M32 20v13l9 5"/>' },
  denied: { title: 'İzin verilmedi.', description: 'Google bağlantısı tamamlanmadı.', detail: 'İşlem iptal edilmiş veya hesabınızın erişimine izin verilmemiş olabilir. HasarBotu’ya dönüp uygun hesabınızla yeniden deneyebilirsiniz.', symbol: '<circle cx="32" cy="32" r="20"/><path d="m18 18 28 28"/>' },
  expired: { title: 'Bu isteğin süresi doldu.', description: 'Güvenli giriş bağlantısı artık kullanılamıyor.', detail: 'Bağlantı daha önce kullanılmış da olabilir. HasarBotu’ya dönerek yeni bir giriş veya hesap bağlama işlemi başlatın.', symbol: '<circle cx="32" cy="32" r="20"/><path d="M32 20v13l9 5"/>' },
  failed: { title: 'Bağlantı tamamlanamadı.', description: 'Google doğrulaması sırasında bir sorun oluştu.', detail: 'Bağlantınızı ve hesap izinlerinizi kontrol ederek HasarBotu’dan yeniden deneyin. Sorun sürerse yöneticinize başvurun.', symbol: '<path d="m32 10 25 44H7Z"/><path d="M32 24v13m0 8v1"/>' },
}

// Presentation only: these public pages never read a flow, issue a session or accept OAuth credentials.
export function registerGoogleResultRoutes(app: FastifyInstance): void {
  app.get('/api/v1/google/result/:client/:purpose/:outcome', { logLevel: 'silent' }, async (request, reply) => {
    void reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff')
    const params = z.object({ client: clientSchema, purpose: purposeSchema, outcome: outcomeSchema }).safeParse(request.params)
    if (!params.success) return reply.code(404).send()
    const { client, purpose, outcome } = params.data
    if (request.url.includes('?')) return redirectGoogleResult(reply, client, purpose, outcome)
    const nonce = randomBytes(24).toString('base64url')
    void reply.header('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
    const message = messages[outcome]
    const returnUrl = client === 'desktop' ? 'hasarbotu://oauth/return' : client === 'field' ? '/saha' : '/'
    return reply.type('text/html; charset=utf-8').send(`<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>${message.title} · HasarBotu</title>
<style nonce="${nonce}">
*{box-sizing:border-box}html{min-height:100%;background:#090d19;color:#f4f6ff;font-family:"Segoe UI Variable","Segoe UI",Arial,sans-serif}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:32px 20px;background:radial-gradient(ellipse at 20% 0%,#24356c66,transparent 55%),radial-gradient(ellipse at 100% 100%,#43367444,transparent 55%)}main{width:min(100%,520px)}.brand{display:flex;align-items:center;justify-content:center;gap:12px;margin-bottom:36px;font-size:21px;font-weight:650;letter-spacing:-.5px}.brand svg{width:44px;height:44px}.brand span span{color:#9caed8;font-weight:400}.card{text-align:center;padding:44px 36px 32px;border:1px solid #53658e55;border-radius:28px;background:linear-gradient(145deg,#1d2940bb,#101827ed);box-shadow:0 32px 100px #0005,inset 0 1px #ffffff12}.eyebrow{margin:24px 0 12px;color:#abbce4;font-size:12px;letter-spacing:1.8px;font-weight:600;text-transform:uppercase}.icon{display:grid;place-items:center;width:96px;height:96px;margin:auto;border-radius:50%;color:#8eacff;background:linear-gradient(140deg,#314d8033,#526ce511);border:1px solid #7a9fff55;animation:arrive .6s ease-out}.icon svg{width:64px;height:64px;fill:none;stroke:currentColor;stroke-width:3.5;stroke-linecap:round;stroke-linejoin:round}.success .icon{color:#83ecc3;background:linear-gradient(140deg,#266a5c44,#287c6011);border-color:#74e0b955;box-shadow:0 0 60px #49dca51a}.success .icon path{stroke-dasharray:48;stroke-dashoffset:48;animation:check .7s .2s ease-out forwards}.denied .icon,.failed .icon{color:#ffb2b2;border-color:#e9969655}.approval .icon,.expired .icon{color:#f6d48a;border-color:#e3c17355}.pending .icon svg{animation:spin 2s linear infinite}h1{margin:0 0 16px;font-size:clamp(26px,6vw,34px);line-height:1.18;letter-spacing:-1px}p{font-size:15px;line-height:1.65;color:#b9c5df;margin:0 0 12px}.description{color:#e2e9fa}.return{display:flex;align-items:center;justify-content:center;min-height:48px;margin-top:28px;padding:12px 20px;border:1px solid #809fff88;border-radius:13px;background:linear-gradient(120deg,#3869df,#6352d2);color:#fff;text-decoration:none;font-weight:600;font-size:15px;transition:filter .2s,transform .2s}.return:hover{filter:brightness(1.15);transform:translateY(-1px)}.return:focus-visible{outline:3px solid #b1dcff;outline-offset:5px}.hint{font-size:13px;color:#aab9d7;margin-top:18px;margin-bottom:0}.footer{margin:26px 0 0;text-align:center;color:#94a4c5;font-size:12px}.footer svg{width:13px;height:13px;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.5}@keyframes arrive{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}@keyframes check{to{stroke-dashoffset:0}}@keyframes spin{to{transform:rotate(360deg)}}@media(max-width:420px){body{padding:24px 16px}.card{padding:32px 22px 26px;border-radius:22px}.brand{margin-bottom:26px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.success .icon path{stroke-dashoffset:0}.return:hover{transform:none}}
</style></head><body><main class="${outcome}">
<div class="brand"><svg viewBox="0 0 64 64" role="img" aria-label="HasarBotu logosu"><defs><linearGradient id="blue" x2="1" y2="1"><stop stop-color="#2563eb"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs><rect x="1" y="1" width="62" height="62" rx="18" fill="url(#blue)"/><path d="M15 21v22m14-22v22M15 32h14m12-11v22m0-22h5a5.5 5.5 0 0 1 0 11h-5m5 0a5.5 5.5 0 0 1 0 11h-5" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>HasarBotu <span>V2</span></span></div>
<section class="card" aria-labelledby="result-title"><div class="icon" aria-hidden="true"><svg viewBox="0 0 64 64">${message.symbol}</svg></div><div class="eyebrow">${purpose === 'mail' ? 'Gmail · SBM e-posta bağlantısı' : 'Kurumsal Google girişi'}</div><h1 id="result-title">${message.title}</h1><p class="description">${message.description}</p><p>${message.detail}</p><a class="return" href="${returnUrl}">Uygulamaya Dön <span aria-hidden="true">&nbsp;↗</span></a><p class="hint" role="status" id="return-hint">${client === 'desktop' ? 'Masaüstü uygulamanızda işlemin sonucu otomatik güncellenir.' : 'İşlemi başlattığınız sekme otomatik güncellenir.'}</p></section><p class="footer"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="8" rx="2"/><path d="M5 7V4a3 3 0 0 1 6 0v3"/></svg> HasarBotu · Güvenli Google bağlantısı</p></main>
${outcome === 'success' ? `<script nonce="${nonce}">setTimeout(function(){window.close();document.getElementById('return-hint').textContent='Tarayıcınız bu sekmeyi açık tutuyor. Uygulamaya dönebilir veya sekmeyi kapatabilirsiniz.'},2200)</script>` : ''}</body></html>`)
  })
}
