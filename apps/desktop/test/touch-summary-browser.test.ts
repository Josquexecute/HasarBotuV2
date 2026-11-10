import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import { preview } from 'vite'
import { expect, it } from 'vitest'
import { caseListItemSchema, trackingSnapshotSchema } from '@hasarbotu/contracts'
import { DEFAULT_ASSISTANT_APPEARANCE } from '@hasarbotu/contracts/assistant-appearance'

it.skipIf(process.platform !== 'win32')('built Touch UI: real HTTP adapters, both types, complete processes, long text and scaled narrow viewports', async () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const server = await preview({ configFile: false, root, preview: { host: '127.0.0.1', port: 0, open: false } })
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const user = { id: 'test-owner', organizationId: 'test-org', displayName: 'Uzun Personel Adı '.repeat(8), email: 'touch@example.test', roles: ['admin'] }
  const insurer = { id: 'test-insurer', name: 'Sigorta Şirketi '.repeat(9) }
  const records = ['traffic', 'casco'].map((caseType, index) => caseListItemSchema.parse({
    id: `test-case-${index}`, caseType, officeCaseNumber: `2026/${index + 1}`, plate: `34 TEST ${index + 1}`,
    notificationFormNumber: null, insurerClaimNumber: `HASAR-${index + 1}`, status: 'open', stage: 'under_repair',
    responsibleUserId: user.id, expertUserId: null, serviceId: null, serviceProfile: null,
    serviceDetails: { name: 'Uzun Servis Adı '.repeat(20).trim(), phone: index === 0 ? '+90 (532) 123 45 67' : '0212 123 45 67', address: null },
    insurerId: insurer.id, followUpDate: '2026-11-04', lossDate: null, notificationDate: '2026-11-03',
    lastInterventionAt: '2026-11-04T08:00:00Z', createdAt: '2026-11-03T08:00:00Z', updatedAt: '2026-11-04T08:00:00Z', version: 1,
  }))
  const tracking = trackingSnapshotSchema.parse({
    tramer: [{ id: 'tramer-1', caseId: records[0]!.id, plate: records[0]!.plate, officeNumber: '2026/1', assignedUserId: user.id, assignedName: user.displayName, applicationNumber: '123456', status: 'completed', resultText: 'Tramer sonucu korundu', version: 1, canEdit: false }],
    documents: [{ id: 'document-1', caseId: records[0]!.id, plate: records[0]!.plate, officeNumber: '2026/1', fileName: 'sentetik.pdf', relativePath: 'sentetik.pdf', status: 'pending', documentType: null, observedAt: '2026-11-04T08:00:00Z', canReview: false }],
    notifications: [], mailConnections: [], reviews: [], users: [{ id: user.id, displayName: user.displayName }], history: [], canManage: false, googleEnabled: false, automaticSbmEnabled: false, services: [],
  })
  const operations = (caseId: string) => ({
    caseId, asOfDate: '2026-11-04', notes: [],
    tasks: [{ id: 'task-1', title: 'Korunan görev', priority: 'normal', status: 'open', assignedUserId: null, assignedUserDisplayName: null, dueDate: '2026-11-05', dueStatus: 'upcoming', resolutionNote: null, resolvedByUserId: null, resolvedByDisplayName: null, resolvedAt: null, version: 1, createdByUserId: user.id, createdByDisplayName: user.displayName, createdAt: '2026-11-04T08:00:00Z', updatedAt: '2026-11-04T08:00:00Z', legacySource: null }],
    followUpHistory: [{ id: 'follow-1', previousFollowUpDate: null, newFollowUpDate: '2026-11-04', source: 'case_update', caseVersion: 1, actorUserId: user.id, actorDisplayName: user.displayName, changedAt: '2026-11-04T08:00:00Z' }],
    permissions: { canWrite: false, canCompleteTasks: false },
  })
  let verifiedLayouts = 0
  try {
    const origin = server.resolvedUrls?.local[0]
    if (!origin) throw new Error('Touch preview did not expose a loopback URL')
    for (const layout of [{ width: 420, height: 760, dpi: 1, zoom: 1 }, { width: 280, height: 540, dpi: 2, zoom: 1 }, { width: 390, height: 850, dpi: 3, zoom: 1.5 }]) {
      // Display scaling reduces the logical viewport. CSS zoom would instead
      // enlarge the fixed-height panel itself and does not model browser/OS DPI.
      const context = await browser.newContext({ viewport: { width: Math.floor(layout.width / layout.zoom), height: Math.floor(layout.height / layout.zoom) }, deviceScaleFactor: layout.dpi })
      const page = await context.newPage()
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname
        let body: unknown
        if (path === '/api/v1/auth/session') body = { user, expiresAt: null }
        else if (path === '/api/v1/me/assistant-appearance') body = { userId: user.id, version: 0, appearance: { ...DEFAULT_ASSISTANT_APPEARANCE, textSize: 'large' } }
        else if (path === '/api/v1/cases') body = { items: records, pageInfo: { page: 1, pageSize: 10, totalItems: 2, totalPages: 1 } }
        else if (path.endsWith('/operations')) body = operations(path.split('/').at(-2)!)
        else if (path.endsWith('/traffic-value-loss/calculate')) body = { calculation: null }
        else if (path.startsWith('/api/v1/cases/')) body = { case: { ...records.find(item => path.endsWith(item.id)), legacyReferences: { responsibleNames: [], expertNames: [], serviceNames: [] } } }
        else if (path === '/api/v1/tracking') body = tracking
        else if (path === '/api/v1/references/insurers') body = { items: [insurer] }
        else if (path === '/api/v1/references/users') body = { items: [{ id: user.id, displayName: user.displayName, roles: ['admin'] }] }
        else if (path.startsWith('/api/v1/references/')) body = { items: [] }
        else { errors.push(`Unexpected API request: ${path}`); await route.abort(); return }
        await route.fulfill({ json: body })
      })
      await page.goto(`${origin}touch-assistant`)
      await page.locator('.assistant-search input').waitFor()
      await page.getByRole('textbox', { name: 'Plaka veya dosya numarası' }).fill('34 TEST')
      await page.getByRole('button', { name: 'Ara', exact: true }).click()
      await page.locator('.assistant-result').last().waitFor()
      expect(await page.locator('.assistant-result .assistant-plate__type').allTextContents()).toEqual(['TRAFİK', 'KASKO'])
      for (let index = 0; index < 2; index++) {
        await page.getByRole('tab', { name: 'Dosyalar' }).click()
        await page.locator('.assistant-result').nth(index).click()
        await page.getByRole('tab', { name: 'Süreçler' }).click()
        await page.locator('.assistant-process').waitFor()
        await page.getByText('Tramer sonucu korundu', { exact: true }).waitFor()
        await page.getByText(insurer.name, { exact: true }).waitFor()
        const values = await page.locator('.assistant-process dd').allTextContents()
        expect(values.slice(0, 7)).toEqual([user.displayName, insurer.name, index === 0 ? 'Trafik' : 'Kasko', `HASAR-${index + 1}`, '03.11.2026', records[index]!.serviceDetails!.name, index === 0 ? '0532 123 45 67' : '—'])
        expect(await page.getByText('Korunan görev', { exact: true }).count()).toBe(1)
        expect(await page.getByRole('heading', { name: 'Takip geçmişi' }).count()).toBe(1)
        expect(await page.getByText(/1 evrak inceleme bekliyor/).count()).toBe(1)
        const fit = await page.evaluate(() => {
          const panel = document.querySelector('.desktop-assistant-panel')!.getBoundingClientRect()
          const content = document.querySelector('.assistant-content')!
          const fields = [...document.querySelectorAll('.assistant-process dt, .assistant-process dd, .assistant-case-heading')]
          return { horizontal: content.scrollWidth <= content.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, fields: fields.every(field => field.getBoundingClientRect().right <= panel.right + 1 && field.getBoundingClientRect().left >= panel.left), footer: document.querySelector('footer')!.getBoundingClientRect().bottom <= innerHeight + 1 }
        })
        if (process.env.HB_CAPTURE_SCREENSHOTS === '1' && (layout.dpi === 1 || !fit.footer)) {
          const output = join(root, '.local/touch-0191/screenshots')
          await mkdir(output, { recursive: true })
          await page.screenshot({ path: join(output, `${layout.width}-${layout.dpi}-${index === 0 ? 'traffic-process' : 'kasko-process'}.png`) })
        }
        expect(fit, JSON.stringify(layout)).toEqual({ horizontal: true, fields: true, footer: true })
        verifiedLayouts++
      }
      expect(errors).toEqual([])
      await context.close()
    }
    expect(verifiedLayouts).toBe(6)
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
  }
})
