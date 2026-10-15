import { describe,expect,it,vi } from 'vitest'
import { createLegislationPort } from './legislationPort'

const input = { expectedOrganizationId: '019fe084-1ec1-7797-835a-777eb0cc59c2',expectedVersion: 0,model: 'gemini-3.8-flash',enabled: true,apiKey: 'synthetic-only key-with-space' }
describe('legislation errors without credential disclosure',() => {
  it('accepts long authorization keys and sends them unchanged through the authenticated settings request',async () => {
    const apiKey = 'AQ.' + 'synthetic_'.repeat(60)
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ organizationId: input.expectedOrganizationId,version: 1,configured: true,enabled: true,model: input.model,canConfigure: true,encryptionAvailable: true })))
    await createLegislationPort(fetcher).saveSettings({ ...input,apiKey })
    expect(fetcher).toHaveBeenCalledWith('/api/v1/legislation/ai-settings',expect.objectContaining({ method: 'PUT',credentials: 'include' }))
    expect(JSON.parse(fetcher.mock.calls[0]![1].body as string)).toEqual({ ...input,apiKey })
  })
  it('identifies invalid key input before transport without including the secret',() => {
    const fetcher = vi.fn()
    expect(() => createLegislationPort(fetcher).saveSettings(input)).toThrow('Yalnız anahtarı yapıştırın')
    expect(fetcher).not.toHaveBeenCalled()
    try { createLegislationPort(fetcher).saveSettings(input) } catch (error) { expect(String(error)).not.toContain(input.apiKey) }
  })
  it('identifies invalid model input instead of a generic service outage',() => {
    expect(() => createLegislationPort(vi.fn()).saveSettings({ ...input,apiKey: 'synthetic-valid-test-key',model: 'models/gemini-3.8-flash' })).toThrow('model adı geçersiz')
  })
  it('distinguishes network, proxy and response contract failures',async () => {
    await expect(createLegislationPort(vi.fn().mockRejectedValue(new TypeError('synthetic'))).library()).rejects.toThrow('bağlantı kurulamadı')
    await expect(createLegislationPort(vi.fn().mockResolvedValue(new Response('<html>proxy</html>'))).library()).rejects.toThrow('geçerli bir yanıt')
    await expect(createLegislationPort(vi.fn().mockResolvedValue(new Response('{}'))).library()).rejects.toThrow('program sürümüyle uyumlu değil')
  })
})
